---
name: scrapeops-setup
description: Configure the ScrapeOps plugin. Use when the user asks to "configure scrapeops", "setup scrapeops", "set api key", "set scrapeops key", "scrapeops config", or when a ScrapeOps skill reports that the API key is missing.
argument-hint: [api_key]
version: 3.0.0
---

# ScrapeOps — Setup Skill

Configures the ScrapeOps plugin by saving the API key to `~/.claude/settings.json` as an environment variable. Claude Code injects this automatically into every session.

---

## Step 1 — Check current configuration

Read `~/.claude/settings.json` with the Read tool and check if `env.SCRAPEOPS_API_KEY` exists.

**If already configured**, show:
```
ScrapeOps is already configured.

  API Key: <first 8 chars>••••••••
  Backend: <SCRAPEOPS_API_URL value or "https://parser.scrapeops.io (default)">

To update the key, run: /scrapeops-setup <new_api_key>
```
Then stop.

---

## Step 2 — Get the API key

**If an `api_key` argument was passed** (e.g. `/scrapeops-setup abc123`), use it directly — skip asking.

**If the key is missing**, ask:
```
Enter your ScrapeOps API key (find it at https://scrapeops.io/app/dashboard):
```

---

## Step 3 — Save to ~/.claude/settings.json

Read `~/.claude/settings.json` with the Read tool.

The file may or may not have an `env` section. Add or update `SCRAPEOPS_API_KEY` inside `env`:

```json
{
  "env": {
    "SCRAPEOPS_API_KEY": "<the_api_key>"
  }
}
```

Use the Edit tool to make the change. Preserve all other existing keys — only touch `SCRAPEOPS_API_KEY`.

If `~/.claude/settings.json` does not exist, create it with the Write tool:
```json
{
  "env": {
    "SCRAPEOPS_API_KEY": "<the_api_key>"
  }
}
```

---

## Step 4 — Confirm

Show:
```
✓ ScrapeOps configured successfully!

  API Key: <first 8 chars>••••••••
  Backend: https://parser.scrapeops.io (default)

You can now use /generate-scraper, /fix-scraper, and /generate-crawler-scraper.
```

---

## Notes

- The API key is stored in `~/.claude/settings.json` under `env.SCRAPEOPS_API_KEY`. Claude Code injects it as an environment variable automatically — no manual MCP setup needed.
- To use a local backend (developers only), manually add `SCRAPEOPS_API_URL` to the `env` section in `~/.claude/settings.json`.
- The MCP server (`mcp-server/index.js`) has zero dependencies and starts automatically — no `npm install` needed.
