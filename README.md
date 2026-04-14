# ScrapeOps AI Scraper Builder — Claude Code Plugin

Generate and fix production-ready web scrapers for any website using AI, directly from Claude Code.

---

## What it does

- **`/generate-scraper`** — Tell Claude which website you want to scrape. It handles everything: fetches the page, analyzes the structure, generates the parser, runs it, and saves the output locally.
- **`/fix-scraper`** — Have a broken scraper? Point Claude at your parser file and an HTML page. It diagnoses the issue, fixes the selectors, and validates the output — autonomously, without you writing a single line.

**Supported languages:** Python (BeautifulSoup, Playwright, Selenium), JavaScript (Cheerio, Playwright, Puppeteer), PHP, Ruby, Go, Rust, Java, C#.

---

## Prerequisites

Before installing, make sure you have:

- **Claude Code** — [Install here](https://claude.ai/code) if you haven't already
- **Node.js 18 or later** — [Download here](https://nodejs.org)
- **A ScrapeOps API key** — [Get your free key here](https://scrapeops.io/app/register/beta)

---

## Installation

### Step 1 — Clone the repository

```bash
git clone https://github.com/ScrapeOps/scrapeops-scraping-assistant-claude-plugin.git
cd scrapeops-scraping-assistant-claude-plugin
```

### Step 2 — Run the setup script

```bash
./setup.sh
```

This installs the skills, agents, and MCP server into your Claude Code configuration.

### Step 3 — Restart Claude Code

Close and reopen Claude Code to activate everything.

### Step 4 — Start using

Open Claude Code and run `/generate-scraper` or `/fix-scraper`. If your API key isn't configured yet, Claude will ask for it automatically on the first run — no extra setup step needed. Your key is saved locally in `~/.claude/settings.json` and never leaves your machine.

You can also configure or update your key at any time with `/scrapeops-setup`.

---

## Usage

### Generate a scraper

```
/generate-scraper
```

Claude will ask you:
1. The URL (or URLs) you want to scrape
2. Which language you want (Python, JavaScript, etc.)
3. Which library (BeautifulSoup, Cheerio, etc.)

Then it submits the job, waits for the AI pipeline to finish, downloads the generated parser, runs it against the real page, and saves everything locally.

**Example conversation:**

```
You:    /generate-scraper
Claude: Which language do you want the scraper in?
You:    Python
Claude: Which Python library?
You:    BeautifulSoup
Claude: Paste 1–5 URLs from the target website.
You:    https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html
Claude: [generates and saves books_toscrape_com_scraper.py + test HTML + output JSON]
```

**Files saved after generation:**

| File | Description |
|------|-------------|
| `<domain>_scraper.py` | The generated parser |
| `<domain>_data/page_1.html` | The HTML used during generation |
| `<domain>_data/output_1.json` | The extracted data |

### Fix a scraper

```
/fix-scraper
```

Claude scans your current directory for parser and HTML files, asks what needs fixing, and runs an autonomous fix loop until the output is correct.

**Example conversation:**

```
You:    /fix-scraper — the price field is coming back empty
Claude: Found books_toscrape_com_scraper.py and page_1.html. I'll fix the price field.
        [diagnoses, edits selectors, re-runs, validates]
        Done. Price is now extracted correctly.
```

Claude can also fetch a live page if you don't have an HTML file locally — just provide the URL.

---

## Tips

- **Multiple URLs:** You can provide up to 5 URLs from the same domain. The pipeline uses all of them to generate a more robust parser.
- **JS-rendered pages:** Choose Playwright or Selenium/Puppeteer if the page loads content via JavaScript (React, Vue, Angular apps). Use BeautifulSoup/Cheerio for static HTML.
- **Fix vs regenerate:** Use `/fix-scraper` when a specific field is wrong or empty. Use `/generate-scraper` again if the page layout changed significantly.
- **Check your key:** Run `/scrapeops-setup` at any time to see your current configuration or update your API key.

---

## Update

To update to the latest version:

```bash
cd /path/to/scrapeops-scraping-assistant-claude-plugin

# 1. Uninstall the old version
./setup.sh --uninstall

# 2. Pull the latest changes
git pull origin main

# 3. Reinstall
./setup.sh

# 4. Restart Claude Code
```

Your API key in `~/.claude/settings.json` is preserved — no need to reconfigure.

You can also run it as a single command:

```bash
./setup.sh --uninstall && git pull origin main && ./setup.sh
```

---

## Uninstall

To remove ScrapeOps from Claude Code:

```bash
cd scrapeops-scraping-assistant-claude-plugin
./setup.sh --uninstall
```

This removes the skills, agents, and MCP server registration. Your API key in `~/.claude/settings.json` is not removed.

---

## Troubleshooting

**"ScrapeOps API key is not configured"**
Claude will ask for your key automatically. Just paste it when prompted. You can also run `/scrapeops-setup` manually.

**"The API key you sent is invalid"**
Your key may have been copied incorrectly. Run `/scrapeops-setup <your-api-key>` to reset it directly.

**The scraper runs but fields are empty**
Use `/fix-scraper` — describe which field is wrong and Claude will diagnose and fix it autonomously.

**The job is taking a long time**
The pipeline fetches the page, analyzes it with AI, generates code, and validates the output. Complex pages can take 10-15 minutes. Claude will keep polling and show progress updates.

---

## Privacy & Security

- Your API key is stored locally in `~/.claude/settings.json` on your machine.
- Page content is sent to the ScrapeOps backend for processing (same as using the ScrapeOps web app).

---

## Support

- **Docs:** [scrapeops.io/docs/ai-scraper-builder/overview](https://scrapeops.io/docs/ai-scraper-builder/overview/)
- **Issues:** Open an issue on this repository
- **Email:** support@scrapeops.io
