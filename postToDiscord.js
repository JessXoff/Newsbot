import { fetchWithRetry } from "./http.js";

const GOLD = 0xd4af37; // matches the prayer bot's embed color

/**
 * Post one article as a Discord embed via webhook.
 */
export async function postArticle(
  article,
  {
    fetchImpl = globalThis.fetch,
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = {}
) {
  const published = Date.parse(article.pubDate || "");
  const embed = {
    title: article.title.slice(0, 256),
    url: article.publisherLink || article.link,
    color: GOLD,
    description: article.snippet ? article.snippet.slice(0, 300) : undefined,
    footer: { text: (article.source || "Google News").slice(0, 2048) },
    timestamp: Number.isFinite(published) ? new Date(published).toISOString() : undefined,
  };

  const webhook = new URL((process.env.DISCORD_WEBHOOK_URL || "").trim());
  webhook.searchParams.set("wait", "true");
  const res = await fetchWithRetry(
    webhook,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    },
    { fetchImpl, timeoutMs: 15_000, attempts: 3, baseDelayMs: 1000 }
  );

  if (!res.ok) {
    const text = (await res.text()).slice(0, 2000);
    throw new Error(`Discord webhook error ${res.status}: ${text}`);
  }

  await wait(1200);
}
