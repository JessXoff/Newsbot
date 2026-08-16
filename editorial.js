export const ACCEPT_DECISIONS = new Set([
  "ACCEPT_ACADEMIC",
  "ACCEPT_CONTEMPORARY_LITURGICAL",
]);

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_",
]);

const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "inanna",
  "ishtar",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

/**
 * Apply a deterministic safety floor after model classification. Academic
 * coverage needs strong provenance; modern liturgy may be independently
 * published, but still needs transparent attribution and sound framing.
 */
export function meetsEditorialThreshold(classification) {
  if (!ACCEPT_DECISIONS.has(classification.decision)) return false;
  if (classification.crankRisk || classification.riskSignals?.length > 0) return false;

  const common =
    classification.relevance >= 4 &&
    classification.substance >= 3 &&
    classification.confidence >= 0.75;

  if (classification.decision === "ACCEPT_ACADEMIC") {
    return (
      common &&
      classification.credibility >= 4 &&
      classification.qualityScore >= 75
    );
  }

  return (
    common &&
    classification.credibility >= 3 &&
    classification.qualityScore >= 70
  );
}

export function toPendingArticle(article, classification, now = new Date()) {
  return {
    link: article.link,
    publisherLink: article.publisherLink || article.link,
    title: article.title,
    pubDate: article.pubDate,
    source: article.source,
    snippet: article.snippet,
    decision: classification.decision,
    reason: classification.reason,
    relevance: classification.relevance,
    credibility: classification.credibility,
    substance: classification.substance,
    qualityScore: classification.qualityScore,
    confidence: classification.confidence,
    discoveredAt: now.toISOString(),
  };
}

export function articleRank(article, now = new Date()) {
  const published = Date.parse(article.pubDate || "");
  const ageDays = Number.isFinite(published)
    ? Math.max(0, (now.getTime() - published) / 86_400_000)
    : 45;
  const freshnessBonus = Math.max(0, 10 - ageDays / 4.5);

  return (
    article.qualityScore +
    article.credibility * 3 +
    article.substance * 2 +
    freshnessBonus
  );
}

export function canonicalStoryUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (name.startsWith("utm_") || TRACKING_PARAMETERS.has(name)) {
        url.searchParams.delete(name);
      }
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value || "";
  }
}

function titleTokens(title) {
  const withoutPublisher = String(title || "").replace(/\s[-|–—]\s[^-|–—]{2,80}$/, "");
  return new Set(
    withoutPublisher
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token))
  );
}

export function titleSimilarity(left, right) {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }

  return intersection / (a.size + b.size - intersection);
}

function sameStory(left, right) {
  const leftUrl = canonicalStoryUrl(left.publisherLink || left.link);
  const rightUrl = canonicalStoryUrl(right.publisherLink || right.link);
  if (leftUrl && leftUrl === rightUrl) return true;

  return titleSimilarity(left.title, right.title) >= 0.68;
}

/**
 * Rank pending articles and group coverage of the same story. The highest
 * ranked member becomes the posting representative for that story.
 */
export function rankAndClusterArticles(articles, now = new Date()) {
  const ranked = [...articles].sort((left, right) => {
    const scoreDifference = articleRank(right, now) - articleRank(left, now);
    if (scoreDifference !== 0) return scoreDifference;
    return Date.parse(right.pubDate || "") - Date.parse(left.pubDate || "");
  });

  const clusters = [];
  for (const article of ranked) {
    const cluster = clusters.find((candidate) =>
      sameStory(candidate.representative, article)
    );

    if (cluster) {
      cluster.members.push(article);
    } else {
      clusters.push({ representative: article, members: [article] });
    }
  }

  return clusters;
}
