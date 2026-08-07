import { fetchCandidateArticles } from "./fetchNews.js";
import { classifyArticles } from "./classify.js";
import { loadSeenLinks, saveSeenLinks } from "./state.js";
import { postArticle } from "./postToDiscord.js";

const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "DISCORD_WEBHOOK_URL"];

async function main() {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      console.error(`Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  console.log("Fetching candidate articles from Google News RSS...");
  const candidates = await fetchCandidateArticles();
  console.log(`Found ${candidates.length} raw candidates.`);

  const seenLinks = await loadSeenLinks();
  const unseen = candidates.filter((a) => !seenLinks.has(a.link));
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
    seenLinks.add(article.link); // mark seen regardless of relevance
    if (result.relevant) {
      relevant.push({ ...article, reason: result.reason });
    } else {
      console.log(`Filtered out: "${article.title}" — ${result.reason}`);
    }
  }

  console.log(`${relevant.length} relevant article(s) to post.`);

  for (const article of relevant) {
    try {
      await postArticle(article);
      console.log(`Posted: ${article.title}`);
    } catch (err) {
      console.error(`Failed to post "${article.title}":`, err.message);
    }
  }

  await saveSeenLinks(seenLinks);
  console.log("State saved. Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
