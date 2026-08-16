import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchCandidateArticles } from "./fetchNews.js";
import { enrichArticles } from "./enrichArticles.js";
import { classifyArticles } from "./classify.js";
import { loadState, saveState, todayUTC } from "./state.js";
import { postArticle } from "./postToDiscord.js";
import {
  meetsEditorialThreshold,
  rankAndClusterArticles,
  toPendingArticle,
} from "./editorial.js";

const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "DISCORD_WEBHOOK_URL"];
export const DAILY_POST_LIMIT = 2;
const MAX_DELIVERY_ATTEMPTS_PER_RUN = 4;

export function validateEnvironment(environment = process.env) {
  for (const key of REQUIRED_ENV) {
    if (!environment[key] || !environment[key].trim()) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

export function applyClassifications(
  state,
  articles,
  classifications,
  { now = new Date(), logger = console } = {}
) {
  if (articles.length !== classifications.length) {
    throw new Error(
      `Received ${classifications.length} classifications for ${articles.length} articles`
    );
  }

  const pendingLinks = new Set(state.pendingArticles.map((article) => article.link));

  for (const classification of classifications) {
    const article = articles[classification.index];
    if (!article) throw new Error(`Classifier index ${classification.index} is out of range`);

    if (meetsEditorialThreshold(classification)) {
      if (!pendingLinks.has(article.link) && !state.seenLinks.has(article.link)) {
        state.pendingArticles.push(toPendingArticle(article, classification, now));
        pendingLinks.add(article.link);
      }
      logger.log(
        `Accepted for ranking: "${article.title}" — ${classification.decision}: ${classification.reason}`
      );
    } else {
      state.seenLinks.add(article.link);
      logger.log(
        `Rejected: "${article.title}" — ${classification.decision}: ${classification.reason}`
      );
    }
  }
}

export async function runBot({
  now = new Date(),
  environment = process.env,
  fetchCandidates = fetchCandidateArticles,
  enrichCandidates = enrichArticles,
  classify = classifyArticles,
  load = loadState,
  save = saveState,
  post = postArticle,
  logger = console,
} = {}) {
  validateEnvironment(environment);

  const state = await load();
  const today = todayUTC(now);
  let stateDirty = false;

  if (state.postDate !== today) {
    state.postDate = today;
    state.postCount = 0;
    stateDirty = true;
  }

  const initialQuota = Math.max(0, DAILY_POST_LIMIT - state.postCount);
  if (initialQuota === 0) {
    logger.log(
      `Daily post limit (${DAILY_POST_LIMIT}) already reached for ${today}; deferring new work until tomorrow.`
    );
    if (stateDirty) await save(state);
    return { fetched: 0, classified: 0, posted: 0, pending: state.pendingArticles.length };
  }

  logger.log("Fetching recent candidate articles from Google News RSS...");
  const candidates = await fetchCandidates({ now });
  logger.log(`Found ${candidates.length} recent candidate(s).`);

  const pendingLinks = new Set(state.pendingArticles.map((article) => article.link));
  const unseen = candidates.filter(
    (article) => !state.seenLinks.has(article.link) && !pendingLinks.has(article.link)
  );
  logger.log(`${unseen.length} candidate(s) need editorial review.`);

  let classifiedCount = 0;
  if (unseen.length > 0) {
    logger.log("Resolving publisher pages and extracting article evidence...");
    const enriched = await enrichCandidates(unseen);
    const readyForReview = [];

    for (const article of enriched) {
      if (article.enrichmentStatus === "decode_failed") {
        logger.warn(
          `Deferred because the publisher URL could not be resolved: "${article.title}" — ${article.enrichmentError}`
        );
      } else {
        readyForReview.push(article);
      }
    }

    if (readyForReview.length > 0) {
      logger.log("Applying relevance, credibility, and quality policy with Claude...");
      const classifications = await classify(readyForReview);
      applyClassifications(state, readyForReview, classifications, { now, logger });
      classifiedCount = readyForReview.length;
      stateDirty = true;
    }
  }

  // Persist new pending/rejected decisions before any external delivery.
  if (stateDirty) {
    await save(state);
    stateDirty = false;
  }

  if (state.pendingArticles.length === 0) {
    logger.log("No publishable articles are pending. Done.");
    return { fetched: candidates.length, classified: classifiedCount, posted: 0, pending: 0 };
  }

  const clusters = rankAndClusterArticles(state.pendingArticles, now);
  let posted = 0;
  let attempted = 0;

  for (const cluster of clusters) {
    if (
      state.postCount >= DAILY_POST_LIMIT ||
      attempted >= MAX_DELIVERY_ATTEMPTS_PER_RUN
    ) {
      break;
    }

    attempted += 1;
    const article = cluster.representative;
    try {
      await post(article);
      state.postCount += 1;
      posted += 1;

      const completedLinks = new Set(cluster.members.map((member) => member.link));
      for (const link of completedLinks) state.seenLinks.add(link);
      state.pendingArticles = state.pendingArticles.filter(
        (pending) => !completedLinks.has(pending.link)
      );

      // Save after every confirmed Discord delivery to minimize duplicate risk.
      await save(state);
      logger.log(
        `Posted (${state.postCount}/${DAILY_POST_LIMIT} today): ${article.title}`
      );
    } catch (error) {
      logger.error(`Failed to post "${article.title}"; retained for retry:`, error.message);
    }
  }

  logger.log(
    `Done. Posted ${posted}; ${state.pendingArticles.length} accepted article(s) remain pending.`
  );
  return {
    fetched: candidates.length,
    classified: classifiedCount,
    posted,
    pending: state.pendingArticles.length,
  };
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  runBot().catch((error) => {
    console.error("Fatal error:", error);
    process.exitCode = 1;
  });
}
