import fetch from "node-fetch";

const GOLD = 0xd4af37; // matches the prayer bot's embed color

/**
 * Post one article as a Discord embed via webhook.
 */
export async function postArticle(article) {
  const embed = {
    title: article.title.slice(0, 256),
    url: article.link,
    color: GOLD,
    description: article.snippet ? article.snippet.slice(0, 300) : undefined,
    footer: { text: article.source || "Google News" },
    timestamp: article.pubDate ? new Date(article.pubDate).toISOString() : undefined,
  };

  const res = await fetch((process.env.DISCORD_WEBHOOK_URL || "").trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook error ${res.status}: ${text}`);
  }

  // Discord webhook rate limit is gentle but let's be polite between posts
  await new Promise((r) => setTimeout(r, 1200));
}
