import Parser from "rss-parser";
import { withRetry } from "./http.js";

const parser = new Parser({
  timeout: 15_000,
  customFields: {
    item: [["source", "source"]],
  },
});

// Search terms to cover. Each becomes its own Google News RSS query so we
// don't miss results Google's OR-matching might rank low.
const SEARCH_TERMS = ['"Inanna"', '"Ishtar" goddess', '"Ishtar" Mesopotamian'];
export const DEFAULT_MAX_ARTICLE_AGE_DAYS = 45;

const GOOGLE_NEWS_RSS = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-US&gl=US&ceid=US:en`;

/**
 * Fetch and merge RSS results for all search terms, deduping by link.
 * Returns an array of { title, link, pubDate, source, snippet }.
 */
export function isRecentPublication(
  pubDate,
  { now = new Date(), maxAgeDays = DEFAULT_MAX_ARTICLE_AGE_DAYS } = {}
) {
  const published = Date.parse(pubDate || "");
  if (!Number.isFinite(published)) return false;

  const age = now.getTime() - published;
  return age >= -86_400_000 && age <= maxAgeDays * 86_400_000;
}

function configuredMaxAgeDays() {
  const configured = Number(process.env.MAX_ARTICLE_AGE_DAYS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_ARTICLE_AGE_DAYS;
}

export async function fetchCandidateArticles({
  now = new Date(),
  maxAgeDays = configuredMaxAgeDays(),
  parseUrl = (url) => parser.parseURL(url),
} = {}) {
  const seenLinks = new Set();
  const articles = [];
  let successfulFeeds = 0;

  for (const term of SEARCH_TERMS) {
    let feed;
    try {
      feed = await withRetry(() => parseUrl(GOOGLE_NEWS_RSS(term)), {
        attempts: 3,
      });
      successfulFeeds += 1;
    } catch (err) {
      console.error(`Failed to fetch RSS for "${term}":`, err.message);
      continue;
    }

    for (const item of feed.items || []) {
      const link = normalizeLink(item.link);
      if (!link || seenLinks.has(link)) continue;

      const pubDate = item.pubDate || item.isoDate || null;
      if (!isRecentPublication(pubDate, { now, maxAgeDays })) continue;

      seenLinks.add(link);

      articles.push({
        title: item.title?.trim() || "(untitled)",
        link,
        pubDate,
        source:
          (typeof item.source === "string" && item.source) ||
          item.source?._ ||
          item.creator ||
          "Unknown source",
        snippet: (item.contentSnippet || item.content || "").slice(0, 400),
      });
    }
  }

  if (successfulFeeds === 0) {
    throw new Error("All Google News RSS requests failed");
  }

  return articles.sort(
    (left, right) => Date.parse(right.pubDate) - Date.parse(left.pubDate)
  );
}

// Keep Google's stable article identifier while removing RSS tracking params.
export function normalizeLink(link) {
  if (!link) return null;
  try {
    const url = new URL(link);
    url.search = "";
    return url.toString();
  } catch {
    return link;
  }
}
