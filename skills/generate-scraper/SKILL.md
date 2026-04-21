---
name: generate-scraper
description: Use this skill ONLY when the user explicitly asks to generate, build, create, or write a scraper/parser for SPECIFIC URLs they already have. Trigger phrases: "generate scraper", "build scraper", "make scraper", "new scraper", "create a scraper", "write a scraper", "I need a scraper", "generate a scraper for", "build a scraper for", "create scraper for". Do NOT trigger for generic requests like "fetch this page", "download HTML", "get the content of this URL", "scrape this" (without mentioning scraper/parser), or any request that is not specifically about generating a reusable scraper file. IMPORTANT: Do NOT trigger if the user mentions "crawler" anywhere in their request — use the generate-crawler-scraper skill instead. If the request mentions "crawler", "crawler + scraper", "crawler-scraper", "crawl", "search for X on site Y", "busca", "buscando", or describes discovering/collecting product URLs from a listing page, use generate-crawler-scraper, NOT this skill.
version: 2.0.0
---

# ScrapeOps — Generate Scraper Skill

This skill generates production-ready web scrapers using the ScrapeOps AI backend via the `scrapeops` MCP server (auto-started by the plugin — no manual setup needed).

## Overview

1. Collect inputs (URLs, language, library)
2. Submit job via `scrapeops_submit_job` MCP tool
3. Poll until complete via `scrapeops_poll_status` MCP tool
4. Download code if needed and save the file

> **API key handling:** The MCP server reads `SCRAPEOPS_API_KEY` from `~/.claude/settings.json` automatically. Do NOT check or validate it before making tool calls. If a MCP tool call fails with "SCRAPEOPS_API_KEY is not configured", handle it inline:
> 1. Ask the user: "Enter your ScrapeOps API key (find it at https://scrapeops.io/app/dashboard):"
> 2. Read `~/.claude/settings.json`, add the key to `env.SCRAPEOPS_API_KEY` using Edit, and retry the failed tool call
> 3. Do NOT tell the user to run `/scrapeops-setup` or restart — just ask, save, and continue

---

## Step 1 — Collect Inputs

| Slot | Required |
|------|----------|
| `urls` | Yes — use from user's message or ask |
| `language` | Yes — always ask if not explicitly provided |
| `library` | Yes — always ask if not explicitly provided |
| `country` | No — skip if not mentioned |

**Rule: never assume language or library.** Ask one at a time using `AskUserQuestion`. Only skip a question if the user already stated that value clearly.

### 1.1 — Ask language (if not provided)

```
question: "Which language do you want the scraper in?"
header: "Language"
options:
  - label: "Python"
  - label: "JavaScript"
  - label: "PHP"
  - label: "Other"
    description: "Ruby, Go, Rust, Java, C#"
```

### 1.2 — Ask library (if not provided)

**Python:**
```
question: "Which Python library?"
header: "Library"
options:
  - label: "BeautifulSoup"
    description: "requests + beautifulsoup4 — most common"
  - label: "Playwright"
    description: "For JavaScript-rendered pages"
  - label: "Selenium"
    description: "Browser automation"
```

**JavaScript:**
```
question: "Which JavaScript library?"
header: "Library"
options:
  - label: "Cheerio"
    description: "axios + cheerio — most common"
  - label: "Playwright"
    description: "For JavaScript-rendered pages"
  - label: "Puppeteer"
    description: "Browser automation"
```

**PHP / Ruby / Go / Rust / Java / C#:** use `AskUserQuestion` with the options from `references/languages.md`.

### 1.3 — URLs (if not provided)

If the user didn't include a URL, ask: "Paste 1–5 URLs from the target website (must be from the same domain)."

### 1.4 — Map to API values

Use `references/languages.md` to map language + library selections to the correct `target_language` and `target_library` API values.

---

## Step 2 — Confirmation

Show a summary and confirm before submitting. You MUST use this EXACT format every time — do not rephrase, reorder, or use a different layout:

```
Now let me confirm before submitting:

Here's what I'll generate:

| Field      | Value                          |
|------------|--------------------------------|
| **URL(s)** | <url1>, <url2>, ...            |
| **Language**| <language>                    |
| **Library** | <library>                     |
| **Country** | <country or "not set">        |
```

Then ask for confirmation using AskUserQuestion:

```
question: "Does everything look correct?"
header: "Confirm"
options:
  - label: "Yes, generate it"
  - label: "No, change something"
```

If "No, change something" → ask what to change and loop back.

---

## Step 3 — Submit the Job

Call the **`scrapeops_submit_job`** MCP tool with:
- `urls`: array of URLs
- `target_language`: from Step 1.4
- `target_library`: from Step 1.4

Do NOT pass `api_key` or `api_url` — the MCP server reads them from the environment automatically.

The tool returns a JSON object. Read `version_id` from it. If missing, show the full response and stop:
```
Failed to submit scraper job. Please check your API key and backend URL.
```

Otherwise confirm:
```
Job submitted (ID: <version_id>). Waiting for generation...
```

---

## Step 4 — Poll for Completion

Call **`scrapeops_poll_status`** MCP tool with:
- `version_id`

Do NOT pass `api_key` or `api_url` — the MCP server reads them from the environment automatically.

The tool waits 30 seconds internally before making the request — no sleep needed on your side.

After each call:
- Show: `[Poll #N] <_summary field from response>`
- `status = "completed"` → proceed to Step 5
- `status = "error"` → show `error_message` and stop
- Any other status (`queued`, `processing`, `running`) → call `scrapeops_poll_status` again

**No maximum attempts** — keep polling until `completed` or `error`.

**CRITICAL: Never proceed based on the presence of `output_code` or `link_output_code` alone. The backend saves code to the database BEFORE the job is finished — a post-processing agent may still be running. You MUST wait until `status = "completed"`. Proceeding early produces incomplete or unvalidated code.**

**Response fields:**
- `status` — `queued`, `processing`, `running`, `completed`, `error`
- `_summary` — human-readable status line (added by MCP server)
- `output_code` — may be present even when status is still `processing` — do NOT use this as a completion signal
- `link_output_code` — download URL if `output_code` is empty — same caveat applies
- `install_command` — package install command
- `language`, `library` — language/library used

---

## Step 5 — Retrieve the Generated Code

The last `scrapeops_poll_status` response contains the code. Check:

1. If `output_code` is non-empty → use it directly
2. If `output_code` is empty but `link_output_code` is present → call **`scrapeops_download_code`** MCP tool with `url: <link_output_code>`; the tool returns the raw code content directly as text

---

## Step 6 — Install Dependencies

If `install_command` is non-empty and the language is Python or JavaScript, show the command and ask for confirmation before running it via Bash.

---

## Step 7 — Save the Scraper File

Determine the base name from the first URL domain:
- `books.toscrape.com` → `books_toscrape_com`

Filenames:
- Scraper: `<domain>_scraper.<ext>` (`.py` for Python, `.js` for JavaScript)
- HTML:    `<domain>_page.html`
- Output:  `<domain>_scraper_output.json`

Save the scraper using the Write tool (not echo or heredoc).

---

## Step 8 — Download and Save the HTMLs

The completed job response contains a `urls` array (up to 5 entries). Each entry has a `html_link` pointing to the HTML used during generation.

Create a subdirectory named `<domain>_data/` to store all HTMLs and outputs.

For **each** entry in `urls` (indexed 1, 2, 3…):
1. Call **`scrapeops_download_code`** with `url: <urls[i].html_link>`
   - **Always use `scrapeops_download_code` here — never `scrapeops_fetch_html`.** The `html_link` is a direct storage URL (Digital Ocean), not a page to re-fetch.
2. The tool returns the raw HTML content directly as text — save it as-is to `<domain>_data/page_<N>.html` using the Write tool

If an entry has no `html_link`, skip it and note in the final summary.

---

## Step 9 — Run the Parser Against Each HTML and Save Outputs

For **each** HTML file saved in Step 8, run the parser and save the output inside the same `<domain>_data/` folder:

**Python:**
```bash
python3 <domain>_scraper.py <domain>_data/page_<N>.html
```

**JavaScript:**
```bash
node <domain>_scraper.js <domain>_data/page_<N>.html
```

Save each output (if valid JSON) to `<domain>_data/output_<N>.json`.

If a run fails or produces no output, show the error but continue to the next HTML.

---

## Step 10 — Final Summary

Show:
```
Scraper generated successfully!

Files saved:
  <domain>_scraper.<ext>
  <domain>_data/
    page_1.html + output_1.json
    page_2.html + output_2.json   (if applicable)
    …

Language: <language> / <library>
Job ID: <version_id>

To run again:
  python3 <domain>_scraper.py <domain>_data/page_1.html
```

Display each output JSON inline so the user can review the extracted fields.

---

## Error Handling

| Situation | Response |
|-----------|----------|
| Missing API key | Stop: `Run /scrapeops-setup to configure it.` |
| submit_job returns error | Show full response, stop |
| poll_status returns error status | Show `error_message`, stop |
| `output_code` and `link_output_code` both empty | Show warning + raw response |

---

## Important Notes

- The `scrapeops` MCP server is started automatically by the plugin — no manual setup
- `parser_only: true` is always set (generates HTML parser without HTTP client)
- All URLs must be from the same domain — the backend validates this
- Maximum 5 URLs per job
