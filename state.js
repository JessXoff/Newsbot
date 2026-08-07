import { readFile, writeFile } from "fs/promises";

const STATE_PATH = new URL("./state.json", import.meta.url);
const MAX_TRACKED_LINKS = 500; // keep the file small; oldest links roll off

export async function loadSeenLinks() {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return new Set(parsed.seenLinks || []);
  } catch {
    return new Set();
  }
}

export async function saveSeenLinks(seenLinksSet) {
  const links = Array.from(seenLinksSet);
  const trimmed = links.slice(Math.max(0, links.length - MAX_TRACKED_LINKS));
  await writeFile(
    STATE_PATH,
    JSON.stringify({ seenLinks: trimmed, updatedAt: new Date().toISOString() }, null, 2)
  );
}
