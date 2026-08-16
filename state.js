import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ACCEPT_DECISIONS } from "./editorial.js";

const STATE_PATH = new URL("./state.json", import.meta.url);
const MAX_TRACKED_LINKS = 500;

export function emptyState() {
  return {
    seenLinks: new Set(),
    pendingArticles: [],
    postDate: null,
    postCount: 0,
  };
}

function statePath(target) {
  return target instanceof URL ? fileURLToPath(target) : resolve(target);
}

function validOptionalString(value) {
  return value === null || typeof value === "string";
}

function validatePendingArticle(article, index) {
  if (!article || typeof article !== "object" || Array.isArray(article)) {
    throw new Error(`pendingArticles[${index}] must be an object`);
  }

  const requiredStrings = [
    "link",
    "publisherLink",
    "title",
    "source",
    "decision",
    "reason",
    "discoveredAt",
  ];
  if (requiredStrings.some((key) => typeof article[key] !== "string" || !article[key])) {
    throw new Error(`pendingArticles[${index}] has missing string fields`);
  }
  if (!ACCEPT_DECISIONS.has(article.decision)) {
    throw new Error(`pendingArticles[${index}] has a non-accepted decision`);
  }
  if (!validOptionalString(article.pubDate) || !validOptionalString(article.snippet)) {
    throw new Error(`pendingArticles[${index}] has invalid optional fields`);
  }

  for (const key of ["relevance", "credibility", "substance"]) {
    if (!Number.isInteger(article[key]) || article[key] < 0 || article[key] > 5) {
      throw new Error(`pendingArticles[${index}].${key} must be an integer`);
    }
  }
  if (
    !Number.isInteger(article.qualityScore) ||
    article.qualityScore < 0 ||
    article.qualityScore > 100
  ) {
    throw new Error(`pendingArticles[${index}].qualityScore is invalid`);
  }
  if (
    typeof article.confidence !== "number" ||
    article.confidence < 0 ||
    article.confidence > 1
  ) {
    throw new Error(`pendingArticles[${index}].confidence is invalid`);
  }

  return article;
}

export function parseState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`state.json contains invalid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("state.json must contain an object");
  }
  if (!Array.isArray(parsed.seenLinks) || parsed.seenLinks.some((link) => typeof link !== "string")) {
    throw new Error("state.json seenLinks must be an array of strings");
  }
  if (
    parsed.postDate !== null &&
    parsed.postDate !== undefined &&
    (typeof parsed.postDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.postDate))
  ) {
    throw new Error("state.json postDate must be null or YYYY-MM-DD");
  }
  const postCount = parsed.postCount ?? 0;
  if (!Number.isInteger(postCount) || postCount < 0) {
    throw new Error("state.json postCount must be a non-negative integer");
  }

  const seenLinks = new Set(parsed.seenLinks);
  if (parsed.pendingArticles !== undefined && !Array.isArray(parsed.pendingArticles)) {
    throw new Error("state.json pendingArticles must be an array");
  }
  const pendingArticles = (parsed.pendingArticles || []).map(validatePendingArticle);
  const pendingLinks = new Set();
  for (const article of pendingArticles) {
    if (seenLinks.has(article.link) || pendingLinks.has(article.link)) {
      throw new Error(`state.json contains duplicate state for ${article.link}`);
    }
    pendingLinks.add(article.link);
  }

  return {
    seenLinks,
    pendingArticles,
    postDate: parsed.postDate || null,
    postCount,
  };
}

/** Missing state is a clean first run; malformed or unreadable state is fatal. */
export async function loadState(target = STATE_PATH) {
  try {
    return parseState(await readFile(statePath(target), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
}

/** Save state atomically so an interrupted write cannot leave truncated JSON. */
export async function saveState(
  { seenLinks, pendingArticles, postDate, postCount },
  target = STATE_PATH
) {
  const targetPath = statePath(target);
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  const links = Array.from(seenLinks);
  const trimmedLinks = links.slice(Math.max(0, links.length - MAX_TRACKED_LINKS));
  const serialized = `${JSON.stringify(
    {
      seenLinks: trimmedLinks,
      pendingArticles,
      postDate,
      postCount,
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  )}\n`;

  try {
    await writeFile(temporaryPath, serialized, "utf8");
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export function todayUTC(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
