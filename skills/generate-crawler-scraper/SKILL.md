---
name: generate-crawler-scraper
description: Use this skill when the user asks to build a crawler-scraper combo — a parser that first discovers product URLs from a listing/search/category page and then scrapes details from each product page. Trigger phrases include "crawler", "build a crawler", "generate a crawler", "crawler + scraper", "crawler that searches for X on site Y", "build a crawler for <site> searching for <product>". Do NOT trigger for plain scraper requests (use `generate-scraper`) or for fixing an existing parser (use `fix-scraper`).
version: 2.0.0
---

# ScrapeOps — Generate Crawler + Scraper Skill (local-orchestrated)

Build a runnable crawler+scraper pair locally. Two files are produced by the Go backend (one per phase) and you run them on the user's machine. Each generated script talks to the ScrapeOps proxy directly (no server-side orchestration).

**Default layout is SEPARATE**: crawler writes URLs to a JSONL file, scraper reads that file and produces product JSONL. No merged script.

**Core rule**: the Go backend ONLY generates code. Everything else — URL discovery, schema generation, local execution, JSONL handoff — happens here in the Claude Code session.

> **API key handling**: The MCP server reads `SCRAPEOPS_API_KEY` from `~/.claude/settings.json` automatically. If a tool call fails with "SCRAPEOPS_API_KEY is not configured", ask the user for their key, write it to `~/.claude/settings.json` under `env.SCRAPEOPS_API_KEY`, and retry.

---

## Step 1 — Collect inputs

Ask for each value unless the user stated it in their opening message. **Never assume language/library.**

| Slot | Description |
|------|-------------|
| `domain` | Target site, e.g. `amazon.com`, `walmart.com`, `mercadolivre.com.br` |
| `search_query` | Natural-language search term, e.g. `"mens shirts"`, `"camisetas masculinas"` |
| `language` | **Ask.** Python, JavaScript, PHP, Ruby, Go, Rust, Java, or C# |
| `library` | **Ask.** Depends on language (BeautifulSoup, Cheerio, symfony/dom-crawler, nokogiri, goquery, scraper, jsoup, HtmlAgilityPack) |
| `max_pages` | Pagination cap. Default **1** — ask via the fixed `AskUserQuestion` format in Step 1.4 |

### 1.1 — Domain and query

Extract from the user's message. *"Crawler da Amazon buscando camisetas"* → `amazon.com`, `camisetas`. If either is ambiguous, ask.

### 1.2 — Language (obligatory question if not provided)

Use `AskUserQuestion`:

```
question: "Which language do you want the crawler + scraper in?"
header: "Language"
options:
  - label: "Python"
  - label: "JavaScript"
  - label: "PHP"
  - label: "Other"
    description: "Ruby, Go, Rust, Java, C#"
```

### 1.3 — Library (obligatory question if not provided)

Depends on the chosen language. Reference: [`../generate-scraper/references/languages.md`](../generate-scraper/references/languages.md).

**Python** → BeautifulSoup (default), Scrapy, Playwright, Selenium
**JavaScript** → Cheerio (default), Playwright, Puppeteer
**PHP** → symfony/dom-crawler
**Ruby** → nokogiri
**Go** → goquery
**Rust** → scraper
**Java** → jsoup
**C#** → HtmlAgilityPack

**Current caveat**: end-to-end templates with pagination follow-through are polished for **Python + JavaScript**. Other languages still work but the crawler may only handle page 1 (LLM fills in what it can). Warn the user if they pick something other than Python/JS.

**Scrapy is special — if the user picks Scrapy, take a completely different path.** Scrapy is a full framework with its own project structure (spiders, items, pipelines, middlewares, settings). You will NOT produce two standalone `.py` files. Instead, follow the **Scrapy Mode** workflow in the section below. Skip the normal Steps 6–14; they assume standalone scripts with built-in proxy fetching.

### 1.4 — `max_pages`

Default is **1**. Ask using `AskUserQuestion` with this EXACT shape every time — do NOT rephrase, reorder, or invent new options:

```
question: "How many listing pages should the crawler follow?"
header: "Max pages"
options:
  - label: "1 (default)"
    description: "Crawls only the first page of search results."
  - label: "5"
    description: "Crawls first 5 pages."
  - label: "10"
    description: "Crawls first 10 pages — slower, more URLs."
  - label: "Other"
    description: "Enter a custom positive integer."
```

If the user picks "Other", ask a follow-up free-text question: *"How many pages?"* — accept any positive integer.

### 1.5 — Warn duration

*"This usually takes 15–30 minutes. Feel free to let it run in the background."*

---

## Step 2 — Confirmation

Show a summary table and confirm:

```
Now let me confirm before we start:

| Field            | Value                     |
|------------------|---------------------------|
| **Domain**       | <domain>                  |
| **Search query** | <search_query>            |
| **Language**     | <language>                |
| **Library**      | <library>                 |
| **Max pages**    | <max_pages>               |
```

`AskUserQuestion`:

```
question: "Does everything look correct?"
header: "Confirm"
options:
  - label: "Yes, build it"
  - label: "No, change something"
```

If "No" → loop back.

---

## Step 3 — Discover listing URL (local, via ScrapeOps proxy)

Goal: turn `domain + search_query` into a concrete listing URL like `https://www.walmart.com/search?q=mens+shirts`.

1. Call **`scrapeops_fetch_html`** with `url: "https://<domain>"` to pull the homepage HTML. The response is raw HTML text.
2. Write the HTML to a temp file (e.g. `/tmp/scrapeops_discovery.html`) using the **Write** tool so you can grep it.
3. Use **Grep** to locate the search form. Typical patterns:
   - `<form.*?action="(/s|/search|/busca|/query|/find)[^"]*"`
   - `<input[^>]*name="(q|k|query|s|search|as_word)"`
4. Construct a candidate URL by URL-encoding the query and filling it in:
   - Amazon: `https://www.amazon.com/s?k=<query>`
   - Walmart: `https://www.walmart.com/search?q=<query>`
   - Mercado Livre: `https://lista.mercadolivre.com.br/<slugified-query>`
   - Generic: `https://<domain><action>?<name>=<encoded_query>`
5. Validate: call `scrapeops_fetch_html` on the candidate URL. Grep the response for link patterns that look like product URLs (`href.*?/ip/`, `href.*?/dp/`, `href.*?/product/`, `href.*?-p-?[0-9]+`). If you see multiple matches → URL is valid.
6. If validation fails after **3 attempts** with different patterns, stop and ask the user: *"I couldn't discover the search URL automatically. Paste a ready-to-use listing URL here (e.g. `https://<domain>/search?q=...`)."* Accept it and continue.

Save the result as `LISTING_URL` and show it to the user:

```
✓ Listing URL: <LISTING_URL>
```

---

## Step 4 — Generate crawler data schema

Invoke the **`/generate-data-schema`** skill programmatically (Skill tool) with:

```
target_page_type: product_crawler
user_description: "Product URLs and pagination from a listing/search page for '<search_query>' on <domain>"
output_path: ./crawler_schema.json
```

That skill writes `crawler_schema.json` in the CWD and returns the path. Read the file back using the **Read** tool so you have the JSON content in context to send to the Go backend.

---

## Step 5 — Fetch concurrency limit

Call **`scrapeops_get_concurrency_limit`** (no args). Response: `{ concurrency_limit, plan_id, plan_limit, extra_concurrency }`.

Save `CONCURRENCY = concurrency_limit`. Show the user: *"Your concurrency limit is <N> (plan_id <P>)."*

---

## Step 6 — Generate crawler code (Go backend)

Call **`scrapeops_submit_job`** with:

```json
{
  "urls": ["<LISTING_URL>"],
  "target_language": "<language, lowercase>",
  "target_library": "<library, lowercase>",
  "scraper_type": "product_crawler",
  "parser_only": false,
  "schema_json": <parsed content of crawler_schema.json>,
  "max_pages": <max_pages>,
  "concurrency": <CONCURRENCY>,
  "include_api_key": false
}
```

`include_api_key: false` tells the Go backend to emit the code with a placeholder `"YOUR-API-KEY"` instead of baking the real key into source. Step 7 will replace that placeholder with a `SCRAPEOPS_API_KEY` env-var read — same pattern as Scrapy mode.

Returns `{ version_id }`. Show: *"Crawler job submitted (version_id: <id>). Polling…"*.

Then poll with **`scrapeops_poll_status`** (20s internal wait per call). Loop until `status === "completed"` OR an error/failure status. On each poll, print `[Poll #N] <_summary>`.

**CRITICAL — ONLY proceed when `status === "completed"`. Never anything else.**

- The ONLY valid exit condition for the success path is `status === "completed"`. Not `status === "processing"`, not `status === "running"`, not `status === "queued"`, not `output_code` being present, not `link_output_code` being set, not `completed_at` being set, not the `_summary` mentioning "Return Code". **Look at the raw `status` field. If it is not the literal string `"completed"`, call `scrapeops_poll_status` again.** The backend may populate `output_code` / `link_output_code` / `completed_at` / later-step labels BEFORE the pipeline is finished — a post-processing agent may still be running. Proceeding early produces incomplete, unvalidated code.
- If you see `status` values like `processing`, `running`, `queued`, `step_N`, `generating_*`, `refactoring`, `ai_fix_suggestions`, `agent_fix`, `re_execute_parser`, anything that is NOT the literal `"completed"` → loop and call `scrapeops_poll_status` again. Do NOT stop polling.
- `completed_at: null` means the job has NOT finished. Keep polling.
- On `status === "completed"` → THEN get the code: inline `output_code`, or `scrapeops_download_code` on `link_output_code` if inline is empty.
- On `"error"` / `"failed"` / `"wrong_page_type"` / `"cancelled"` / `"expired"` → show `error_message` and stop.
- There is no max poll count and **no time-based stuck detection**. Jobs typically take 5–15 minutes each but can take longer when the backend runs validation loops, self-healing, or agent-based fixing. Do NOT infer that the job is stuck based on elapsed time, step label, or the presence of partially-generated code. Just keep polling until the status is literally one of the terminal values above.
- **Never open a "Stuck job" `AskUserQuestion`** offering options like "Proceed with existing code" / "Keep polling" / "Abort". Do not second-guess the backend. The only legitimate exit from the poll loop is a terminal status string. If you think the job is "stuck", you're wrong — keep polling.
- If the user explicitly interrupts (Ctrl+C, or types something like "stop", "cancel", "abort") → only then stop. Otherwise keep polling silently.

Also capture `install_command` from the final (completed) status response — used in Step 7.

---

## Step 7 — Save crawler file and run locally

Compute a domain slug: `walmart.com` → `walmart_com`. Extension from language: `.py`, `.js`, `.php`, `.rb`, `.go`, `.rs`, `.java`, `.cs`.

Save `<slug>_crawler.<ext>` using the **Write** tool (never echo/heredoc).

**CRITICAL — save the code VERBATIM, then ONE targeted edit for the API key:**

- Save exactly what the Go backend returned via `output_code` / `scrapeops_download_code` — with a single exception: replace the `"YOUR-API-KEY"` placeholder by a `SCRAPEOPS_API_KEY` env-var read (see table below). This is the ONLY allowed modification. Do NOT refactor, reformat, rename variables, add type hints, add docstrings, or "clean up" imports.
- Because Step 6 was called with `include_api_key: false`, the Go backend emitted `"YOUR-API-KEY"` as a placeholder (NOT the real key). Use **Edit** to replace it with a language-appropriate env-var read:

  | Language | Replace `"YOUR-API-KEY"` with |
  |----------|-------------------------------|
  | Python | `os.environ.get("SCRAPEOPS_API_KEY", "")` |
  | JavaScript / Node | `process.env.SCRAPEOPS_API_KEY \|\| ""` |
  | PHP | `getenv("SCRAPEOPS_API_KEY") ?: ""` |
  | Ruby | `ENV["SCRAPEOPS_API_KEY"] \|\| ""` |
  | Go | `os.Getenv("SCRAPEOPS_API_KEY")` |
  | Rust | `std::env::var("SCRAPEOPS_API_KEY").unwrap_or_default()` |
  | Java | `System.getenv("SCRAPEOPS_API_KEY")` |
  | C# | `Environment.GetEnvironmentVariable("SCRAPEOPS_API_KEY")` |

  After Write, run Edit: `old_string = "YOUR-API-KEY"` (with the surrounding quotes if the assignment is `API_KEY = "YOUR-API-KEY"`), `new_string = <env-var read from table>`. For Python, also ensure `import os` exists at the top — if not, add it.

- If during self-heal (Step 8 or 13) the local `parser-fixer` agent runs, it may edit selectors but MUST also preserve the env-var read (NOT replace it back to a hardcoded literal). Verify after the agent returns that the env-var line is still there.

Show the `install_command` (e.g. `pip install requests beautifulsoup4` for Python+BS4) and ask via `AskUserQuestion`:

```
question: "Install dependencies now?"
header: "Dependencies"
options:
  - label: "Yes, run"
  - label: "No, I'll install later"
```

If "Yes":

**For Python** (language = `python`) — **always use a venv**. `pip install` directly on system Python fails on macOS/Homebrew, Ubuntu 23.04+, Debian 12+, Fedora 38+ and other modern distros because of [PEP 668](https://peps.python.org/pep-0668/). Detect and skip only if the user is already inside a venv (`$VIRTUAL_ENV` is set) or inside a Docker/CI container (`$CI`, `/.dockerenv`).

Flow:
1. Check env: `[ -n "$VIRTUAL_ENV" ]` — if already in a venv, just run `pip install <pkgs>` and done.
2. Otherwise, create a project-local venv:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install <pkgs from install_command>
   ```
3. Tell the user: *"Created a venv at `.venv/`. Before running the crawler/scraper later, activate it: `source .venv/bin/activate`."*
4. Include that activation step in the README (Step 15).

**For Node.js** — `npm install <pkgs>` just works (npm isolates via local `node_modules` by default). No venv needed.

**For PHP / Ruby / Go / Rust / Java / C#** — use the language's standard install command (composer, bundler, go mod, cargo, maven, dotnet) as-is. No venv wrapper unless the user asks.

Run the install via **Bash** in the CWD.

**Export `SCRAPEOPS_API_KEY` before running** — the generated code reads from this env var (since we passed `include_api_key: false` in Step 6). Grab the key from `~/.claude/settings.json` (`env.SCRAPEOPS_API_KEY`) and run:

```bash
export SCRAPEOPS_API_KEY=<the key>
```

If you created a venv in the install step, that same shell session already has it activated. If not (non-Python), just export in the current shell.

Pick the runner based on language:

| Language | Runner |
|----------|--------|
| Python | `python3 <slug>_crawler.py` |
| JavaScript | `node <slug>_crawler.js` |
| PHP | `php <slug>_crawler.php` |
| Ruby | `ruby <slug>_crawler.rb` |
| Go | `go run <slug>_crawler.go` |
| Rust | `cargo run --` (may need a Cargo project; tell the user) |
| Java/C# | `mvn compile exec:java -Dexec.mainClass=...` / `dotnet run` — complex; advise the user to compile first |

Run:

```
<runner> "<LISTING_URL>" --max-pages <max_pages> --output <slug>_urls.jsonl
```

If the command fails (non-zero exit, runner not installed, or "SCRAPEOPS_API_KEY is empty" error), show stderr and **do NOT** continue to Step 8. Offer the user two options: (1) fix the runner/env and retry manually; (2) skip execution and move on.

---

## Step 8 — Validate the JSONL + local self-heal if needed

Read `<slug>_urls.jsonl` via **Bash** (e.g. `wc -l`, `head -1`). Validate:

- File exists and has >= 1 line.
- First line is valid JSON with a `url` field that starts with `http://` or `https://`.
- `url` is on the same domain as `LISTING_URL` (strip subdomain differences flexibly — allow `www.walmart.com` vs `walmart.com`).

If validation fails:

1. Fetch the listing HTML fresh via **`scrapeops_fetch_html`** and save to a temp file (e.g. `/tmp/<slug>_listing.html`).
2. **Invoke the local `parser-fixer` agent directly** via the **Agent** tool (do NOT use the `/fix-scraper` skill — that one defaults to server-side, we want 100% local):
   ```
   Agent(
     description: "Fix crawler parser locally",
     subagent_type: "parser-fixer",
     prompt: "Fix the crawler at <slug>_crawler.<ext> so it produces a valid JSONL of product URLs from the listing page.

Inputs:
- parser_path: <slug>_crawler.<ext>
- html_path: /tmp/<slug>_listing.html
- language: <language>
- task: Crawler is not producing valid product URLs. Expected: JSONL with one {\"url\": ...} per product, each URL absolute and on the same domain as the listing. Got: <short description of what was wrong — empty output / invalid JSON / missing url field / wrong domain>.

The parser is invoked as: <runner> <slug>_crawler.<ext> \"<LISTING_URL>\" --max-pages 1 --output /tmp/<slug>_urls_test.jsonl
Verify by running it and checking the output JSONL. Iterate selector edits until the JSONL has >= 1 valid URL line. Do NOT touch the hardcoded API_KEY = \"...\" line."
   )
   ```
   The parser-fixer agent reads the parser, runs it via Bash locally, greps the HTML, edits the code, and iterates — **100% on the user's machine**. No calls to the Go backend, no Agent Service.
3. After the agent returns, re-run the crawler (Step 7 command) and re-validate.
4. If still broken after one round, ask the user: *"I couldn't get the crawler working automatically. Want to: (a) try generating again, (b) adjust manually, (c) stop here?"*

Otherwise show: *"✓ Crawler produziu N URLs em `<slug>_urls.jsonl`."*

---

## Step 9 — Pick 3 product URLs for scraper generation

Read the JSONL. Extract up to **3** unique URLs from the same domain as `LISTING_URL`. These 3 URLs are sent to the Go backend as seed URLs for the product scraper generation (the backend samples their HTML to learn the site's product-page layout). Keep it at 3 — more URLs cost more tokens and rarely improve scraper quality.

Save as `PRODUCT_URLS = [url1, url2, url3]`.

---

## Step 10 — Generate product data schema

Invoke **`/generate-data-schema`** again:

```
target_page_type: product
user_description: "Full product details: name, price, currency, brand, images, reviews, specifications, features, availability, seller"
output_path: ./product_schema.json
```

Read the file back.

---

## Step 11 — Generate scraper code (Go backend)

Call **`scrapeops_submit_job`** with:

```json
{
  "urls": PRODUCT_URLS,
  "target_language": "<language, lowercase>",
  "target_library": "<library, lowercase>",
  "parser_only": false,
  "schema_json": <parsed content of product_schema.json>,
  "concurrency": <CONCURRENCY>,
  "input_from_jsonl": true,
  "include_api_key": false
}
```

(Do NOT set `scraper_type` here — let the backend auto-detect `product_page`. Same `include_api_key: false` reasoning as Step 6.)

Returns `{ version_id }`. Poll with `scrapeops_poll_status` **exactly as in Step 6** — same CRITICAL rule: **only proceed when `status === "completed"`**. Never on `output_code` presence, never on `completed_at`, never on any other status. Keep polling while status is anything other than `"completed"` / `"error"` / `"failed"` / `"wrong_page_type"` / `"cancelled"` / `"expired"`. On `completed`, get `output_code` (or `scrapeops_download_code` on `link_output_code`). Capture `install_command` (usually same packages as the crawler — skip install if already done).

---

## Step 12 — Save scraper file

Write `<slug>_scraper.<ext>` with the code. Same runner selection as Step 7.

**CRITICAL — same rule as Step 7:** save what the Go backend returned, byte-for-byte, then do the SAME single Edit replacing `"YOUR-API-KEY"` with the language-appropriate env-var read (Python → `os.environ.get("SCRAPEOPS_API_KEY", "")`, etc — see the table in Step 7). For Python, also ensure `import os` is present.

---

## Step 13 — Smoke test the scraper + local self-heal if needed

1. Create a 1-URL subset of the crawler's JSONL:
   ```
   head -1 <slug>_urls.jsonl > <slug>_urls.smoketest.jsonl
   ```
2. Run the scraper:
   ```
   <runner> <slug>_urls.smoketest.jsonl --concurrency 1 --output <slug>_smoke_out.jsonl
   ```
3. Check `<slug>_smoke_out.jsonl`:
   - Exists and has >= 1 line.
   - The line is valid JSON.
   - Has at least `name` (or equivalent core product field) — not empty.
4. If broken → **invoke the local `parser-fixer` agent directly** via the **Agent** tool (NOT `/fix-scraper`, which defaults to server-side):
   1. Take the URL from `<slug>_urls.smoketest.jsonl` (the first line's `url` field).
   2. Fetch its HTML via `scrapeops_fetch_html` and save to e.g. `/tmp/<slug>_product_sample.html`.
   3. Invoke:
      ```
      Agent(
        description: "Fix product scraper locally",
        subagent_type: "parser-fixer",
        prompt: "Fix the product scraper at <slug>_scraper.<ext>.

Inputs:
- parser_path: <slug>_scraper.<ext>
- html_path: /tmp/<slug>_product_sample.html
- language: <language>
- task: Scraper failing to extract product details. Expected JSON per product with at least name, price, images, reviews, specifications. Got: <short description>.

The scraper is invoked as: <runner> <slug>_scraper.<ext> <slug>_urls.smoketest.jsonl --concurrency 1 --output /tmp/<slug>_smoke_out.jsonl
Verify by running it and checking the output has valid product fields populated. Iterate selectors until valid. Do NOT touch the hardcoded API_KEY = \"...\" line."
      )
      ```
5. After the agent returns, re-run smoke test and re-validate. If still broken after one round, offer the user: regenerate / manual fix / stop.

---

## Step 14 — Final summary

Show:

```
✓ Crawler + Scraper built successfully!

Files in this directory:
  ✓ <slug>_crawler.<ext>     — crawls listing → writes URLs to JSONL
  ✓ <slug>_scraper.<ext>     — reads JSONL → scrapes product details
  ✓ crawler_schema.json      — data schema used for URL discovery
  ✓ product_schema.json      — data schema used for product details
  ✓ <slug>_urls.jsonl        — URLs discovered so far
  ✓ README.md                — step-by-step usage guide

Language / library: <language> / <library>
Concurrency limit: <CONCURRENCY>
Max pages crawled: <max_pages>

Before running: `export SCRAPEOPS_API_KEY=<your key>` (required — the scripts read the key from the env var).

Three ways to run it:

1) Step 1 — crawler only (discover product URLs):
  <runner> <slug>_crawler.<ext> "<LISTING_URL>" --max-pages <max_pages> --output <slug>_urls.jsonl

2) Step 2 — scraper only (needs urls.jsonl from step 1):
  <runner> <slug>_scraper.<ext> <slug>_urls.jsonl --concurrency <CONCURRENCY> --output <slug>_products.jsonl

3) Both at once (chained — most common):
  <runner> <slug>_crawler.<ext> "<LISTING_URL>" --max-pages <max_pages> --output <slug>_urls.jsonl && \
    <runner> <slug>_scraper.<ext> <slug>_urls.jsonl --concurrency <CONCURRENCY> --output <slug>_products.jsonl
```

Optionally display the smoke-test JSON inline so the user can see what a product record looks like.

---

## Step 15 — Generate `README.md`

Write a `README.md` next to the crawler and scraper files. **This is the only thing the user will see after generation finishes — make it their runbook.** The skill never executed any of the generated code, so the README is the single source of truth for how to use it. Use the **Write** tool. Template:

```markdown
# <domain> crawler + scraper

Two-stage scraper for `<domain>` that discovers product URLs from a listing page and then extracts detailed product info from each URL. Generated by the ScrapeOps `generate-crawler-scraper` skill on `<YYYY-MM-DD>`.

- **Listing URL**: `<LISTING_URL>`
- **Search query**: `<search_query>`
- **Language / library**: `<language>` / `<library>`
- **Max pages (default)**: `<max_pages>`
- **Concurrency (default)**: `<CONCURRENCY>` (ScrapeOps account limit at generation time)

## Files in this directory

| File | Purpose |
|------|---------|
| `<slug>_crawler.<ext>` | Crawls the listing page. Follows pagination, writes discovered URLs to JSONL |
| `<slug>_scraper.<ext>` | Reads URLs from JSONL, fetches each product page, extracts full details |
| `crawler_schema.json` | Data schema passed to the Go backend for the crawler phase |
| `product_schema.json` | Data schema passed to the Go backend for the scraper phase |
| `<slug>_urls.jsonl` | Sample URLs discovered during the smoke test (Step 11) |
| `README.md` | This file |

## Prerequisites

Install the dependencies once.

**If the language is Python** — use a project-local venv (required on macOS with Homebrew, Ubuntu 23.04+, Debian 12+, Fedora 38+, any distro that enforces [PEP 668](https://peps.python.org/pep-0668/)):

```
python3 -m venv .venv
source .venv/bin/activate
<install_command>
```

Every time you open a new shell to run the crawler/scraper, activate the venv first:
```
source .venv/bin/activate
```

**If the language is not Python** — just run the install command. No venv needed (npm, composer, bundler, cargo, etc. all isolate deps per project by default):

```
<install_command>
```

(e.g. `npm install axios cheerio` for Node+Cheerio, `composer require symfony/dom-crawler` for PHP, etc.)

**API key**: the scripts read the ScrapeOps API key from the `SCRAPEOPS_API_KEY` environment variable — NOT hardcoded. Export it before running:

```
export SCRAPEOPS_API_KEY=<your-scrapeops-key>
```

Both `<slug>_crawler.<ext>` and `<slug>_scraper.<ext>` look up this env var at runtime. If it's empty, the proxy request will fail with an auth error. Rotate the key by just exporting a new value — no code edits needed.

## How to run

### Option 1 — Crawler only

Discover product URLs from a listing page and write them to a JSONL file:

```
<runner> <slug>_crawler.<ext> "<LISTING_URL>" --max-pages <max_pages> --output <slug>_urls.jsonl
```

Flags:
- `--max-pages N` — stop after N pagination pages (default `<max_pages>`)
- `--output FILE` — where to write the JSONL (default `urls.jsonl`)

### Option 2 — Scraper only

Process a JSONL of URLs and write full product details:

```
<runner> <slug>_scraper.<ext> <slug>_urls.jsonl --concurrency <CONCURRENCY> --output <slug>_products.jsonl
```

Flags:
- `--concurrency N` — max parallel HTTP requests (default `<CONCURRENCY>`)
- `--output FILE` — where to write the JSONL (default `products.jsonl`)

### Option 3 — Full flow (crawler + scraper chained)

Run both in one command (most common usage):

```
<runner> <slug>_crawler.<ext> "<LISTING_URL>" --max-pages <max_pages> --output <slug>_urls.jsonl && \
  <runner> <slug>_scraper.<ext> <slug>_urls.jsonl --concurrency <CONCURRENCY> --output <slug>_products.jsonl
```

This writes:
- `<slug>_urls.jsonl` — one `{ "url": "..." }` per line (output of stage 1)
- `<slug>_products.jsonl` — one full product object per line (output of stage 2)

## Customizing

- **Change the search URL / query**: edit the first argument to the crawler (e.g. `"https://<domain>/search?q=<new query>"`).
- **More pages**: `--max-pages 10` on the crawler.
- **More concurrency**: `--concurrency <N>` on the scraper (never exceed your ScrapeOps plan limit).
- **Change what's extracted**: edit `crawler_schema.json` / `product_schema.json`, then either re-run `/generate-crawler-scraper` from scratch or pass the schema to `/fix-scraper` for incremental edits to the existing parser.

## Troubleshooting

- **Empty JSONL** → the crawler's selectors didn't match the current page layout. Run `/fix-scraper` on `<slug>_crawler.<ext>`.
- **Missing fields in products** → the scraper's selectors didn't match. Run `/fix-scraper` on `<slug>_scraper.<ext>`.
- **HTTP errors / 401 / "API key missing"** → make sure `SCRAPEOPS_API_KEY` is exported in the current shell (`echo $SCRAPEOPS_API_KEY`). Both scripts read the key from that env var at runtime. Both call `https://proxy.scrapeops.io/v1/` directly.
- **Rate limiting** → lower `--concurrency` on the scraper.

## How it works under the hood

1. The crawler opens the listing page through the ScrapeOps proxy, extracts `products[].url` and `pagination.nextPageUrl`, follows pagination until `--max-pages`, and writes one JSON object per URL to the output file.
2. The scraper reads that JSONL line-by-line, pulls each page through the proxy (with bounded concurrency), runs the extractor, and writes one full product object per line.
3. Both scripts talk directly to the ScrapeOps proxy — no dependency on the ScrapeOps backend at runtime.
```

Fill in every `<...>` placeholder with the concrete values from Steps 1–14. Don't leave literal angle-bracket placeholders.

Save as `README.md` using the **Write** tool.

---

## Error handling

| Situation | Response |
|-----------|----------|
| `scrapeops_fetch_html` for discovery fails 3 times | Ask user to paste listing URL manually |
| `scrapeops_submit_job` returns error | Show the full response body, stop |
| `scrapeops_poll_status` returns `error`/`failed`/`wrong_page_type` | Show `error_message`, stop — don't attempt to "work around" by changing parameters |
| Crawler local run fails | Show stderr, offer retry / skip / abort |
| JSONL validation fails | Invoke local `parser-fixer` agent once (via Agent tool), then ask user if still broken |
| Scraper smoke test fails | Invoke local `parser-fixer` agent once (via Agent tool) on scraper, then ask user if still broken |
| API key missing | Ask inline, save to `~/.claude/settings.json`, retry |

---

## Important Notes

- **Language is always the user's choice.** Never default to Python because "most scrapers are in Python". Ask.
- **Go backend only generates code.** All orchestration (discovery, schema, execution, self-heal) is local.
- **Default is SEPARATE files** — crawler + scraper run as two independent scripts exchanging a JSONL. Do NOT produce a merged file unless the user explicitly asks for one after the fact.
- **Self-heal runs 100% locally via the `parser-fixer` agent directly.** Invoke via `Agent(subagent_type: "parser-fixer", ...)`. Do NOT call `/fix-scraper` from this skill — `/fix-scraper` defaults to server-side (Go Agent Service) and we want zero server round-trips during crawler-scraper self-heal. The `parser-fixer` agent reads/runs/grep/edits on the user's machine with the local Bash/Edit/Grep tools.
- **Never regenerate a parser from scratch** (new `scrapeops_submit_job`) as a "fix" — direct code edits via the local parser-fixer are faster, cheaper, and more targeted.
- **Subsequent extensions** ("add field X", "also scrape reviews") are jobs for `/fix-scraper`, not this skill.
- **`max_pages`** is enforced by the generated crawler at runtime. The value chosen in Step 1 becomes the CLI default (`--max-pages`) — users can override at run time without regenerating.
- **Keep the generated files self-contained.** Don't patch them after generation unless via `/fix-scraper`. If the user wants a different language, re-run this skill from the start.
- **Jobs typically take 15–30 minutes total.** Do NOT ask the user whether to abort, proceed with partial code, or keep waiting based on elapsed time. The pipeline has validation, refactoring, and agent-based self-heal loops that can add extra minutes. Poll until `status === "completed"` or a terminal error status — nothing else is a valid exit. Never surface a "Stuck job" prompt to the user. If `output_code` is already populated but `status` is still `"processing"`, it means a post-processing step is still running — keep polling.

---

# Scrapy Mode

If in Step 1 the user selected **Python + Scrapy**, STOP following Steps 6–14 above. Scrapy is a framework with its own project structure, its own concurrency control (`CONCURRENT_REQUESTS` in settings.py), and its own HTTP layer (Twisted). You do NOT generate two standalone Python scripts with `requests` — you generate a full **Scrapy project**.

**Important**: in Scrapy mode, the `ScrapeOpsProxyMiddleware` is **enabled by default** — every outgoing request goes through `https://proxy.scrapeops.io/v1/` for IP rotation, anti-bot bypass, and optional JS rendering. The user must `export SCRAPEOPS_API_KEY=...` before running scrapy. If they want to bypass the proxy for some reason (debug, hitting a local site, etc), they comment out the middleware entry in `settings.py`.

The Go backend is still used, but only to produce the **extraction logic** (the CSS/XPath selectors for each field). Everything around it — project skeleton, middleware, settings, pipelines, CLI — is written locally by the skill.

## S1 — Keep Steps 1–5 as-is

Steps 1 through 5 (input collection, URL discovery, schema generation, concurrency fetch) run exactly the same. At Step 5 you end up with:

- `LISTING_URL`
- `crawler_schema.json`
- `CONCURRENCY` (from `scrapeops_get_concurrency_limit`)

Even though the default Scrapy project talks to the target site directly via Twisted, the optional `ScrapeOpsProxyMiddleware` can be enabled by the user later (when they hit anti-bot / blocking). Once enabled, every request is routed through `proxy.scrapeops.io` and the ScrapeOps plan's concurrency cap applies. So we use `CONCURRENCY` from the MCP tool as the default for `CONCURRENT_REQUESTS` in `settings.py` — this way the generated project is already tuned correctly if/when the user flips on the proxy, and it's still a reasonable number for direct requests.

## S2 — Submit parser-only jobs to the Go backend

Instead of one big code-gen job, submit **two small `parser_only: true` jobs** — one per phase. `parser_only: true` tells the Go backend to return *only* the `extract_data(html) -> dict` function, not the HTTP/pagination scaffolding. Scrapy provides the scaffolding itself.

**Job 1 — crawler parser** (for the listing page):
```json
{
  "urls": ["<LISTING_URL>"],
  "target_language": "python",
  "target_library": "beautifulsoup",
  "scraper_type": "product_crawler",
  "parser_only": true,
  "schema_json": <crawler_schema.json>
}
```

Note: `target_library` is `beautifulsoup` (NOT `scrapy`) because the parser body is a plain `extract_data(soup) -> dict` that we'll call from inside a Scrapy spider. The Scrapy spider uses `response.css(...)` for some things but we keep the Go-generated BeautifulSoup function intact for the structured extraction.

Poll with `scrapeops_poll_status` — **only proceed when `status === "completed"`** (same rule as Step 6). Save the returned `output_code` aside as `crawler_parser_body` (a Python snippet).

After the crawler parser is ready, run it **once** locally via a tiny wrapper (just for the 1-URL smoke test that feeds Step S3). The wrapper goes direct to the target site — no proxy needed for one-shot sampling:

```python
# scratch_crawl.py — throwaway, run once
<crawler_parser_body>
import requests, sys, json
from bs4 import BeautifulSoup

resp = requests.get(
    sys.argv[1],
    headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
    timeout=60,
)
soup = BeautifulSoup(resp.text, "html.parser")
print(json.dumps(extract_data(soup, sys.argv[1])))
```

Run it to collect 3 product URLs for the next Go job. If the target site blocks the direct request (403 / captcha / empty HTML), THEN you can fall back to pulling the HTML via the MCP tool `scrapeops_fetch_html` and feeding it into `extract_data` in a one-liner — but that's only for this one-time sampling, not the final Scrapy project.

**Job 2 — product parser** (for the detail pages):
```json
{
  "urls": [3 product URLs from Job 1],
  "target_language": "python",
  "target_library": "beautifulsoup",
  "parser_only": true,
  "schema_json": <product_schema.json>
}
```

Poll until completed, save `output_code` as `product_parser_body`.

## S3 — Generate the Scrapy project structure

Compute `slug = <domain-slug>_scrapy` (e.g. `walmart_com_scrapy`). Create this directory tree locally using the **Write** tool:

```
<slug>/
├── scrapy.cfg
├── README.md
├── crawler_schema.json          (copy of the one generated earlier)
├── product_schema.json          (copy)
└── <project_pkg>/               (e.g. walmart_com — use underscores, no dashes)
    ├── __init__.py              (empty)
    ├── items.py
    ├── middlewares.py
    ├── pipelines.py
    ├── settings.py
    └── spiders/
        ├── __init__.py          (empty)
        ├── crawler.py
        └── product.py
```

### S3.1 — `scrapy.cfg`

```
[settings]
default = <project_pkg>.settings

[deploy]
project = <project_pkg>
```

### S3.2 — `<project_pkg>/settings.py`

```python
import os

BOT_NAME = "<project_pkg>"
SPIDER_MODULES = ["<project_pkg>.spiders"]
NEWSPIDER_MODULE = "<project_pkg>.spiders"

# ScrapeOps proxy is ENABLED by default — every outgoing request is routed through
# https://proxy.scrapeops.io/v1/ via the ScrapeOpsProxyMiddleware (middlewares.py).
# You must `export SCRAPEOPS_API_KEY=...` before running scrapy, or the middleware
# will raise. To disable the proxy and talk to the target site directly, comment out
# the DOWNLOADER_MIDDLEWARES block below.
SCRAPEOPS_API_KEY = os.environ.get("SCRAPEOPS_API_KEY", "")

DOWNLOADER_MIDDLEWARES = {
    "<project_pkg>.middlewares.ScrapeOpsProxyMiddleware": 725,
}

ITEM_PIPELINES = {
    "<project_pkg>.pipelines.JsonLinesPipeline": 300,
}

# Concurrency — matches the user's ScrapeOps plan cap so the proxy middleware never
# exceeds the account limit. Keep it in sync if you upgrade the plan.
CONCURRENT_REQUESTS = <CONCURRENCY>
CONCURRENT_REQUESTS_PER_DOMAIN = <CONCURRENCY>
DOWNLOAD_TIMEOUT = 60
RETRY_TIMES = 3
RETRY_HTTP_CODES = [500, 502, 503, 504, 408, 429]
DOWNLOAD_DELAY = 0
ROBOTSTXT_OBEY = False
LOG_LEVEL = "INFO"

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

FEED_EXPORT_ENCODING = "utf-8"
```

### S3.3 — `<project_pkg>/middlewares.py`

The middleware is enabled by default via `DOWNLOADER_MIDDLEWARES` in `settings.py`. Every outgoing request is rewritten to go through `https://proxy.scrapeops.io/v1/` — so `SCRAPEOPS_API_KEY` must be exported in the environment before running scrapy. If the user wants to disable the proxy and hit the target site directly, they comment out the middleware entry in `settings.py`.

```python
from urllib.parse import urlencode


class ScrapeOpsProxyMiddleware:
    """Enabled by default. Rewrites every outgoing request to go through
    https://proxy.scrapeops.io/v1/. Requires SCRAPEOPS_API_KEY to be set in the
    environment. To disable, comment out the DOWNLOADER_MIDDLEWARES entry in
    settings.py (and stop setting SCRAPEOPS_API_KEY)."""

    PROXY_URL = "https://proxy.scrapeops.io/v1/"

    @classmethod
    def from_crawler(cls, crawler):
        api_key = crawler.settings.get("SCRAPEOPS_API_KEY")
        if not api_key:
            raise ValueError("SCRAPEOPS_API_KEY not set — export it before running scrapy")
        return cls(api_key)

    def __init__(self, api_key):
        self.api_key = api_key

    def process_request(self, request, spider):
        if request.url.startswith(self.PROXY_URL):
            return
        payload = {"api_key": self.api_key, "url": request.url, "optimize_request": True}
        request._set_url(self.PROXY_URL + "?" + urlencode(payload))
```

### S3.4 — `<project_pkg>/items.py`

Infer the field list from `product_schema.json` (top-level keys + simple nested). Generate a `ProductItem` with `scrapy.Field()` for each. Example (adjust to match schema):

```python
import scrapy


class ProductItem(scrapy.Item):
    url = scrapy.Field()
    name = scrapy.Field()
    productId = scrapy.Field()
    price = scrapy.Field()
    currency = scrapy.Field()
    brand = scrapy.Field()
    images = scrapy.Field()
    reviews = scrapy.Field()
    specifications = scrapy.Field()
    features = scrapy.Field()
    availability = scrapy.Field()
    seller = scrapy.Field()
```

### S3.5 — `<project_pkg>/pipelines.py`

```python
import json


class JsonLinesPipeline:
    """Writes every scraped item as one JSON line. Output path comes from `-O <file>.jsonl`
    at CLI invocation — this pipeline is a fallback when the user passes `--output`."""

    def process_item(self, item, spider):
        return item
```

Scrapy's built-in `-O output.jsonl` flag produces JSONL already; this pipeline is a no-op hook in case we want to add dedup/normalization later.

### S3.6 — `<project_pkg>/spiders/crawler.py`

Wraps the Go-generated `extract_data` (from `crawler_parser_body`) inside a Scrapy spider that follows pagination:

```python
import scrapy
from bs4 import BeautifulSoup
from urllib.parse import urljoin


# <crawler_parser_body> — paste the extract_data(soup, base_url) function from Go backend here verbatim
<crawler_parser_body>


class CrawlerSpider(scrapy.Spider):
    """Discovers product URLs from a listing page and follows pagination.

    Usage:
        scrapy crawl crawler -a listing_url="<LISTING_URL>" -a max_pages=1 -O urls.jsonl
    """

    name = "crawler"

    def __init__(self, listing_url=None, max_pages="1", *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not listing_url:
            raise ValueError("listing_url is required (-a listing_url=...)")
        self.listing_url = listing_url
        self.max_pages = int(max_pages)
        self.page = 0
        self._seen = set()

    def start_requests(self):
        yield scrapy.Request(self.listing_url, callback=self.parse_listing, meta={"page": 1})

    def parse_listing(self, response):
        page = response.meta.get("page", 1)
        self.page = page
        soup = BeautifulSoup(response.text, "html.parser")
        data = extract_data(soup, response.url) or {}

        products = data.get("products") or []
        for product in products:
            if not isinstance(product, dict):
                continue
            url = product.get("url")
            if not url:
                continue
            if not url.startswith("http"):
                url = urljoin(response.url, url)
            if url in self._seen:
                continue
            self._seen.add(url)
            yield {
                "url": url,
                "productId": product.get("productId"),
                "name": product.get("name"),
                "discoveredOnPage": page,
                "discoveredFromListing": response.url,
            }

        pagination = data.get("pagination") or {}
        next_url = pagination.get("nextPageUrl")
        if next_url and page < self.max_pages:
            if not next_url.startswith("http"):
                next_url = urljoin(response.url, next_url)
            yield scrapy.Request(next_url, callback=self.parse_listing, meta={"page": page + 1})
```

### S3.7 — `<project_pkg>/spiders/product.py`

```python
import json
import scrapy
from bs4 import BeautifulSoup

from <project_pkg>.items import ProductItem


# <product_parser_body> — paste the extract_data(soup) function from Go backend here verbatim
<product_parser_body>


class ProductSpider(scrapy.Spider):
    """Reads a JSONL file of URLs (one `{"url": "..."}` per line, produced by the crawler spider)
    and extracts full product details from each.

    Usage:
        scrapy crawl product -a urls_file=urls.jsonl -O products.jsonl
    """

    name = "product"

    def __init__(self, urls_file=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not urls_file:
            raise ValueError("urls_file is required (-a urls_file=urls.jsonl)")
        self.urls_file = urls_file

    def start_requests(self):
        with open(self.urls_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                url = obj.get("url") if isinstance(obj, dict) else None
                if url:
                    yield scrapy.Request(url, callback=self.parse_product, meta={"source_url": url})

    def parse_product(self, response):
        soup = BeautifulSoup(response.text, "html.parser")
        data = extract_data(soup) or {}
        data["url"] = response.meta.get("source_url") or response.url
        item = ProductItem()
        for key, value in data.items():
            if key in item.fields:
                item[key] = value
        yield item
```

## S4 — Smoke test + local self-heal

**Create a venv first** (same rule as Step 7: Python is always installed into a project-local venv because modern distros block system-wide `pip install`). Inside the Scrapy project directory (`<slug>/`), run:

```bash
# 1) Create + activate venv (skip if $VIRTUAL_ENV is already set)
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip

# 2) Install deps into the venv
pip install scrapy beautifulsoup4 lxml

# 3) Export the API key — proxy middleware is enabled by default
export SCRAPEOPS_API_KEY=<user's key>

# 4) Smoke test
scrapy crawl crawler -a listing_url="<LISTING_URL>" -a max_pages=1 -O smoke_urls.jsonl
```

`SCRAPEOPS_API_KEY` is required because the proxy middleware is enabled by default. Grab the key from `~/.claude/settings.json` → `env.SCRAPEOPS_API_KEY`, or ask the user to paste it.

Validate `smoke_urls.jsonl` as in Step 8 of the default mode. If broken, **invoke the local `parser-fixer` agent directly** (NOT the `/fix-scraper` skill) on `<project_pkg>/spiders/crawler.py`, passing the fresh listing HTML (fetched via `scrapeops_fetch_html`). Same `Agent(subagent_type: "parser-fixer", ...)` pattern as Step 8 / Step 13 of the default mode. Repeat for the product spider against one product URL.

100% local — the parser-fixer agent reads, runs, greps, edits, and re-runs on the user's machine, without going through `/fix-scraper` or the Agent Service.

## S5 — Final summary (Scrapy flavor)

```
✓ Scrapy project built successfully!

Directory: ./<slug>/
  ├── scrapy.cfg
  ├── README.md
  ├── crawler_schema.json
  ├── product_schema.json
  └── <project_pkg>/
      ├── items.py, middlewares.py, pipelines.py, settings.py
      └── spiders/
          ├── crawler.py  — listing → product URLs (JSONL)
          └── product.py  — product URLs → full details (JSONL)

Setup:
  cd <slug>
  python3 -m venv .venv && source .venv/bin/activate
  pip install scrapy beautifulsoup4 lxml
  export SCRAPEOPS_API_KEY=<your key>   # required — proxy middleware is enabled by default

Every new shell session needs `source .venv/bin/activate` before running scrapy.

Three ways to run it:

1) Crawler only:
   scrapy crawl crawler -a listing_url="<LISTING_URL>" -a max_pages=<max_pages> -O <slug>_urls.jsonl

2) Scraper only (needs the JSONL from step 1):
   scrapy crawl product -a urls_file=<slug>_urls.jsonl -O <slug>_products.jsonl

3) Both chained:
   scrapy crawl crawler -a listing_url="<LISTING_URL>" -a max_pages=<max_pages> -O <slug>_urls.jsonl && \
     scrapy crawl product -a urls_file=<slug>_urls.jsonl -O <slug>_products.jsonl

Concurrency is controlled by `CONCURRENT_REQUESTS` in <project_pkg>/settings.py (currently <CONCURRENCY>, which matches the ScrapeOps plan limit so the proxy middleware never exceeds the cap).
```

## S6 — Generate README.md (Scrapy flavor)

Same as the regular README (Step 15) but adapted to Scrapy. Include:
- Project structure explanation
- Install (`pip install scrapy beautifulsoup4`) + `SCRAPEOPS_API_KEY` env var
- The three `scrapy crawl ...` commands (crawler, product, chained)
- How to tune `CONCURRENT_REQUESTS` in `settings.py`
- Troubleshooting: mention `/fix-scraper` on specific spider files
- Note that items are defined in `items.py` and extraction logic in the spiders — extending means editing those

## Scrapy Mode notes

- **Never** mix Scrapy mode with the standalone-script mode. If the user picks `library=scrapy`, all output lives inside the Scrapy project dir.
- **ScrapeOps proxy is ON by default.** `DOWNLOADER_MIDDLEWARES` in `settings.py` activates `ScrapeOpsProxyMiddleware`, routing every request through `proxy.scrapeops.io`. Tell the user they need `export SCRAPEOPS_API_KEY=...` before running scrapy. To bypass the proxy, they comment out the middleware entry.
- **DO call `scrapeops_get_concurrency_limit`.** `CONCURRENT_REQUESTS` is set to the ScrapeOps plan concurrency limit so the proxy middleware respects the cap. Same call pattern as the standalone modes.
- **No `SCRAPEOPS_API_KEY` env var needed** for the default setup. Only needed if the user later enables the optional proxy middleware.
- **Schemas copied locally**: copy `crawler_schema.json` + `product_schema.json` into the project dir for reference / future `/fix-scraper` invocations.
- **Fix-scraper path**: when invoking `/fix-scraper` for a spider, pass `parser_path=<slug>/<project_pkg>/spiders/crawler.py` (or `product.py`) and include `language=python`. The fixer handles file edits locally.
