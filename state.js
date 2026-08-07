import { readFile, writeFile } from "fs/promises";

const STATE_PATH = new URL("./state.json", import.meta.url);
const MAX_TRACKED_LINKS = 500; // keep the file small; oldest links roll off

/**
 * Loads the full state object: seen links plus today's post count.
 * Returns { seenLinks: Set<string>, postDate: string|null, postCount: number }
 */
export async function loadState() {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      seenLinks: new Set(parsed.seenLinks || []),
      postDate: parsed.postDate || null,
      postCount: parsed.postCount || 0,
    };
  } catch {
    return { seenLinks: new Set(), postDate: null, postCount: 0 };
  }
}

/**
 * Saves the full state object back to disk.
 */
export async function saveState({ seenLinks, postDate, postCount }) {
  const links = Array.from(seenLinks);
  const trimmed = links.slice(Math.max(0, links.length - MAX_TRACKED_LINKS));
  await writeFile(
    STATE_PATH,
    JSON.stringify(
      {
        seenLinks: trimmed,
        postDate,
        postCount,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

/** Returns today's UTC date as "YYYY-MM-DD", used as the daily-cap key. */
export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
