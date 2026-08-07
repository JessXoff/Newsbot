import fetch from "node-fetch";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";
const BATCH_SIZE = 20; // classify in chunks so one giant request can't fail everything at once
const MAX_TOKENS_PER_BATCH = 3000;

const SYSTEM_PROMPT = `You are a filter for a news alert bot dedicated to the Mesopotamian goddess Inanna (also worshipped as Ishtar). \
You will be given a numbered list of news article titles and short snippets pulled from a Google News search for "Inanna" and "Ishtar". \
Many results are false positives. Mark an article RELEVANT only if it is substantively about:
- The goddess Inanna/Ishtar herself (mythology, archaeology, religious scholarship, modern devotional practice, temples, artifacts, academic papers, etc.)
- Ancient Mesopotamian/Sumerian/Akkadian/Babylonian/Assyrian religion where Inanna/Ishtar is a real subject of the piece, not a passing mention.

Mark an article NOT RELEVANT if it is about any of the following, even though it matched the search terms:
- The 1987 film "Ishtar" (Warren Beatty / Dustin Hoffman), or any other film/show/album/song simply titled "Ishtar" or "Inanna"
- A person, pet, boat, product, company, band, or place named "Ishtar" or "Inanna" that has nothing to do with the goddess
- Military operations, hurricanes, or other named things that borrowed the name Ishtar/Inanna without being about the deity
- Passing, one-word namedrops with no real content about the goddess

Respond with ONLY a raw JSON array (no markdown fences, no prose) of objects in the same order as the input, each shaped exactly like:
{"index": <number>, "relevant": <true|false>, "reason": "<one short clause>"}`;

/**
 * Classify ALL unseen articles for relevance using Claude, batching internally.
 * @param {Array<{title: string, snippet: string}>} articles
 * @returns {Promise<Array<{index: number, relevant: boolean, reason: string}>>}
 *   `index` refers to the position in the ORIGINAL `articles` array passed in.
 */
export async function classifyArticles(articles) {
  if (articles.length === 0) return [];

  const results = [];

  for (let start = 0; start < articles.length; start += BATCH_SIZE) {
    const batch = articles.slice(start, start + BATCH_SIZE);
    console.log(
      `Classifying batch ${start / BATCH_SIZE + 1} (${batch.length} articles)...`
    );

    const batchResults = await classifyBatch(batch);

    // batchResults use 0-based indices local to this batch; shift to global indices
    for (const r of batchResults) {
      results.push({ ...r, index: r.index + start });
    }
  }

  return results;
}

async function classifyBatch(batch) {
  const userContent = batch
    .map(
      (a, i) =>
        `${i}. TITLE: ${a.title}\n   SNIPPET: ${a.snippet || "(no snippet)"}`
    )
    .join("\n\n");

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": (process.env.ANTHROPIC_API_KEY || "").trim(),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS_PER_BATCH,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json();

  const textBlock = (data.content || []).find((c) => c.type === "text");
  if (!textBlock) {
    // Dump the full response so we can actually see what came back instead
    // of guessing. Common causes: stop_reason "refusal", empty content on
    // a safety trip, or an unexpected response shape.
    console.error(
      "No text content in Claude response. Full response:",
      JSON.stringify(data, null, 2)
    );
    throw new Error(
      `No text content in Claude response (stop_reason: ${data.stop_reason || "unknown"})`
    );
  }

  if (data.stop_reason === "max_tokens") {
    console.warn(
      `Batch response was cut off at max_tokens (${MAX_TOKENS_PER_BATCH}). JSON may be truncated/invalid; reduce BATCH_SIZE if this recurs.`
    );
  }

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse classification JSON. Raw text was:", cleaned);
    throw err;
  }
}
