import { fetchCandidateArticles } from "./fetchNews.js";
import { classifyArticles } from "./classify.js";
import { loadState, saveState, todayUTC } from "./state.js";
import { postArticle } from "./postToDiscord.js";

const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "DISCORD_WEBHOOK_URL"];
const DAILY_POST_LIMIT = 2;

async function main() {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key] || !process.env[key].trim()) {
      console.error(`Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  if (!process.env.ANTHROPIC_API_KEY.trim().startsWith("sk-ant-")) {
    console.error(
      "ANTHROPIC_API_KEY doesn't look like a valid Anthropic key (should start with 'sk-ant-'). Check the secret value for stray characters or a missing/extra prefix."
    );
    process.exit(1);
  }

  console.log("Fetching candidate articles from Google News RSS...");
  const candidates = await fetchCandidateArticles();
  console.log(`Found ${candidates.length} raw candidates.`);

  const state = await loadState();
  const today = todayUTC();

  // Reset the counter if this is the first run of a new UTC day
  if (state.postDate !== today) {
    state.postDate = today;
    state.postCount = 0;
  }

  const unseen = candidates.filter((a) => !state.seenLinks.has(a.link));
  console.log(`${unseen.length} are new since last run.`);

  if (unseen.length === 0) {
    console.log("Nothing new. Done.");
    return;
  }

  console.log("Classifying relevance with Claude...");
  const classifications = await classifyArticles(
    unseen.map((a) => ({ title: a.title, snippet: a.snippet }))
  );

  const relevant = [];
  for (const result of classifications) {
    const article = unseen[result.index];
    if (!article) continue;
    state.seenLinks.add(article.link); // mark seen regardless of relevance
    if (result.relevant) {
      relevant.push({ ...article, reason: result.reason });
    } else {
      console.log(`Filtered out: "${article.title}" — ${result.reason}`);
    }
  }

  console.log(`${relevant.length} relevant article(s) found this run.`);

  const remainingQuota = Math.max(0, DAILY_POST_LIMIT - state.postCount);
  const toPost = relevant.slice(0, remainingQuota);
  const droppedForQuota = relevant.length - toPost.length;

  if (remainingQuota === 0) {
    console.log(
      `Daily post limit (${DAILY_POST_LIMIT}) already reached for ${today}. Skipping all ${relevant.length} relevant article(s) this run.`
    );
  } else if (droppedForQuota > 0) {
    console.log(
      `Daily post limit (${DAILY_POST_LIMIT}) reached mid-run. Posting ${toPost.length}, skipping ${droppedForQuota} for the rest of ${today}.`
    );
  }

  for (const article of toPost) {
    try {
      await postArticle(article);
      state.postCount += 1;
      console.log(`Posted (${state.postCount}/${DAILY_POST_LIMIT} today): ${article.title}`);
    } catch (err) {
      console.error(`Failed to post "${article.title}":`, err.message);
    }
  }

  await saveState(state);
  console.log("State saved. Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
