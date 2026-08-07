# Inanna / Ishtar News Bot

Watches Google News for coverage of the goddess Inanna/Ishtar, filters out
false positives (the 1987 Warren Beatty film, unrelated people/places/products
named Ishtar or Inanna, etc.) using Claude, and posts genuine hits to a
Discord channel as gold embeds.

Runs the same way as the prayer bot: free via GitHub Actions cron, no server
to maintain.

## How it works

1. **`fetchNews.js`** — queries Google News RSS for a few search terms
   ("Inanna", "Ishtar goddess", "Ishtar Mesopotamian") and merges/dedupes the
   results by link.
2. **`state.js`** — loads/saves `state.json`, a small list of article links
   already seen, so the same story doesn't get reposted every run.
3. **`classify.js`** — sends unseen article titles/snippets to Claude in one
   batched call and gets back a relevant/not-relevant verdict with a short
   reason for each, so the film and homonym noise gets filtered before
   anything reaches Discord.
4. **`postToDiscord.js`** — posts each relevant article as a gold embed via
   your Discord webhook.
5. **`index.js`** — ties it all together; this is what actually runs.
6. **`.github/workflows/news-bot.yml`** — runs `index.js` every 6 hours via
   GitHub Actions and commits the updated `state.json` back to the repo so
   state persists between runs.

## Setup

1. **Create a private GitHub repo** and push these files to it.

2. **Add two repository secrets** (Settings → Secrets and variables →
   Actions → New repository secret):
   - `ANTHROPIC_API_KEY` — your Anthropic API key
   - `DISCORD_WEBHOOK_URL` — the webhook URL for the Discord channel you want
     posts to land in (Channel Settings → Integrations → Webhooks → New
     Webhook → Copy URL)

3. **Enable Actions** on the repo if it's not on by default (Settings →
   Actions → General → Allow all actions).

4. That's it — the workflow will run automatically every 6 hours. You can
   also trigger a run manually from the Actions tab (`workflow_dispatch`) to
   test it right away without waiting for the schedule.

## Local testing

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
export DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
npm start
```

## Tuning

- **Schedule**: change the `cron` line in the workflow file. `"0 */6 * * *"`
  is every 6 hours; `"0 */3 * * *"` would be every 3 hours, etc.
- **Search terms**: edit `SEARCH_TERMS` in `fetchNews.js` if you want to
  broaden or narrow coverage (e.g. add "Sumerian goddess" or "Qadishtu").
- **Filtering strictness**: the classification rules live in the
  `SYSTEM_PROMPT` in `classify.js` — edit that text directly to loosen or
  tighten what counts as relevant.
- **Model**: `classify.js` uses `claude-sonnet-5` by default; swap the
  `MODEL` constant if you'd rather use a different Claude model.
- **State window**: `state.js` keeps the most recent 500 seen links to keep
  `state.json` small forever; raise `MAX_TRACKED_LINKS` if you want a longer
  memory.
