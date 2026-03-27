---
name: fix-scraper
description: This skill should be used when the user asks to "fix scraper", "repair scraper", "correct scraper", "refactor scraper", "update scraper", "add field to scraper", "scraper is broken", "scraper not working", "wrong value in scraper", "field is empty", "field is missing", "add a new field", "field is wrong", "fix parser", "repair parser", "parser is broken", "update parser", or wants to fix, correct, or extend an existing local parser/scraper file.
version: 1.2.0
---

# ScrapeOps — Fix Scraper Skill

This skill fixes or extends an existing local parser file. It handles discovery, confirmation, and HTML preparation — then delegates the iterative fix loop to the `parser-fixer` agent, which runs autonomously until the output is correct.

## Overview

1. Check configuration (API key + backend URL — needed only if HTML must be fetched)
2. **Discovery** — identify parser file, HTML source, and what needs fixing
3. **Confirmation** — show summary and wait for approval
4. **Prepare HTML** — use local file or fetch via ScrapeOps proxy
5. **Fix** — delegate to `parser-fixer` agent (autonomous loop, no fixed iteration limit)
6. **Result** — show final output and summary of changes

---

## Step 0 — Configuration Check

Needed only if HTML will be fetched from a URL. If the user has the HTML locally, skip this step.

**`SCRAPEOPS_API_KEY`** (required for URL fetching):

Check if `$SCRAPEOPS_API_KEY` is set in the environment (the MCP server reads it directly — you never need to pass its value to any tool).

If not set and a URL fetch is needed, stop and show:

```
ScrapeOps API key is not configured.
Run /scrapeops-setup to configure it.
```

The MCP server automatically reads `SCRAPEOPS_API_KEY` and `SCRAPEOPS_API_URL` from the environment. Never pass these values as tool arguments.

---

## Step 1 — Discovery

**Always respond in the same language the user is writing in.**

There are four slots to fill:

| Slot | Description | Required |
|------|-------------|----------|
| `parser_path` | Path to the local parser file | Yes |
| `language` | Programming language | Yes (infer from file extension) |
| `html_source` | Local HTML file path OR URL to fetch | Yes |
| `task` | What to fix or add | Yes |

### Phase A — Scan the directory first (before asking anything)

Before asking any question, use Glob to map what exists in the current working directory:

- **Parser candidates:** `*.py`, `*.js`, `*.ts`, `*.php`, `*.rb`, `*.go`, `*.rs`, `*.java`, `*.cs`
- **HTML candidates:** `*.html`, `*.htm`

Also check the user's message for any explicitly mentioned filenames or URLs.

### Phase B — Fill slots with minimum questions

Resolve each slot in order. Only ask when genuinely ambiguous or missing.

**`parser_path` — resolve in this order:**
1. User named it explicitly → use it
2. User mentioned a partial name → Glob to confirm
3. Exactly 1 parser file found in directory → use it automatically (no question)
4. Multiple parser files found → show the list, ask which one
5. None found → ask for the path

**`html_source` — resolve in this order:**
1. User mentioned a local path → use it
2. User provided a URL (`http://`/`https://`) → fetch via ScrapeOps proxy
3. Exactly 1 `.html`/`.htm` file found in directory → use it automatically (no question)
4. Multiple HTML files found → show the list, ask which one
5. None found → ask: "Do you have an HTML file locally, or should I fetch it from a URL?"

**`language`:** always infer from the parser file extension — never ask:
- `.py` → Python · `.js`/`.ts` → JavaScript · `.php` → PHP · `.rb` → Ruby
- `.go` → Go · `.rs` → Rust · `.java` → Java · `.cs` → C#

**`task` — resolve in this order:**
1. User described the problem → use it
2. Message is vague (e.g. "fix my scraper") → ask: "What specifically needs to be fixed or added?"

**Rule: never ask about something that can be determined from the directory.** Ask only when there is genuine ambiguity (multiple candidates) or a slot is truly missing.

Ask **one thing at a time**, in the user's language.

### 1.1 — Examples

| Directory state | User message | Behavior |
|---|---|---|
| 1 `.py` + 1 `.html` | "o campo price está errado" | Uses both automatically → goes straight to confirmation |
| 1 `.py` + 0 HTML | "corrige o scraper" | Uses the `.py`, asks about HTML source |
| 2 `.py` + 1 `.html` | "fix the scraper" | Asks which `.py`, uses the `.html` automatically |
| 0 parsers + 0 HTML | "fix my scraper" | Asks for the parser file |
| 1 `.py` + 1 `.html` | "fix ebay_scraper.py, price is wrong" | Uses named `.py` + auto `.html` → straight to confirmation |

---

## Step 2 — Confirmation

Once all four slots are filled, show a summary and ask for confirmation.

**If HTML is local:**
```
Here's what I'll work on:

  Parser: ./ebay_scraper.py (Python)
  HTML:   test_page.html (local)
  Task:   Fix field "price" that is coming back empty

Confirm? (Y/N)
```

**If HTML will be fetched:**
```
Here's what I'll work on:

  Parser: ./ebay_scraper.py (Python)
  HTML:   Will be fetched from https://www.ebay.com/itm/123 (via ScrapeOps proxy)
  Task:   Add new field "seller_rating"

Confirm? (Y/N)
```

If the user requests changes, apply them and show the updated summary. Do not proceed to Step 3 until the user explicitly confirms.

---

## Step 3 — Prepare HTML

### If HTML is a local file

Verify the file exists and is readable using Read. If not found, inform the user and ask for the correct path.

### If HTML must be fetched from a URL

Before fetching, verify `SCRAPEOPS_API_KEY` is available (check Step 0 sources). If missing, ask for it and offer to save to `~/.claude/CLAUDE.md`.

Call the **`scrapeops_fetch_html`** MCP tool with:
- `url`: the target URL

Do NOT pass `api_key` or `api_url` — the MCP server reads them from the environment automatically.

The tool returns the raw HTML content directly as text on success, or throws an error on failure.
- On success → use the Write tool to save the content to `fetched_page.html`
- On error → show the error message and stop

```
HTML fetched successfully. Saved to fetched_page.html (<len(html)> bytes).
```

Use `fetched_page.html` as `html_path` for the rest of the skill.

**Critical:** HTML files can be very large (500KB–2MB). Always work with the saved file using Grep and Read with offset+limit. Never load the full HTML content into the conversation context — only write it once with the Write tool.

---

## Step 4 — Fix (delegate to parser-fixer agent)

With `parser_path`, `html_path`, `task`, and `language` ready, delegate to the `parser-fixer` agent:

> "I'll use the parser-fixer agent to diagnose and fix the parser autonomously."

Pass to the agent:
- `parser_path` — path to the parser file
- `html_path` — path to the HTML file (local or fetched)
- `task` — the task description from Step 1.4
- `language` — the language from Step 1.2

The agent runs the full fix loop autonomously — no fixed iteration limit. It stops when either the output is correct or all strategies are exhausted.

---

## Step 5 — Result

Show the result returned by the `parser-fixer` agent.

### If agent returned STATUS: success

```
Parser fixed successfully!

Changes made:
  - Fixed selector for "price": ".price-text" → ".s-item__price"
  - Added field "seller_rating" using selector ".seller-info__rating"

Final output:
  {
    "title": "Apple iPhone 14 Pro",
    "price": "$849.99",
    "seller_rating": "99.8%"
  }

Files updated:
  - ./ebay_scraper.py            (parser)
  - ./ebay_scraper_output.json   (output)
```

### If agent returned STATUS: exhausted

Show the agent's full diagnosis report and ask the user how to proceed:

```
The parser-fixer agent was unable to resolve the issue after exhausting all strategies.

<agent diagnosis report here>

How would you like to proceed?
```

---

## Error Handling

| Situation | Response |
|-----------|----------|
| Parser file not found | Ask for correct path |
| HTML file not found | Ask for correct path or URL |
| HTML fetch fails (API error) | Show error, ask if user has local HTML |
| API key missing for fetch | Ask once, offer to save to CLAUDE.md |
| Agent returns STATUS: exhausted | Show diagnosis, ask user how to proceed |

---

## Important Notes

- **Never load large HTML files fully into context** — write once with Write tool, then use Grep and Read with offset+limit
- **The fix loop runs in the parser-fixer agent** — no iteration limit; it stops when it resolves or exhausts strategies
- The ScrapeOps `/http-fetch` endpoint uses the same proxy and anti-bot bypass as the main pipeline
- The `scrapeops` MCP server is started automatically by the plugin — no manual setup needed
