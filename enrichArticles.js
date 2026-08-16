import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import decoderPackage from "google-news-url-decoder";
import { load } from "cheerio";
import { fetchWithRetry } from "./http.js";

const { GoogleDecoder } = decoderPackage;
const ARTICLE_TIMEOUT_MS = 15_000;
const DECODE_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_EXCERPT_CHARACTERS = 6_000;

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(address) {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}

export function isSafeArticleUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }

    return !isIP(hostname) || !isPrivateIp(hostname);
  } catch {
    return false;
  }
}

async function assertPublicUrl(value, resolver = lookup) {
  if (!isSafeArticleUrl(value)) throw new Error("Unsafe article URL");

  const url = new URL(value);
  if (isIP(url.hostname)) return url;

  const addresses = await resolver(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Article hostname does not resolve exclusively to public addresses");
  }

  return url;
}

async function readTextWithLimit(response, maximumBytes = MAX_HTML_BYTES) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new Error(`Article response exceeds ${maximumBytes} bytes`);
  }

  if (!response.body) return "";

  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumBytes) {
      throw new Error(`Article response exceeds ${maximumBytes} bytes`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function fetchArticlePage(
  initialUrl,
  { fetchImpl = globalThis.fetch, resolver = lookup } = {}
) {
  let currentUrl = await assertPublicUrl(initialUrl, resolver);

  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetchWithRetry(
      currentUrl,
      {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
          "User-Agent":
            "Inanna-Ishtar-News-Bot/2.0 (+automated editorial monitor)",
        },
      },
      { fetchImpl, timeoutMs: ARTICLE_TIMEOUT_MS, attempts: 3 }
    );

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} had no Location header`);
      currentUrl = await assertPublicUrl(new URL(location, currentUrl), resolver);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Article fetch returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error(`Unsupported article content type: ${contentType}`);
    }

    return {
      html: await readTextWithLimit(response),
      finalUrl: currentUrl.toString(),
    };
  }

  throw new Error("Article exceeded the redirect limit");
}

function firstValue($, selectors, attribute = "content") {
  for (const selector of selectors) {
    const value = $(selector).first().attr(attribute)?.trim();
    if (value) return value;
  }
  return null;
}

function paragraphText($, selector) {
  const paragraphs = [];
  const seen = new Set();

  $(selector).each((_, element) => {
    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (text.length < 40 || seen.has(text)) return;
    seen.add(text);
    paragraphs.push(text);
  });

  return paragraphs.join("\n\n");
}

export function extractArticleData(html, pageUrl) {
  const $ = load(html);
  $("script, style, noscript, svg, nav, footer, form, aside").remove();

  const candidates = [
    paragraphText($, "article p"),
    paragraphText($, "main p"),
    paragraphText($, '[role="main"] p'),
    paragraphText($, "body p"),
  ];
  const text = candidates.sort((a, b) => b.length - a.length)[0] || "";

  const canonicalHref = $("link[rel='canonical']").first().attr("href");
  let canonicalUrl = pageUrl;
  if (canonicalHref) {
    try {
      const candidate = new URL(canonicalHref, pageUrl).toString();
      if (isSafeArticleUrl(candidate)) canonicalUrl = candidate;
    } catch {
      // Keep the fetched page URL when a site publishes a malformed canonical.
    }
  }

  return {
    canonicalUrl,
    pageTitle:
      firstValue($, ["meta[property='og:title']", "meta[name='twitter:title']"]) ||
      $("title").first().text().replace(/\s+/g, " ").trim() ||
      null,
    author: firstValue($, [
      "meta[name='author']",
      "meta[property='article:author']",
      "meta[name='byl']",
    ]),
    pagePublishedAt: firstValue($, [
      "meta[property='article:published_time']",
      "meta[name='date']",
      "meta[name='pubdate']",
      "meta[itemprop='datePublished']",
    ]),
    excerpt: text.slice(0, MAX_EXCERPT_CHARACTERS),
    contentStatus: text.length >= 400 ? "ok" : "thin",
  };
}

function withTimeout(promise, milliseconds, message) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timeout));
}

export async function enrichArticle(
  article,
  {
    decoder = new GoogleDecoder(),
    fetchPage = fetchArticlePage,
    fetchImpl = globalThis.fetch,
    resolver = lookup,
  } = {}
) {
  let decoded;
  try {
    decoded = await withTimeout(
      decoder.decode(article.link),
      DECODE_TIMEOUT_MS,
      "Google News URL decoding timed out"
    );
  } catch (error) {
    return {
      ...article,
      publisherLink: null,
      excerpt: "",
      enrichmentStatus: "decode_failed",
      enrichmentError: error.message,
    };
  }

  if (!decoded?.status || !isSafeArticleUrl(decoded.decoded_url)) {
    return {
      ...article,
      publisherLink: null,
      excerpt: "",
      enrichmentStatus: "decode_failed",
      enrichmentError: decoded?.message || "Google News URL could not be decoded safely",
    };
  }

  try {
    const { html, finalUrl } = await fetchPage(decoded.decoded_url, {
      fetchImpl,
      resolver,
    });
    const extracted = extractArticleData(html, finalUrl);
    return {
      ...article,
      ...extracted,
      publisherLink: extracted.canonicalUrl || finalUrl,
      enrichmentStatus: extracted.contentStatus,
    };
  } catch (error) {
    return {
      ...article,
      publisherLink: decoded.decoded_url,
      excerpt: "",
      contentStatus: "unavailable",
      enrichmentStatus: "partial",
      enrichmentError: error.message,
    };
  }
}

export async function enrichArticles(articles, options = {}) {
  const concurrency = Math.max(1, options.concurrency || 3);
  const results = new Array(articles.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < articles.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await enrichArticle(articles[index], options);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, articles.length) }, () => worker())
  );
  return results;
}
