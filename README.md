# Inanna / Ishtar News Bot

This bot watches Google News for substantive coverage of the Mesopotamian
goddess Inanna/Ishtar. It resolves publisher pages, extracts article evidence,
applies a conservative relevance/credibility/quality policy with Claude, ranks
accepted work, and posts at most two items per UTC day to Discord.

It runs on a six-hour GitHub Actions schedule and persists its delivery state in
`state.json`; no server is required.

## Editorial policy

An article must pass one of two acceptance paths:

- **Academic or historical coverage:** legitimate scholarship, named scholars,
  universities, museums, archaeological institutions, academic publishers,
  excavations, catalogued artifacts, responsible translations, or careful
  journalism accurately grounded in those sources.
- **Contemporary liturgical or devotional work:** an attributable modern prayer,
  hymn, ritual, devotional essay, reconstruction, performance, or living
  practice that is honestly presented as contemporary interpretation.

The bot hard-rejects material that promotes conspiracy theories,
pseudoarchaeology, pseudohistory, ancient-aliens claims, fabricated artifacts or
translations, "suppressed history," racialist mythology, unverifiable
content-farm claims, or modern inventions falsely presented as ancient texts.
Religious and poetic language is not treated as crank content when it is clearly
framed as faith, ritual, metaphor, or contemporary creative work.

Other rejection categories cover irrelevant homonyms, shallow/clickbait work,
and insufficient evidence. Uncertainty fails closed: an item is not posted when
the available source and article text cannot establish credibility.

Claude returns structured classifications with relevance, credibility,
substance, quality, and confidence scores. Deterministic thresholds are applied
after classification, so a weak model acceptance cannot bypass the editorial
floor. Accepted articles are ranked by quality, credibility, substance, and
freshness; similar headlines and canonical URLs are grouped as one story.

## Processing and delivery lifecycle

1. `fetchNews.js` queries three Google News RSS searches, discards malformed,
   future-dated, and stale results, deduplicates links, and sorts newest-first.
2. `enrichArticles.js` resolves Google News links to publisher URLs and extracts
   page title, author, publication metadata, and up to 6,000 characters of
   article evidence. Private/local network targets are rejected.
3. `classify.js` sends batches to Claude Sonnet 5 using a JSON-schema structured
   output and validates every returned index and score locally.
4. `editorial.js` applies the deterministic acceptance floor, ranks accepted
   work, and clusters duplicate coverage.
5. `postToDiscord.js` posts the best pending articles as gold embeds using the
   publisher URL.
6. `state.js` atomically stores completed links, accepted pending articles, and
   the UTC daily-post counter.

Rejected articles are marked finished. Accepted articles remain pending until a
Discord post succeeds. Items beyond the daily quota and transiently failed posts
remain pending for later runs rather than being silently lost. State is saved
before delivery and after each confirmed post.

## Setup

1. Create a private GitHub repository and add these files.
2. For a brand-new bot or Discord channel, clear the included operational
   history before the first push:

   ```bash
   npm ci
   npm run reset-state
   ```

   Do not reset state when upgrading an existing deployment; its seen and
   pending records prevent duplicate Discord posts.
3. Add two repository Actions secrets under **Settings → Secrets and variables
   → Actions**:

   - `ANTHROPIC_API_KEY`
   - `DISCORD_WEBHOOK_URL`

4. Enable GitHub Actions. The workflow runs every six hours and can also be run
   manually with `workflow_dispatch`.

The workflow serializes runs, executes the automated tests, runs the bot, and
commits `state.json` even when a later bot operation fails. Dependency versions
are locked and installed with `npm ci`.

## Local checks

```bash
npm ci
npm run check
npm test
```

To run the real bot locally:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
npm start
```

This performs real Anthropic API calls and may post to Discord.

## Configuration

- **Schedule:** edit the cron expression in `.github/workflows/news-bot.yml`.
- **Daily limit:** edit `DAILY_POST_LIMIT` in `index.js`.
- **Search terms:** edit `SEARCH_TERMS` in `fetchNews.js`.
- **Recency:** set `MAX_ARTICLE_AGE_DAYS`; the default is 45 days.
- **Editorial policy:** edit `SYSTEM_PROMPT` and the structured decision schema in
  `classify.js`, plus deterministic thresholds in `editorial.js`.
- **Model:** edit `MODEL` in `classify.js`.
- **Seen-link window:** edit `MAX_TRACKED_LINKS` in `state.js`.

Publisher pages that cannot be resolved are deferred for a future run. Pages
that resolve but block extraction may still be assessed from publisher
provenance and RSS metadata, but the conservative policy normally rejects them
when that evidence is insufficient.

Discord webhooks do not provide an idempotency key. The bot minimizes duplicate
risk through serialized runs and immediate atomic state saves, but a network
timeout occurring after Discord accepts a message can never be distinguished
perfectly from a failed delivery.
