import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: [["source", "source"]],
  },
});

// Search terms to cover. Each becomes its own Google News RSS query so we
// don't miss results Google's OR-matching might rank low.
const SEARCH_TERMS = ["Inanna", "Ishtar goddess", "Ishtar Mesopotamian"];

const GOOGLE_NEWS_RSS = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-US&gl=US&ceid=US:en`;

/**
 * Fetch and merge RSS results for all search terms, deduping by link.
 * Returns an array of { title, link, pubDate, source, snippet }.
 */
export async function fetchCandidateArticles() {
  const seenLinks = new Set();
  const articles = [];

  for (const term of SEARCH_TERMS) {
    let feed;
    try {
      feed = await parser.parseURL(GOOGLE_NEWS_RSS(term));
    } catch (err) {
      console.error(`Failed to fetch RSS for "${term}":`, err.message);
      continue;
    }

    for (const item of feed.items || []) {
      const link = normalizeLink(item.link);
      if (!link || seenLinks.has(link)) continue;
      seenLinks.add(link);

      articles.push({
        title: item.title?.trim() || "(untitled)",
        link,
        pubDate: item.pubDate || item.isoDate || null,
        source:
          (typeof item.source === "string" && item.source) ||
          item.source?._ ||
          item.creator ||
          "Unknown source",
        snippet: (item.contentSnippet || item.content || "").slice(0, 400),
      });
    }
  }

  return articles;
}

// Google News RSS links are redirect URLs; strip tracking params so the
// same underlying article doesn't get treated as "new" every run.
function normalizeLink(link) {
  if (!link) return null;
  try {
    const url = new URL(link);
    url.search = "";
    return url.toString();
  } catch {
    return link;
  }
}
