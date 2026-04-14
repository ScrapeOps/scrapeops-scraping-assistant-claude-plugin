---
name: fix-scraper
description: Use this skill when the user wants to fix, correct, update, refactor, or extend an existing local scraper or parser file. This includes adding, removing, or changing fields/selectors in a scraper. Trigger when the user says things like "fix scraper", "repair scraper", "update scraper", "add field", "add a new field", "add X field to the scraper", "field is empty", "field is missing", "field is wrong", "scraper is broken", "scraper not working", "fix parser", "parser is broken", "change the selector", "extract X too", "also scrape X", "adicione um campo", or any request to modify an existing scraper/parser file — in any language.
version: 1.4.0
---

# ScrapeOps — Fix Scraper Skill

This skill fixes or extends an existing local scraper/parser file. It classifies the issue as **parser** (data extraction), **crawler** (navigation/pagination), or **both** — and routes each to the appropriate fix method.

## Overview

1. **Discovery** — identify file, HTML source, what needs fixing, and **classify the issue type**
2. **Confirmation** — show summary and wait for approval
3. **Prepare HTML** — use local files or fetch via ScrapeOps proxy (parser issues only)
4. **Fix** — route to server-side agent (parser) or local edit (crawler)
5. **Result** — write fixed code locally and show summary of changes

> **API key handling:** The MCP server reads `SCRAPEOPS_API_KEY` from `~/.claude/settings.json` automatically. Do NOT check or validate it before making tool calls. If a MCP tool call fails with "SCRAPEOPS_API_KEY is not configured", handle it inline:
> 1. Ask the user: "Enter your ScrapeOps API key (find it at https://scrapeops.io/app/dashboard):"
> 2. Read `~/.claude/settings.json`, add the key to `env.SCRAPEOPS_API_KEY` using Edit, and retry the failed tool call
> 3. Do NOT tell the user to run `/scrapeops-setup` or restart — just ask, save, and continue

---

## Step 1 — Discovery

**Always respond in the same language the user is writing in.**

There are five slots to fill:

| Slot | Description | Required |
|------|-------------|----------|
| `parser_path` | Path to the local parser file | Yes |
| `language` | Programming language | Yes (infer from file extension) |
| `html_source` | Local HTML file(s) OR URLs to fetch | Yes (parser issues only) |
| `task` | What to fix or add | Yes |
| `issue_type` | `parser`, `crawler`, or `both` | Yes (classify automatically) |

### Phase A — Scan the directory

Before asking any question, use Glob to map what exists:

- **Parser candidates:** `**/*.py`, `**/*.js`, `**/*.ts`, `**/*.php`, `**/*.rb`, `**/*.go`, `**/*.rs`, `**/*.java`, `**/*.cs`
- **HTML candidates:** `**/*.html`, `**/*.htm`
- **Output files:** `**/*.csv`, `**/*.jsonl`

If the user mentions a CSV/JSONL file, read it immediately with the Read tool.

### Phase B — Fill slots

**`parser_path`:**
1. User named it explicitly → use it
2. Exactly 1 parser file found → use it automatically
3. Multiple found → ask which one
4. None found → ask for the path

**`html_source`:**

First, determine if this is a **multi-URL scraper** — a scraper that processes many pages (Scrapy spider, CSV/JSONL output with multiple rows, URL lists in code).

**If multi-URL scraper with CSV/JSONL output:**
1. Read the CSV/JSONL file
2. Extract up to 5 product IDs or URLs from rows where broken fields are empty
3. Look at the scraper code to understand the URL pattern (e.g., `https://www.amazon.com/dp/{asin}`)
4. Build the full URLs
5. These will be fetched in Step 3 — do not ask the user about HTML

**Otherwise (single-URL parser):**
1. User mentioned a local path → use it
2. User provided a URL → fetch via ScrapeOps proxy
3. Exactly 1 `.html` file found → use it automatically
4. Multiple HTML files found → use all of them
5. None found → ask: "Do you have an HTML file locally, or should I fetch it from a URL?"

**`language`:** infer from file extension — never ask.

**`task`:**
1. User described the problem → use it
2. Message is vague → ask: "What specifically needs to be fixed or added?"

**`issue_type`:** Classify automatically by reading the parser code and analyzing the user's task. **Always read the parser file before classifying.**

**Parser issue** — problems with data extraction from a single HTML page:
- Wrong/missing CSS selectors or XPath expressions
- Field returns empty, wrong value, or incorrect format
- Data transformation/cleaning bugs
- Adding new fields to extract from existing pages
- JSON/regex parsing errors
- Keywords: "field is empty", "wrong price", "add field", "selector broken", "extract X"

**Crawler issue** — problems with navigation, URL discovery, or request flow:
- Pagination not working (next page, infinite scroll)
- Not following links to detail pages
- Wrong `start_urls` or URL patterns
- Request scheduling, rate limiting, concurrency issues
- Login/authentication flow (multi-step)
- Middleware, proxy rotation, retry logic
- `yield scrapy.Request()` or equivalent navigation logic
- Keywords: "pagination broken", "only scrapes first page", "not following links", "stops after page 1", "add pagination", "login flow"

**Both** — the user's request includes parser AND crawler issues:
- "pagination breaks after page 3 AND price field is empty"
- "add next page support AND extract review count"

If uncertain, default to `parser`. If the task clearly involves navigation/crawling logic, classify as `crawler`.

### Examples

| Directory state | User message | Issue type | Behavior |
|---|---|---|---|
| 1 `.py` + 1 `.html` | "price is wrong" | `parser` | Uses both → server-side fix |
| 1 `.py` + 0 HTML | "fix scraper" | `parser` | Uses `.py`, asks about HTML |
| Scrapy `.py` + `.csv` | "price is empty in CSV" | `parser` | Reads CSV → extracts 5 URLs → server-side fix |
| 1 `.py` + 5 `.html` | "fix price" | `parser` | Uses `.py` + all 5 HTMLs → server-side fix |
| Scrapy `.py` | "pagination stops after page 2" | `crawler` | Reads code → fixes navigation locally |
| Scrapy `.py` | "add next page support" | `crawler` | Reads code → adds pagination locally |
| Scrapy `.py` + `.csv` | "price empty AND only first page scraped" | `both` | Fixes crawler locally first → then sends parser to server |

---

## Step 2 — Confirmation

Show a summary and ask for confirmation. Include the issue type and how it will be handled.

**Parser issue (server-side fix):**
```
Here's what I'll work on:

  Parser: ./scraper.py (Python)
  HTML:   page.html (local)
  Type:   Parser (data extraction) — will fix on server
  Task:   Fix field "price" that is coming back empty

Confirm? (Y/N)
```

**Crawler issue (local fix):**
```
Here's what I'll work on:

  File:   ./tutorial/spiders/amazon.py (Python)
  Type:   Crawler (navigation) — will fix locally
  Task:   Pagination stops after page 2

Confirm? (Y/N)
```

**Both (crawler local + parser server):**
```
Here's what I'll work on:

  File:   ./tutorial/spiders/amazon.py (Python)
  HTML:   Will fetch 5 pages via ScrapeOps proxy
  Type:   Crawler + Parser — will fix navigation locally, then fix data extraction on server
  Task:   Pagination stops after page 2 AND price field is empty

Confirm? (Y/N)
```

Do not proceed until the user confirms.

---

## Step 3 — Prepare HTML source info

**If `issue_type` is `crawler` only:** skip this step entirely — go directly to Step 4.

For `parser` or `both` issues, determine the HTML source and whether the server can fetch it or if you need to fetch locally.

### If HTML files already exist locally

Note their paths — they will be read and sent to the server in Step 4.

### If URLs need to be fetched

First, analyze the user's request and the parser code to determine if the page requires **advanced HTTP options**:

**ScrapeOps proxy CAN handle (use `fetch_urls` — server fetches):**
- Simple GET requests to public URLs
- Pages with anti-bot protection (handled automatically by ScrapeOps proxy)
- JavaScript-rendered pages (handled automatically by ScrapeOps proxy)

**ScrapeOps proxy CANNOT handle (fetch locally):**
- POST requests with a body (form submissions, API calls)
- Requests requiring custom headers (Authorization, API keys, custom tokens)
- Requests requiring specific cookies or session tokens
- Authenticated pages behind login
- APIs that require specific Content-Type or Accept headers

**How to detect:** Look at the user's message and the parser code for clues:
- User mentions "POST", "login", "authenticated", "cookie", "session", "header", "token", "API key", "Bearer" → local fetch
- Parser code uses `requests.post()`, `method='POST'`, custom headers dict, session cookies → local fetch
- User provides curl commands with `-H`, `-b`, `-d`, `-X POST` flags → local fetch
- Otherwise → server fetch (default)

#### Path A — Server fetch (default)

Collect the URLs and save them to pass as `fetch_urls` in Step 4. **Do NOT call `scrapeops_fetch_html` or `scrapeops_fetch_html_batch`.**

#### Path B — Local fetch (advanced HTTP)

When the request requires POST, headers, cookies, or auth:

1. Ask the user for the necessary details (headers, cookies, POST body, etc.) if not already provided
2. Fetch the HTML locally using Bash with `curl`:
   ```bash
   # Example: POST with headers and cookies
   curl -s -X POST "https://api.example.com/data" \
     -H "Authorization: Bearer TOKEN" \
     -H "Content-Type: application/json" \
     -b "session=abc123" \
     -d '{"page": 1}' \
     -o fetched_page.html
   ```
3. Verify the HTML was fetched correctly (check file size, content)
4. These local files will be sent as `html_files` (base64) in Step 4

Show to user: "This request requires custom headers/POST — fetching HTML locally before sending to server for fixing."

---

## Step 4 — Fix

Route to the appropriate fix method based on `issue_type`.

### If `issue_type` is `crawler` — Fix locally

Crawler issues (navigation, pagination, URL discovery) are fixed **directly by you locally**. The server-side agent cannot help because it only works with static HTML files.

1. Read the parser/spider code carefully
2. Identify the crawler logic (pagination, link following, request flow)
3. Fix the issue using Edit tool directly on the file
4. Show the user what was changed
5. Skip to Step 5 — Result

**Common crawler fixes:**
- Adding/fixing `next_page` selector and `yield scrapy.Request(next_page, callback=self.parse)`
- Fixing URL patterns for detail pages
- Adding pagination loop (`while next_url` or `for page in range(...)`)
- Fixing `start_urls` or `start_requests()`
- Adding retry/error handling for navigation

### If `issue_type` is `both` — Fix crawler locally first, then parser on server

1. **First**, fix the crawler/navigation logic locally using Edit tool (same as crawler-only above)
2. Show the user what crawler changes were made
3. **Then**, proceed with the parser fix flow below (Steps 4.1–4.6) to send the parser issue to the server
4. The parser code sent to the server will already include the crawler fixes you just made

### If `issue_type` is `parser` — Send to server-side agent

The fix loop runs on the ScrapeOps server via the Agent Service. The local plugin sends the parser code and either local HTML files or URLs to fetch, then polls for completion.

### Step 4.1 — Read files and prepare payload

1. Read the parser file content using the Read tool

2. **If local HTML files exist:** Pass the file paths directly in `html_paths` — the MCP server reads them from disk internally. **Do NOT run `base64` or load HTML content into your context** (it wastes tokens and often exceeds payload limits).
   ```
   html_paths: ["./page.html", "./page_2.html"]
   ```

3. **If URLs need to be fetched (no local HTML):** Build the `fetch_urls` array with the URLs. The server will fetch the HTML pages via ScrapeOps proxy.

### Step 4.2 — Check for existing session (follow-up detection)

Before submitting, check if `.scrapeops-fix-session.json` exists in the current directory:
```bash
cat .scrapeops-fix-session.json 2>/dev/null
```

If the file exists AND the `parser_path` matches the current parser, this is a **follow-up fix**. Use the `job_id` from the session file — this reuses the existing server workspace (HTMLs already fetched, no need to re-send them).

### Step 4.3 — Submit the fix job

Call `scrapeops_start_fix` with:
- `parser_code` — the parser source code (read from file)
- `parser_filename` — the filename (e.g. `scraper.py`)
- `language` — the programming language
- `task` — what needs to be fixed
- `job_id` — **(only for follow-ups)** the job_id from `.scrapeops-fix-session.json`
- `html_paths` — array of local file paths, e.g. `["./page.html"]` **(preferred, new sessions with local HTML)**
- `fetch_urls` — array of URLs to fetch server-side **(only if new session without local HTML)**

**For follow-ups:** send `parser_code`, `parser_filename`, `language`, `task`, and `job_id`. The server already has the HTMLs from before. If the user provides **additional** HTML files or URLs (e.g. "also test against this page"), include them in `html_paths` or `fetch_urls` — the server will add them to the existing workspace without removing previous HTMLs.

**For new sessions:** send `html_paths` or `fetch_urls` (one or the other, not both).

Response has `job_id`. If missing or error, show the error and fall back to local parser-fixer agent.

Show to user: "Sending to ScrapeOps server for processing..."

### Step 4.4 — Poll for completion

Call `scrapeops_poll_fix_status` with `job_id` (waits 20s internally before checking).

- Show: `[Poll #N] <_summary>` (the `_summary` field contains the status and current progress message)
- `status = "completed"` → Step 4.5
- `status = "failed"` → show error, ask user how to proceed
- Any other status → poll again

No maximum attempts — keep polling until `completed` or `failed`.

### Step 4.5 — Get the result

Call `scrapeops_get_fix_result` with `job_id`.

Response contains:
- `fixed_parser_code` — the corrected parser source code
- `changes_summary` — description of what was changed
- `fix_result` — detailed result object (status, changes, etc.)
- `outputs` — parser output JSON files

### Step 4.6 — Write the fixed parser and save session file

1. Use the Write tool to overwrite the local parser file with `fixed_parser_code`.

2. Save `.scrapeops-fix-session.json` in the current directory for follow-up fixes:
   ```json
   {
     "job_id": "<the job_id>",
     "parser_path": "<path to the parser file>",
     "language": "<language>",
     "last_task": "<the task description>",
     "timestamp": "<current ISO timestamp>"
   }
   ```

### Fallback — Local parser-fixer agent

If `scrapeops_start_fix` fails (connection refused, timeout, HTTP error), fall back to the local `parser-fixer` agent:

1. Show: "Server unavailable, running fix locally..."
2. Delegate to the `parser-fixer` agent with parser_path, html_path, task, language, csv_path, broken_fields
3. Tell the agent: "Before starting fixes, generate schema.json and expected_data.json for the broken fields as described in Phase 1.6."

---

## Step 5 — Result

Show the result based on issue type.

**Parser fix (server-side) — Success:**
```
Parser fixed successfully!

Changes made:
  - <description of each change from changes_summary>

Files updated:
  - <parser_path>  (updated)
```

**Crawler fix (local) — Success:**
```
Crawler fixed locally!

Changes made:
  - <description of each change>

Files updated:
  - <parser_path>  (updated)
```

**Both — Success:**
```
Crawler + Parser fixed!

Crawler changes (local):
  - <description of crawler changes>

Parser changes (server):
  - <description of parser changes from changes_summary>

Files updated:
  - <parser_path>  (updated)
```

**Failed/Exhausted:**
Show the error or diagnosis and ask the user how to proceed.

---

## CRITICAL: Parser fixes go through the server, crawler fixes are local

**Data extraction issues (parser):** NEVER edit a parser file directly to fix selectors or field extraction. Every parser fix — including follow-up corrections — MUST go through the server-side agent via `scrapeops_start_fix`. This ensures fixes are validated against real HTML in a sandbox, costs are tracked, and results are stored.

**Navigation issues (crawler):** Fix directly and locally using Edit tool. The server cannot help with pagination, link following, or request flow because it only works with static HTML files.

**If both:** Fix crawler locally first, then send parser issues to the server.

If the user asks to fix something that was already partially fixed (e.g. "the price is still wrong"), re-invoke this skill flow: read the session file, send the updated parser to the server with the new task.

---

## Error Handling

| Situation | Response |
|-----------|----------|
| Parser file not found | Ask for correct path |
| HTML file not found | Ask for correct path or URL |
| HTML fetch fails | Show error, ask if user has local HTML |
| API key missing | Ask once, offer to save |
| Agent exhausted | Show diagnosis, ask user |

---

## Important Notes

- **Never load large HTML files fully into context** — write once, then use Grep and Read with offset+limit
- **The fix loop runs server-side** on the ScrapeOps Agent Service — falls back to local parser-fixer agent if unavailable
- The MCP server reads `SCRAPEOPS_API_KEY` and `SCRAPEOPS_API_URL` from environment automatically
- HTML files are sent base64-encoded to the server — use Bash `base64` command to encode them
