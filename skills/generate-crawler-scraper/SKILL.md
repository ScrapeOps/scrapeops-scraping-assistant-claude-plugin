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

Depends on the chosen language. Ask via `AskUserQuestion` with this EXACT shape for each language — do NOT rephrase labels or descriptions, do NOT add any marker like "(default)" / "(recommended)" / "most common" / "default choice" / "popular", and do NOT reorder the options.

**Python:**
```
question: "Which Python library should power the crawler + scraper?"
header: "Library"
options:
  - label: "BeautifulSoup"
    description: "HTML parser used with the requests HTTP client."
  - label: "Scrapy"
    description: "Full framework with built-in concurrency, pagination, and middleware."
  - label: "Playwright"
    description: "Real browser — use when JS rendering is required."
  - label: "Selenium"
    description: "Real browser (older) — use when JS rendering is required."
```

**JavaScript:**
```
question: "Which JavaScript library should power the crawler + scraper?"
header: "Library"
options:
  - label: "Cheerio"
    description: "Server-side HTML parser used with axios."
  - label: "Crawlee"
    description: "Full Node.js crawling framework — built on Cheerio/Playwright with request queue and proxy management."
  - label: "Playwright"
    description: "Real browser — use when JS rendering is required."
  - label: "Puppeteer"
    description: "Headless Chrome automation."
```

**PHP:**
```
question: "Which PHP library?"
header: "Library"
options:
  - label: "symfony/dom-crawler"
    description: "DOM parser from the Symfony ecosystem."
```

**Ruby:**
```
question: "Which Ruby library?"
header: "Library"
options:
  - label: "nokogiri"
    description: "HTML and XML parser for Ruby."
```

**Go:**
```
question: "Which Go library?"
header: "Library"
options:
  - label: "goquery"
    description: "jQuery-style DOM traversal for Go."
```

**Rust:**
```
question: "Which Rust library?"
header: "Library"
options:
  - label: "scraper"
    description: "HTML parsing and querying for Rust."
```

**Java:**
```
question: "Which Java library?"
header: "Library"
options:
  - label: "jsoup"
    description: "Java HTML parser with CSS-selector queries."
```

**C#:**
```
question: "Which C# library?"
header: "Library"
options:
  - label: "HtmlAgilityPack"
    description: "HTML parser for .NET."
```

Reference: [`../generate-scraper/references/languages.md`](../generate-scraper/references/languages.md) for `target_library` API values.

**Current caveat**: end-to-end templates with pagination follow-through are polished for **Python + JavaScript**. Other languages still work but the crawler may only handle page 1 (LLM fills in what it can). Warn the user if they pick something other than Python/JS.

**Scrapy and Crawlee are framework libraries — if the user picks one, take a completely
different path (Framework Mode).** Both impose their own project structure (Scrapy:
spiders/items/pipelines/middlewares/settings; Crawlee: crawlers/routers/proxy
configuration). You will NOT produce two standalone scripts. Instead, follow the
**Framework Mode** workflow in the section below — sub-section `## Scrapy (Python)` for
Scrapy, sub-section `## Crawlee (JavaScript)` for Crawlee. Skip the normal Steps 6–14;
they assume standalone scripts with built-in proxy fetching.

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

- The ONLY valid exit condition for the success path is `status === "completed"`. Not `status === "processing"`, not `status === "running"`, not `status === "queued"`, not `completed_at` being set, not the `_summary` mentioning "Return Code". **Look at the raw `status` field. If it is not the literal string `"completed"`, call `scrapeops_poll_status` again.** Note: `scrapeops_poll_status` intentionally does NOT return `output_code` or `link_output_code` — those fields only become available through `scrapeops_get_code` AFTER status is completed. So there's no way to "peek" at the code early.
- If you see `status` values like `processing`, `running`, `queued`, `step_N`, `generating_*`, `refactoring`, `ai_fix_suggestions`, `agent_fix`, `re_execute_parser`, anything that is NOT the literal `"completed"` → loop and call `scrapeops_poll_status` again. Do NOT stop polling.
- `completed_at: null` means the job has NOT finished. Keep polling.
- On `status === "completed"` → THEN call **`scrapeops_get_code`** with the `version_id` to retrieve the final code. The tool returns `{ code, language, library, install_command, version_id }` — use that `code` field for the Write in the next step. Do NOT use any cached intermediate output.
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

- Save exactly what `scrapeops_get_code` returned in the `code` field — with a single exception: replace the `"YOUR-API-KEY"` placeholder by a `SCRAPEOPS_API_KEY` env-var read (see table below). This is the ONLY allowed modification. Do NOT refactor, reformat, rename variables, add type hints, add docstrings, or "clean up" imports.
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

**Export `SCRAPEOPS_API_KEY` before running** — the generated code reads from this env var (since we passed `include_api_key: false` in Step 6). Do NOT try to read `~/.claude/settings.json` directly — the user's security policy may block that and the MCP server already handles the key internally.

To get the key for the export, try in this order:

1. Check if the env var is already set in the current shell:
   ```bash
   test -n "$SCRAPEOPS_API_KEY" && echo "already exported" || echo "need to ask user"
   ```
2. If not set, ask the user via `AskUserQuestion` to paste their ScrapeOps key, then `export SCRAPEOPS_API_KEY=<pasted value>` in the next Bash call.
3. Do NOT `cat`, `grep`, or `jq` `~/.claude/settings.json` — that's outside your scope and may trigger a security denial.

Once the env var is set in the shell session, run:

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

> 🚨 **Before running the crawler, do Step 7.5 first.** Step 7.5 parameterizes the
> hardcoded listing URL into CLI flags (`--keywords`, `--max-pages`, etc.) when the
> URL is a search page. The runner command above (`<runner> "<LISTING_URL>" --max-pages
> ...`) only works AFTER Step 7.5 has refactored the script. Without Step 7.5, the
> Go backend's verbatim crawler has the search query hardcoded inside the file and the
> CLI args don't exist yet.

---

## Step 7.5 — 🚨 MANDATORY: Parameterize hardcoded search URL into CLI flags

**This step is REQUIRED for every standard-mode crawler whose `LISTING_URL` is a search
page.** The Go backend returns a script with `urls = ["<LISTING_URL>"]` hardcoded near
the bottom. For search-style URLs that's broken UX — the user cannot change the search
query without editing the source file. This step refactors the script so the keyword,
pagination, and other filters become CLI flags.

**Skip Step 7.5** only when the LISTING_URL is NOT a search page (e.g. a static
category path like `/c/electronics` with no query string and no `/search` segment).

### 7.5.1 — Detect: is the LISTING_URL a search page?

Run the same heuristic as `generate-scraper` Step 1.5:

```bash
SEARCH_URL_REGEX='[?&](k|q|query|search|s|term|kw|keywords?)=[^&]+'
SEARCH_PATH_REGEX='/(search|s|busca|find|results)(/|\?|$)'
echo "<LISTING_URL>" | grep -E "$SEARCH_URL_REGEX|$SEARCH_PATH_REGEX"
```

If neither regex matches, **skip the rest of Step 7.5** (the hardcoded URL is fine for
a static listing) and continue to the runner command in Step 7. If either matches,
continue with 7.5.2.

### 7.5.2 — Parse the URL structure

Use Python via Bash (works regardless of the script's language):

```bash
python3 - <<'PY'
from urllib.parse import urlsplit, parse_qsl
u = urlsplit("<LISTING_URL>")
print("base:", f"{u.scheme}://{u.netloc}{u.path}")
print("params:", list(parse_qsl(u.query, keep_blank_values=True)))
PY
```

Extract:
- `KEYWORD_PARAM` — the query param matching the search regex (`k`, `q`, `query`, `s`,
  `search`, `term`, `kw`, `keyword`, `keywords`). Take the FIRST match.
- `KEYWORD_VALUE_DEFAULT` — its current value (becomes the CLI default).
- `PAGINATION_PARAM` — try `start`, `page`, `p`, `offset`, `from`. If present, note it.
- `PAGINATION_KIND` — `page-number` (1, 2, 3) or `offset-based` (0, 10, 20, 25, 50).
  Heuristic: if the original value is small (≤50), assume `page-number`. Otherwise check
  if it looks like `N * page_size` (Indeed uses `start=10, 20, 30...` with size 10).
- `PAGE_SIZE` — only meaningful when `offset-based`. Common: 10, 20, 24, 25, 48.
- `OTHER_QUERY_PARAMS` — every other param. They become FIXED filter values inside the
  refactored URL builder (preserve them verbatim, the user keeps controlling them by
  editing the original URL or via subsequent edits).

### 7.5.3 — Refactor the saved crawler script

Use **Edit** to replace the hardcoded `urls = [...]` block (and add CLI parsing) at the
bottom of `<slug>_crawler.<ext>`. The refactor is language-specific.

**Python** — find the `if __name__ == "__main__":` block (or equivalent entry point) and
replace it with:

```python
import argparse
from urllib.parse import urlencode

# === Search-URL parameterization (added by generate-crawler-scraper plugin) ===
SEARCH_URL_BASE = "<scheme>://<netloc><path>"        # e.g. "https://www.indeed.com/jobs"
KEYWORD_PARAM = "<KEYWORD_PARAM>"                    # e.g. "q"
PAGINATION_PARAM = "<PAGINATION_PARAM>"              # e.g. "start"; "" if none
PAGINATION_KIND = "<page-number|offset-based>"
PAGE_SIZE = <PAGE_SIZE_OR_0>                         # used only when offset-based
FIXED_PARAMS = <OTHER_QUERY_PARAMS_DICT_LITERAL>     # e.g. {"l": ""}
DEFAULT_KEYWORDS = ["<KEYWORD_VALUE_DEFAULT>"]       # may be overridden via --keywords


def build_search_url(keyword, page=1):
    params = {KEYWORD_PARAM: keyword, **FIXED_PARAMS}
    if PAGINATION_PARAM:
        if PAGINATION_KIND == "offset-based":
            params[PAGINATION_PARAM] = (page - 1) * (PAGE_SIZE or 1)
        else:
            params[PAGINATION_PARAM] = page
    return f"{SEARCH_URL_BASE}?{urlencode(params)}"


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Crawl <domain> search results")
    ap.add_argument("--keywords", help="Comma-separated keywords (overrides default)")
    ap.add_argument("--max-pages", type=int, default=1, help="Pages per keyword")
    ap.add_argument("--output", default=None, help="Output JSONL path (default: timestamped)")
    args = ap.parse_args()

    keywords = (
        [k.strip() for k in args.keywords.split(",") if k.strip()]
        if args.keywords else DEFAULT_KEYWORDS
    )
    urls = [build_search_url(kw, page)
            for kw in keywords
            for page in range(1, args.max_pages + 1)]

    logger.info(f"Crawling {len(urls)} URL(s) — {len(keywords)} keyword(s) × {args.max_pages} page(s)")
    concurrent_scraping(urls, max_threads=2, max_retries=3, output_file=args.output)
    logger.info("Crawling complete.")
```

Make sure `import argparse` and `from urllib.parse import urlencode` are at the top
(add to existing imports if missing). The function `concurrent_scraping` already exists
in the Go-emitted code; just call it with the new URL list. If its signature differs
slightly (e.g. doesn't accept `output_file`), adapt the call accordingly — but do NOT
rewrite the rest of the file. Selectors, dataclasses, pipeline class etc. all stay
verbatim from the backend.

**JavaScript** — same idea with `process.argv` parsing and a `URLSearchParams`
URL builder. Replace the bottom-of-file URL list with:

```javascript
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

const SEARCH_URL_BASE = "<scheme>://<netloc><path>";
const KEYWORD_PARAM = "<KEYWORD_PARAM>";
const PAGINATION_PARAM = "<PAGINATION_PARAM>"; // empty string if no pagination
const PAGINATION_KIND = "<page-number|offset-based>";
const PAGE_SIZE = <PAGE_SIZE_OR_0>;
const FIXED_PARAMS = <OTHER_QUERY_PARAMS_OBJECT_LITERAL>;
const DEFAULT_KEYWORDS = ["<KEYWORD_VALUE_DEFAULT>"];

function buildSearchUrl(keyword, page = 1) {
  const params = new URLSearchParams({ [KEYWORD_PARAM]: keyword, ...FIXED_PARAMS });
  if (PAGINATION_PARAM) {
    const value = PAGINATION_KIND === "offset-based"
      ? String((page - 1) * (PAGE_SIZE || 1))
      : String(page);
    params.set(PAGINATION_PARAM, value);
  }
  return `${SEARCH_URL_BASE}?${params.toString()}`;
}

const args = parseArgs(process.argv);
const keywords = args.keywords
  ? args.keywords.split(",").map(k => k.trim()).filter(Boolean)
  : DEFAULT_KEYWORDS;
const maxPages = parseInt(args["max-pages"] ?? "1", 10);
const urls = [];
for (const kw of keywords) for (let p = 1; p <= maxPages; p++) urls.push(buildSearchUrl(kw, p));

// Then call whatever the backend named the entrypoint, passing `urls` and `args.output`.
```

**Other languages (PHP, Ruby, Go, Rust, Java, C#)** — the standard mode rarely emits
crawlers in these for search pages. If the user does pick one of them and it's a search
URL, do a smaller refactor: replace just the hardcoded URL with one read from
`process.argv[1]` / `ARGV[0]` / `os.Args[1]` / etc., and document in the README that
keyword switching requires re-running the script with a different argument. Mention this
limitation explicitly in the README.

### 7.5.4 — Verify the refactor

Run a quick syntax check via Bash before moving on:

- Python: `python3 -m py_compile <slug>_crawler.py` (should exit 0)
- JavaScript: `node --check <slug>_crawler.js` (should exit 0)

If either fails, show the error and adjust. Do NOT proceed to running the crawler with a
broken file.

### 7.5.5 — Updated runner command (use this from now on)

After Step 7.5, the runner command from Step 7 becomes:

```
<runner> --keywords "<KEYWORD_VALUE_DEFAULT>" --max-pages <max_pages> --output <slug>_urls.jsonl
```

NOT `<runner> "<LISTING_URL>" ...`. The script no longer accepts a positional URL — it
builds URLs from `--keywords` and `--max-pages` against `SEARCH_URL_BASE` baked in at
generation time.

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

The parser is invoked as: <runner> <slug>_crawler.<ext> --keywords \"<KEYWORD_VALUE_DEFAULT>\" --max-pages 1 --output /tmp/<slug>_urls_test.jsonl (if Step 7.5 ran), OR <runner> <slug>_crawler.<ext> \"<LISTING_URL>\" --max-pages 1 --output /tmp/<slug>_urls_test.jsonl (if Step 7.5 was skipped because the URL was not a search page).
Verify by running it and checking the output JSONL. Iterate selector edits until the JSONL has >= 1 valid URL line. Do NOT touch the SCRAPEOPS_API_KEY env-var read. Do NOT touch the Step 7.5 parameterization block (SEARCH_URL_BASE, KEYWORD_PARAM, build_search_url, the argparse setup) — only edit selectors inside extract_data."
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

Returns `{ version_id }`. Poll with `scrapeops_poll_status` **exactly as in Step 6** — same CRITICAL rule: **only proceed when `status === "completed"`**. Never on `completed_at`, never on any other status. Keep polling while status is anything other than `"completed"` / `"error"` / `"failed"` / `"wrong_page_type"` / `"cancelled"` / `"expired"`. On `completed`, call **`scrapeops_get_code`** with the `version_id` to fetch `{ code, install_command, ... }`. Capture `install_command` (usually same packages as the crawler — skip install if already done).

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

Three ways to run it (assumes Step 7.5 parameterization ran — the crawler accepts
`--keywords`. If the listing URL was a static category and Step 7.5 was skipped, drop the
`--keywords` flag from the commands below — the URL is baked in):

1) Step 1 — crawler only (discover product URLs):
  <runner> <slug>_crawler.<ext> --keywords "<KEYWORD_VALUE_DEFAULT>" --max-pages <max_pages> --output <slug>_urls.jsonl

2) Step 2 — scraper only (needs urls.jsonl from step 1):
  <runner> <slug>_scraper.<ext> <slug>_urls.jsonl --concurrency <CONCURRENCY> --output <slug>_products.jsonl

3) Both at once (chained — most common):
  <runner> <slug>_crawler.<ext> --keywords "<KEYWORD_VALUE_DEFAULT>" --max-pages <max_pages> --output <slug>_urls.jsonl && \
    <runner> <slug>_scraper.<ext> <slug>_urls.jsonl --concurrency <CONCURRENCY> --output <slug>_products.jsonl

To run with a different keyword, just change the value:
  <runner> <slug>_crawler.<ext> --keywords "data engineer" --max-pages 3
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

Discover product URLs and write them to a JSONL file. **Behavior depends on whether
the listing URL was a search page (Step 7.5 ran) or a static listing (Step 7.5 skipped):**

**If Step 7.5 ran (search page — most common):** the crawler accepts CLI flags for the
keyword and pagination — change them at runtime without editing the source:

```
<runner> <slug>_crawler.<ext> --keywords "<KEYWORD_VALUE_DEFAULT>" --max-pages <max_pages> --output <slug>_urls.jsonl

# Try a different keyword:
<runner> <slug>_crawler.<ext> --keywords "data engineer" --max-pages 3

# Multiple keywords in one run (comma-separated):
<runner> <slug>_crawler.<ext> --keywords "software engineer,data scientist,product manager" --max-pages 2
```

Flags:
- `--keywords STRING` — single keyword OR comma-separated list. Default: `<KEYWORD_VALUE_DEFAULT>` (the keyword from the URL passed at generation time).
- `--max-pages N` — stop after N pagination pages PER KEYWORD (default `<max_pages>`).
- `--output FILE` — where to write the JSONL (default: timestamped filename).

**If Step 7.5 was skipped (static listing URL):** the crawler accepts only `--max-pages`
and `--output`; the URL is baked in. To change the listing target, edit the `urls = [...]`
list near the bottom of `<slug>_crawler.<ext>` directly.

### Option 2 — Scraper only

Process a JSONL of URLs and write full product details:

```
<runner> <slug>_scraper.<ext> <slug>_urls.jsonl --concurrency <CONCURRENCY> --output <slug>_products.jsonl
```

Flags:
- `--concurrency N` — max parallel HTTP requests (default `<CONCURRENCY>`)
- `--output FILE` — where to write the JSONL (default `products.jsonl`)

### Option 3 — Full flow (crawler + scraper chained)

Run both in one command (most common usage). Use the appropriate crawler invocation
depending on whether Step 7.5 ran:

```
# Search-page crawler (Step 7.5 ran):
<runner> <slug>_crawler.<ext> --keywords "<KEYWORD_VALUE_DEFAULT>" --max-pages <max_pages> --output <slug>_urls.jsonl && \
  <runner> <slug>_scraper.<ext> <slug>_urls.jsonl --concurrency <CONCURRENCY> --output <slug>_products.jsonl

# Static-listing crawler (Step 7.5 skipped):
<runner> <slug>_crawler.<ext> --max-pages <max_pages> --output <slug>_urls.jsonl && \
  <runner> <slug>_scraper.<ext> <slug>_urls.jsonl --concurrency <CONCURRENCY> --output <slug>_products.jsonl
```

This writes:
- `<slug>_urls.jsonl` — one `{ "url": "..." }` per line (output of stage 1)
- `<slug>_products.jsonl` — one full product object per line (output of stage 2)

## Customizing

- **Change the search keyword (Step 7.5 ran)**: pass `--keywords "<new query>"` on the
  crawler — no source edit needed. Comma-separate multiple keywords to crawl them all in
  one run. The default in the source can be changed by editing `DEFAULT_KEYWORDS` at the
  bottom of `<slug>_crawler.<ext>`.
- **Change the listing URL (Step 7.5 skipped)**: edit the `urls = [...]` list near the
  bottom of `<slug>_crawler.<ext>`.
- **Change other filters baked in from the original URL** (e.g. location, sort): edit the
  `FIXED_PARAMS` dict near the bottom of `<slug>_crawler.<ext>` (only present when
  Step 7.5 ran).
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
| API key missing at runtime (for env export) | Ask the user via `AskUserQuestion` to paste the key; do NOT read `~/.claude/settings.json` directly — that path may be blocked by the user's permission rules |

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
- **Jobs typically take 15–30 minutes total.** Do NOT ask the user whether to abort, proceed with partial code, or keep waiting based on elapsed time. The pipeline has validation, refactoring, and agent-based self-heal loops that can add extra minutes. Poll until `status === "completed"` or a terminal error status — nothing else is a valid exit. Never surface a "Stuck job" prompt to the user. (As a safeguard, `scrapeops_poll_status` doesn't expose `output_code` at all — the only way to get the code is via `scrapeops_get_code` after status is completed.)

---

# Framework Mode

Active when the user picks **Python + Scrapy** or **JavaScript + Crawlee** in Step 1.
Both libraries are full frameworks with their own project structure, request lifecycle,
and concurrency model. You do NOT generate two standalone scripts with backend-baked
proxy fetching — instead, ask the Go backend for `parser_only: true` extractor functions
and **assemble a framework project locally** around them.

Two sub-paths share Steps 1–5 from the default mode (input collection, URL discovery,
schema generation, concurrency fetch):

- **`## Scrapy (Python)`** — sub-section S-Scrapy-1 to S-Scrapy-9 below.
- **`## Crawlee (JavaScript)`** — sub-section S-Crawlee-1 to S-Crawlee-9 below.

**MANDATORY for both sub-paths**: consult the ScrapeOps proxy docs at runtime, **every
single run**. The plugin must extract the current proxy endpoint, auth format, and
optional parameters from the live docs before writing any proxy code:

| Proxy product | Canonical doc URL |
|---|---|
| Proxy API Aggregator | `https://scrapeops.io/docs/web-scraping-proxy-api-aggregator/quickstart/` |
| Residential & Mobile Proxy Aggregator | `https://scrapeops.io/docs/residential-mobile-proxy-aggregator/overview/` |

Fetch order: `WebFetch` first (faster and parsed for you), `Bash curl` with a browser UA
as fallback (Cloudflare blocks WebFetch on parts of `scrapeops.io`), then
`../generate-scraper/references/proxies.md` as offline insurance. Warn the user explicitly
if both network paths fail.

The decision matrix between the two proxy products lives in
`../generate-scraper/references/frameworks.md` Section C. In short: HTTP-based transport
(Scrapy default downloader, Crawlee `CheerioCrawler`) → **Proxy API Aggregator**
(URL rewrite); browser transport (Crawlee `PlaywrightCrawler`) → **Residential & Mobile
Proxy Aggregator** (proxy on the wire).

---

## Scrapy (Python)

If in Step 1 the user selected **Python + Scrapy**, STOP following Steps 6–14 above. Scrapy is a framework with its own project structure, its own concurrency control (`CONCURRENT_REQUESTS` in settings.py), and its own HTTP layer (Twisted). You do NOT generate two standalone Python scripts with `requests` — you generate a full **Scrapy project**.

**Pure Scrapy — no BeautifulSoup anywhere.** The final spiders extract data using native `response.css(...)` / `response.xpath(...)` selectors. The Go backend happens to return a BS4 extraction snippet (because that's what the Go templates produce today), but the skill **converts it locally** to native Scrapy selectors before writing any spider file. The generated project has `scrapy` as its only direct dependency — no `beautifulsoup4`, no `lxml` install line, no `from bs4` imports.

**ScrapeOps proxy is ENABLED by default** — every outgoing request goes through the
**Proxy API Aggregator** (`https://proxy.scrapeops.io/v1/`) for IP rotation, anti-bot
bypass, and optional JS rendering. URL rewrite via `DownloaderMiddleware` is the
idiomatic way to inject proxy in Scrapy. The user must `export SCRAPEOPS_API_KEY=...`
before running scrapy. If they want to bypass the proxy (debug, hitting a local site,
etc), they comment out the middleware entry in `settings.py`.

**Do NOT copy structure from this SKILL.md.** Scrapy's recommended project layout, setting names, middleware API, and install commands evolve over time. Every Scrapy Mode run consults the official Scrapy + Python Packaging docs at generation time via `Bash curl` (the Claude Code `WebFetch` tool is blocked by those sites' Cloudflare layer), then builds files from the **current** documented patterns. Hardcoded templates at the bottom of this file exist ONLY as offline fallback when doc fetches fail.

## S1 — Keep Steps 1–5 as-is

Steps 1 through 5 (input collection, URL discovery, schema generation, concurrency fetch) run exactly the same as the default mode. At Step 5 you end up with:

- `LISTING_URL`
- `crawler_schema.json`
- `product_schema.json` is generated later in S4 after we've sampled some product URLs
- `CONCURRENCY` (from `scrapeops_get_concurrency_limit`)

The ScrapeOps proxy middleware is enabled by default in the generated project, so every request goes through `proxy.scrapeops.io` and the plan's concurrency cap applies. `CONCURRENCY` becomes the `CONCURRENT_REQUESTS` value in `settings.py`.

## S2 — Consult the Scrapy official docs (MANDATORY before writing any file)

**Use `Bash` + `curl`, NOT `WebFetch`.** The Anthropic WebFetch tool gets blocked by ReadTheDocs' Cloudflare (403) on `docs.scrapy.org`. `curl` with a browser User-Agent passes through cleanly.

Download these three pages to `/tmp/` and then `Read` them:

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

curl -sSL -A "$UA" "https://docs.scrapy.org/en/latest/intro/tutorial.html"          -o /tmp/scrapy_tutorial.html
curl -sSL -A "$UA" "https://docs.scrapy.org/en/latest/topics/settings.html"         -o /tmp/scrapy_settings.html
curl -sSL -A "$UA" "https://docs.scrapy.org/en/latest/topics/downloader-middleware.html" -o /tmp/scrapy_middleware.html

# Verify all three downloaded (non-empty, HTML):
for f in /tmp/scrapy_tutorial.html /tmp/scrapy_settings.html /tmp/scrapy_middleware.html; do
  head -c 200 "$f" | grep -q "<html\|<!DOCTYPE" && echo "OK $f" || echo "FAIL $f"
done
```

Then use the `Read` tool on each `/tmp/scrapy_*.html` file to extract:

- **tutorial.html** → current project layout (what `scrapy startproject` produces today — which files/dirs, their names).
- **settings.html** → exact names of settings keys in current Scrapy: `CONCURRENT_REQUESTS`, `USER_AGENT`, `ROBOTSTXT_OBEY`, `DOWNLOADER_MIDDLEWARES`, `ITEM_PIPELINES`, `DOWNLOAD_TIMEOUT`, `RETRY_TIMES`, `RETRY_HTTP_CODES`, `FEED_EXPORT_ENCODING`. Confirm none were renamed or deprecated.
- **middleware.html** → current recommended pattern for a downloader middleware that rewrites request URLs: class method names (`process_request`, `from_crawler`), return conventions, how to read settings via `crawler.settings.get(...)`.

Summarize the relevant facts to memory. Use those facts to compose the files in S6. **If this SKILL.md shows a pattern that contradicts the fetched docs, trust the docs.**

HTML files are large — use `Read` with `offset`/`limit` + `Grep` to navigate. Don't try to read the whole file at once.

If ALL three `curl` calls fail or produce `FAIL`, log a warning to the user and fall back to the **"Scrapy fallback templates"** appendix at the end of this file. Single-URL failures: proceed with the other two plus fallback values for the missing piece.

## S3 — Consult the Python packaging docs for env setup

**Same rule as S2 — use `Bash` + `curl`, NOT `WebFetch`** (packaging.python.org is also behind a CDN that blocks WebFetch).

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

curl -sSL -A "$UA" "https://packaging.python.org/en/latest/guides/installing-using-pip-and-virtual-environments/" \
  -o /tmp/python_venv_guide.html

head -c 200 /tmp/python_venv_guide.html | grep -q "<html\|<!DOCTYPE" && echo "OK" || echo "FAIL"
```

Then `Read` `/tmp/python_venv_guide.html` and extract the officially recommended commands for creating + activating a venv on macOS/Linux/Windows.

Detect the user's OS via `uname -s` through Bash:

- `Darwin` or `Linux` → activation via `source .venv/bin/activate`
- Anything else (Windows via git-bash / WSL) → `source .venv/Scripts/activate` (git-bash) or `.venv\Scripts\activate.bat` (cmd). Pick based on shell.

Save the resulting setup commands (venv creation + activation + `pip install scrapy`) — you'll embed them in the README generated in S9.

If the fetch fails or the page returns `FAIL`, use the stable fallback: `python3 -m venv .venv && source .venv/bin/activate && pip install --upgrade pip && pip install scrapy`. Stdlib `venv` has been stable since Python 3.3, so this fallback is safe.

## S4 — Submit two `parser_only` jobs to the Go backend

The Go backend doesn't have native Scrapy templates — it returns BeautifulSoup `extract_data(soup) -> dict` functions. That's fine: we'll convert BS4 → Scrapy selectors locally in S5.

Submit **two small `parser_only: true` jobs**:

**Job 1 — crawler parser** (listing page):
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

`target_library: "beautifulsoup"` is correct — it makes the Go backend return a plain extractor function. The library shown to the end user remains Scrapy; BS4 is an intermediate representation that exists only in memory during generation.

Poll with `scrapeops_poll_status` — **only proceed when `status === "completed"`** (same rule as the default mode). When completed, call **`scrapeops_get_code`** with the version_id and save the returned `code` as `crawler_parser_bs4_body` (a Python snippet with `extract_data(soup, base_url)` inside).

**Sample 3 product URLs.** After Job 1 finishes, run the returned BS4 extractor once via a throwaway wrapper to collect 3 product URLs for Job 2:

```python
# /tmp/scratch_crawl.py — throwaway, runs once
<crawler_parser_bs4_body>
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

This wrapper is intentionally BS4-based — the Go-returned body expects `soup`. It runs **once** to collect sample URLs, then gets deleted. It is NOT the final code.

If the target site blocks the direct request (403 / captcha / empty HTML), pull the HTML via `scrapeops_fetch_html` instead.

Invoke the `/generate-data-schema` skill with `target_page_type: product` to produce `product_schema.json`.

**Job 2 — product parser** (detail pages):
```json
{
  "urls": [the 3 sampled product URLs],
  "target_language": "python",
  "target_library": "beautifulsoup",
  "parser_only": true,
  "schema_json": <product_schema.json>
}
```

Poll until `completed`. Then call **`scrapeops_get_code`** with the version_id and save the returned `code` as `product_parser_bs4_body`.

Delete the throwaway `/tmp/scratch_crawl.py` now that the sampling is done.

## S5 — Convert BS4 extractors → native Scrapy selector extractors

This is the **critical step** that makes the project Scrapy-pure. For each of the two parser bodies (`crawler_parser_bs4_body`, `product_parser_bs4_body`):

1. Write the BS4 snippet to a temp file (e.g. `/tmp/<slug>_crawler_bs4.py`) so you can Read / Grep / Edit it.
2. Rewrite the function using the **CONVERSION CHEATSHEET** below. The target contract is:
   - Function signature changes from `extract_data(soup, base_url=None)` to `extract_data(response, base_url=None)` — where `response` is a Scrapy `Response` object.
   - All `soup.select(...)` / `soup.find(...)` → `response.css(...)` / `response.xpath(...)`.
   - All `element.get_text(strip=True)` → `element.css("::text").get("").strip()`.
   - All `element.get("href")` / `element["href"]` → `element.css("::attr(href)").get()`.
   - Remove every `from bs4 import ...` / `import bs4` line.
3. Save the converted body as `crawler_parser_scrapy_body` / `product_parser_scrapy_body` in memory (or in a second temp file).
4. **Validate** via Bash grep against the converted file — ABSOLUTE RULE:
   ```bash
   grep -E 'BeautifulSoup|from bs4|import bs4|\.get_text\(|soup\.find\(|soup\.select\(|soup\.select_one\(' /tmp/<slug>_crawler_scrapy.py
   ```
   Must return **zero matches**. If any match remains, loop back to step 2 for that specific line.
5. If after 2 rewrite passes there's still a token that resists conversion (regex over raw HTML, lxml tree walking, BS4-only utilities like `SoupStrainer` or `UnicodeDammit`), invoke the local `parser-fixer` agent:
   ```
   Agent(
     subagent_type: "parser-fixer",
     description: "Finish BS4 → Scrapy conversion",
     prompt: "The file <path> is a product parser that must use native Scrapy selectors only. There are still <N> lines using BS4 patterns. Convert them to response.css / response.xpath / XPath equivalents. Do NOT keep any `from bs4`, `import bs4`, `BeautifulSoup`, `.get_text(`, `soup.find(`, or `soup.select(` tokens. Verify with grep before returning."
   )
   ```
   The parser-fixer agent iterates on the file locally — no server round-trip.

### CONVERSION CHEATSHEET — BS4 → Scrapy selectors

**Selector queries:**

| BS4 | Scrapy |
|-----|--------|
| `soup.select(".foo .bar")` | `response.css(".foo .bar")` |
| `soup.select_one(".foo")` | `response.css(".foo").get()` |
| `soup.find("a", class_="x")` | `response.css("a.x").get()` |
| `soup.find_all("a", class_="x")` | `response.css("a.x").getall()` |
| `soup.find(attrs={"data-id": "123"})` | `response.css('[data-id="123"]').get()` |
| `soup.find_all("a", href=True)` | `response.css("a[href]").getall()` |
| `soup.find("a", id="checkout")` | `response.css("a#checkout").get()` |

**Extracting text:**

| BS4 | Scrapy |
|-----|--------|
| `el.get_text(strip=True)` | `el.css("::text").get("").strip()` |
| `el.get_text(" ", strip=True)` | `" ".join(el.css("::text").getall()).strip()` |
| `el.string` | `el.css("::text").get()` |
| `el.text` (simple case) | `el.css("::text").get("").strip()` |

**Extracting attributes:**

| BS4 | Scrapy |
|-----|--------|
| `el.get("href")` / `el["href"]` | `el.css("::attr(href)").get()` |
| `el.get("src")` | `el.css("::attr(src)").get()` |
| `el.get("data-id")` | `el.css("::attr(data-id)").get()` |

**Iteration and nested queries:**

```python
# BS4
for card in soup.select(".product-card"):
    title = card.select_one("h3").get_text(strip=True)
    price = card.find("span", class_="price")["data-value"]

# Scrapy (native)
for card in response.css(".product-card"):
    title = card.css("h3::text").get("").strip()
    price = card.css("span.price::attr(data-value)").get()
```

Scrapy's `Selector` objects returned by `.css()` can be chained exactly like BS4 `Tag` objects — the code structure stays the same, only the method calls change.

**Edge cases:**

- `soup.prettify()` / regex over full HTML string → replace with an XPath expression that targets the same element directly. If genuinely impossible (rare), use `response.text` as the raw string input for the regex, but try XPath first.
- `el.parent` / `el.next_sibling` / `el.find_parent(...)` → use XPath axes: `el.xpath("./parent::*").get()`, `el.xpath("following-sibling::*[1]").get()`, etc.
- `BeautifulSoup(html, "html.parser")` inside the extractor (not just at entry) → remove entirely, operate on `response` / nested `Selector`.
- `SoupStrainer`, `UnicodeDammit`, `NavigableString` → delete; Scrapy handles encoding via `response.text` and selectors replace tag navigation.

**ABSOLUTE RULE:** the final `extract_data(response, base_url)` function MUST have zero of these tokens:
`BeautifulSoup`, `from bs4`, `import bs4`, `.get_text(`, `soup.find(`, `soup.select(`, `soup.select_one(`, `.prettify()`. Verify via grep after every rewrite. If the grep finds anything, the conversion isn't done.

## S6 — Build the Scrapy project files (structure from S2 docs)

Compute `slug = <domain-slug>_scrapy` (e.g. `walmart_com_scrapy`) and `project_pkg = <domain-slug>` (no dashes, valid Python identifier, e.g. `walmart_com`).

Create files using the **layout and settings key names you extracted from the docs in S2**, NOT from SKILL.md. **The project must use Scrapy's full native machinery** — selectors mixing CSS+XPath, ItemLoaders, real Item Pipelines (validation/dedup/normalization), middlewares, autothrottle. The required-features list and validation greps live in `../generate-scraper/references/frameworks.md` Section E.1 and E.3 — read those before assembling, and run the greps before declaring the project done.

For each file:

### Root config file (today: `scrapy.cfg`)

Minimal — points at the project package's `settings` module. Confirm the exact format from the tutorial page fetched in S2. If layout docs changed and `scrapy.cfg` was renamed or restructured, use the new format.

### `<project_pkg>/settings.py`

Must include:
- `BOT_NAME`, `SPIDER_MODULES`, `NEWSPIDER_MODULE` — standard per docs.
- `import os` and `SCRAPEOPS_API_KEY = os.environ.get("SCRAPEOPS_API_KEY", "")` — read from env.
- `DOWNLOADER_MIDDLEWARES` registering `ScrapeOpsProxyMiddleware` at priority 725 (or whatever the current docs suggest for a request-rewriting middleware). Scrapy's built-in `RetryMiddleware` is enabled by default — don't disable it.
- `ITEM_PIPELINES` registering all three real pipelines defined below: `ValidationPipeline` (priority 100), `DuplicatesPipeline` (200), `NormalizationPipeline` (300).
- `CONCURRENT_REQUESTS = <CONCURRENCY>` and `CONCURRENT_REQUESTS_PER_DOMAIN = <CONCURRENCY>`.
- `DOWNLOAD_TIMEOUT = 60`, `RETRY_TIMES = 3`, `RETRY_HTTP_CODES = [500, 502, 503, 504, 408, 429]`.
- **Autothrottle ON**: `AUTOTHROTTLE_ENABLED = True`, `AUTOTHROTTLE_START_DELAY = 1.0`, `AUTOTHROTTLE_MAX_DELAY = 10.0`, `AUTOTHROTTLE_TARGET_CONCURRENCY = <CONCURRENCY>`.
- `ROBOTSTXT_OBEY = False` (we're scraping through a paid proxy — robots.txt irrelevant here).
- `LOG_LEVEL = "INFO"`.
- `USER_AGENT` — a realistic browser UA.
- `FEED_EXPORT_ENCODING = "utf-8"`.
- A header comment explaining the proxy is ON by default and how to disable it.

Cross-check every setting name against the S2 settings-doc fetch. If Scrapy renamed any of these between tutorial versions, use the current name.

### `<project_pkg>/middlewares.py`

One class, `ScrapeOpsProxyMiddleware`, that rewrites every outgoing request URL to `https://proxy.scrapeops.io/v1/?api_key=<KEY>&url=<encoded>&optimize_request=true`. Use `from_crawler(cls, crawler)` to read `SCRAPEOPS_API_KEY` from settings, raise a clear error if empty. `process_request(self, request, spider)` mutates `request.url` in place (via `request._set_url(...)` or the equivalent in current Scrapy — check S2 middleware doc for the recommended method).

Don't let the middleware rewrite already-proxied URLs (guard: `if request.url.startswith(self.PROXY_URL): return`).

### `<project_pkg>/items.py`

Two classes:

1. `ProductItem(scrapy.Item)` with `scrapy.Field()` for each top-level field in `product_schema.json`. Pick only scalar fields and flat arrays/objects — don't flatten deeply-nested reviews/specs into individual fields; keep those as single `scrapy.Field()` that holds the list/dict.

2. `ProductLoader(scrapy.loader.ItemLoader)` (or `from itemloaders import ItemLoader` in modern Scrapy — confirm via S2's settings doc). Set `default_output_processor = TakeFirst()` and add `_in` / `_out` processors per field as needed: `MapCompose(str.strip)` for whitespace cleanup, `MapCompose(str.strip, _to_number)` for prices, `Identity()` for lists you want preserved, `Join(" ")` for description-style joined text. The product spider populates this loader rather than mutating a raw dict.

### `<project_pkg>/pipelines.py`

Three real pipelines (no no-ops):

1. `ValidationPipeline` — drops items missing required keys (`url`, plus the schema's required fields). Raises `DropItem` from `scrapy.exceptions` with a clear message.
2. `DuplicatesPipeline` — keeps a set of seen `url` (or `productId` if present) and drops duplicates.
3. `NormalizationPipeline` — collapses whitespace inside strings, resolves relative URLs against the original request URL (use `urljoin`), coerces price-like fields to floats where possible.

Scrapy's native `-O <file>.jsonl` flag handles JSONL writing — do not write a custom file pipeline.

### `<project_pkg>/spiders/crawler.py`

Structure:
- `import scrapy`
- `from urllib.parse import urljoin`
- Paste `crawler_parser_scrapy_body` (the **converted** function, NOT the BS4 one)
- `class CrawlerSpider(scrapy.Spider)`:
  - `name = "crawler"`
  - `__init__(self, listing_url=None, max_pages="1", *args, **kwargs)` — accept CLI args via `-a`
  - `start_requests()` yields the initial `scrapy.Request(listing_url)`
  - `parse_listing(self, response)` calls `extract_data(response, response.url)`, yields dict per discovered URL (keys: `url`, `productId`, `name`, `discoveredOnPage`, `discoveredFromListing`), follows `pagination.nextPageUrl` up to `max_pages`.

**Strictly no BS4.** No `from bs4`, no `BeautifulSoup(response.text, ...)`, no `soup = ...`. The spider calls `extract_data(response, ...)` directly.

### `<project_pkg>/spiders/product.py`

Structure:
- `import json`, `import scrapy`
- `from <project_pkg>.items import ProductItem, ProductLoader`
- Paste `product_parser_scrapy_body` (the **converted** function)
- `class ProductSpider(scrapy.Spider)`:
  - `name = "product"`
  - `__init__(self, urls_file=None, ...)` — accept `-a urls_file=urls.jsonl`
  - `start_requests()` reads the JSONL line-by-line, yields one `scrapy.Request` per `url`.
  - `parse_product(self, response)` calls `extract_data(response, response.url)`, then **populates a `ProductLoader`** (NOT a raw dict): instantiate `loader = ProductLoader(item=ProductItem(), response=response)`, iterate the extractor's output and call `loader.add_value(key, value)` for each key in `ProductItem.fields`, finally `yield loader.load_item()`. The loader's processors handle whitespace/type coercion centrally so the spider stays small.

**Strictly no BS4.** Same rule — spider calls `extract_data(response, ...)` directly. Mix CSS and XPath inside `extract_data` per `../generate-scraper/references/frameworks.md` Section A.2.

### Also write

- `<project_pkg>/__init__.py` — empty.
- `<project_pkg>/spiders/__init__.py` — empty.
- Copy `crawler_schema.json` and `product_schema.json` into `<slug>/` for reference.

### Final validation before moving to S7

Two grep passes, both required:

**1) BS4-purity grep** — must return **zero matches**. If anything shows up, fix before smoke test (project violates the "pure Scrapy" contract):

```bash
grep -rE 'BeautifulSoup|from bs4|import bs4|\.get_text\(|soup\.find\(|soup\.select\(' <slug>/<project_pkg>/ 2>/dev/null
```

**2) Native-features grep** — each line below must NOT print `MISSING:`. If any does, the project is not idiomatic; fix the assembly:

```bash
grep -E 'class .*Loader' <slug>/<project_pkg>/items.py || echo "MISSING: ItemLoader subclass"
grep -E 'AUTOTHROTTLE_ENABLED\s*=\s*True' <slug>/<project_pkg>/settings.py || echo "MISSING: autothrottle"
grep -E 'class ValidationPipeline|class DuplicatesPipeline|class NormalizationPipeline' <slug>/<project_pkg>/pipelines.py || echo "MISSING: real pipelines"
grep -E 'ITEM_PIPELINES' <slug>/<project_pkg>/settings.py || echo "MISSING: ITEM_PIPELINES"
grep -E 'load_item\(' <slug>/<project_pkg>/spiders/product.py || echo "MISSING: spider uses ItemLoader.load_item()"
```

Reference list of required features: `../generate-scraper/references/frameworks.md` Section E.1.

## S7 — Install deps + smoke test + local self-heal

Using the commands gathered in S3 (venv creation + activation) and the OS-detected shell, run inside the Scrapy project directory (`<slug>/`):

```bash
# 1) Create + activate venv (exact command from S3 curl+Read, or fallback)
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip

# 2) Install ONLY scrapy. BS4 is NOT in the spiders anymore.
pip install scrapy

# 3) API key — proxy middleware is enabled by default
export SCRAPEOPS_API_KEY=<value pasted by user when prompted — NEVER read from ~/.claude/settings.json>

# 4) Smoke test — max_pages=1 for speed
scrapy crawl crawler -a listing_url="<LISTING_URL>" -a max_pages=1 -O smoke_urls.jsonl
```

Validate `smoke_urls.jsonl`:
- File exists and has >= 1 line.
- First line is valid JSON with `url` starting with `http`.
- Domain matches `LISTING_URL` (tolerate `www.` variants).

If broken, invoke the local `parser-fixer` agent on `<project_pkg>/spiders/crawler.py`:

```
Agent(
  subagent_type: "parser-fixer",
  description: "Fix crawler spider (Scrapy)",
  prompt: "The Scrapy spider at <path> runs but produces bad output. Inputs: the spider file, fresh listing HTML (save from scrapeops_fetch_html), language=python. Task: iterate selectors until the JSONL output has valid absolute product URLs. CRITICAL: keep the spider Scrapy-pure — do NOT add `from bs4`, `BeautifulSoup`, or any BS4 usage. Only native response.css/response.xpath. Verify with grep before finishing."
)
```

Then repeat for the product spider:

```bash
head -1 smoke_urls.jsonl > smoke_one.jsonl
scrapy crawl product -a urls_file=smoke_one.jsonl -O smoke_products.jsonl
```

Same validation + same parser-fixer invocation pattern if broken. 100% local — no server round-trip.

## S8 — Final summary (Scrapy flavor)

Show:

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
          ├── crawler.py  — listing → product URLs (JSONL, native Scrapy selectors)
          └── product.py  — product URLs → full details (JSONL, native Scrapy selectors)

This project is 100% Scrapy — zero BeautifulSoup dependency.

Setup:
  cd <slug>
  <venv creation command from S3>
  <venv activation command from S3>
  pip install scrapy
  export SCRAPEOPS_API_KEY=<your key>   # required — proxy middleware is enabled by default

Every new shell session needs `<activation command>` before running scrapy.

Three ways to run it:

1) Crawler only:
   scrapy crawl crawler -a listing_url="<LISTING_URL>" -a max_pages=<max_pages> -O <slug>_urls.jsonl

2) Scraper only (needs the JSONL from step 1):
   scrapy crawl product -a urls_file=<slug>_urls.jsonl -O <slug>_products.jsonl

3) Both chained:
   scrapy crawl crawler -a listing_url="<LISTING_URL>" -a max_pages=<max_pages> -O <slug>_urls.jsonl && \
     scrapy crawl product -a urls_file=<slug>_urls.jsonl -O <slug>_products.jsonl

Concurrency is controlled by `CONCURRENT_REQUESTS` in <project_pkg>/settings.py (currently <CONCURRENCY>, matching the ScrapeOps plan limit).
```

Substitute placeholders with concrete values. `<venv creation command>` and `<venv activation command>` come from the `curl`+`Read` in S3.

## S9 — Generate README.md (Scrapy flavor)

Write `<slug>/README.md`. Structure (adapt from the default-mode README template):

- **Project summary** — `<domain>` Scrapy crawler + scraper, generated by `/generate-crawler-scraper` on `<date>`.
- **Metadata** — listing URL, search query, language=Python, library=Scrapy (pure, no BS4), max_pages default, concurrency, date.
- **Files in this directory** — table listing `scrapy.cfg`, `settings.py`, `middlewares.py`, `items.py`, `pipelines.py`, `spiders/crawler.py`, `spiders/product.py`, `crawler_schema.json`, `product_schema.json`, `README.md`. Each row with a 1-line description.
- **Prerequisites** — Python 3.9+. Show the EXACT venv commands from S3 (not hardcoded — use what was fetched). Show `pip install scrapy` (only scrapy, no BS4). Show `export SCRAPEOPS_API_KEY=<your-key>` as required.
- **How to run** — three options (crawler only, scraper only, chained). Same `scrapy crawl ...` invocations as S8.
- **Customizing**:
  - Change search URL → `-a listing_url=...` flag.
  - More pages → `-a max_pages=N`.
  - More concurrency → edit `CONCURRENT_REQUESTS` in `<project_pkg>/settings.py`. Warn not to exceed the ScrapeOps plan cap.
  - Change extracted fields → edit `items.py` and the `extract_data` function inside the spider.
  - Disable proxy → comment out `DOWNLOADER_MIDDLEWARES` entry in `settings.py`.
- **Troubleshooting**:
  - Empty JSONL from crawler → run `/fix-scraper` on `<project_pkg>/spiders/crawler.py`.
  - Missing fields from scraper → same on `product.py`.
  - `SCRAPEOPS_API_KEY not set` error → `echo $SCRAPEOPS_API_KEY` — must be non-empty.
  - HTTP 401/403 → invalid or expired key.
  - Blocked by target site → verify proxy middleware is enabled in settings.py.
- **How it works** — brief: crawler spider opens listing URL via proxy, extracts product URLs using native Scrapy `response.css`/`response.xpath`, follows pagination; product spider reads JSONL, fetches each URL via proxy, extracts full product object.

**Important about the README contents:**
- Include the exact venv/install commands from S3 — don't paraphrase.
- Do NOT mention `beautifulsoup4` anywhere. The project has no BS4.
- Do NOT show `python3 -m venv .venv && source .venv/bin/activate` hardcoded — use what S3's fetch returned (which is probably the same but might differ per OS or when pyproject PEPs change).

---

## Crawlee (JavaScript)

If in Step 1 the user selected **JavaScript + Crawlee**, STOP following Steps 6–14 above.
Crawlee is a Node.js framework with its own request queue, concurrency control
(`maxConcurrency` on the crawler instance), proxy management (`ProxyConfiguration`), and
storage layer (`./storage/`). You do NOT generate two standalone `.js` files with
hand-rolled axios — you generate a full **Crawlee project** with two crawler entrypoints
(`src/crawler.js`, `src/scraper.js`) and a shared extractor + proxy module.

**Crawlee with Cheerio transport — no axios anywhere.** The final crawlers extract data via
the `$` Cheerio object provided by `CheerioCrawler`'s request handler. The Go backend
returns a Cheerio `extract_data($, baseUrl)` function which Crawlee can use directly — no
selector conversion needed (unlike Scrapy/BS4). The generated project has `crawlee` as
its only direct dependency.

**ScrapeOps proxy is ENABLED by default.** For HTTP-based `CheerioCrawler` (the default
choice for crawler+scraper combos) the proxy is the **Proxy API Aggregator**, injected
via `preNavigationHooks` rewriting `request.url` to `https://proxy.scrapeops.io/v1/?api_key=...&url=...`.
For browser-based `PlaywrightCrawler` (only if user explicitly asked for JS rendering),
the proxy switches to **Residential & Mobile Proxy Aggregator** via `ProxyConfiguration`
pointing at `residential-proxy.scrapeops.io:8181` with basic auth. The user must
`export SCRAPEOPS_API_KEY=...` before running the crawlers.

**Do NOT copy structure from this SKILL.md.** Crawlee's API surface (handler argument
names, `enqueueLinks` shape, `proxyConfiguration` constructor) evolves between versions.
Every Crawlee Mode run consults the official Crawlee docs at generation time, then builds
files from the **current** documented patterns. The reference templates in
`../generate-scraper/references/frameworks.md` Section B are offline fallback only.

### S-Crawlee-1 — Keep Steps 1–5 as-is

Same as Scrapy mode S1 — input collection, listing URL discovery, schema generation, and
concurrency fetch run identically to the default mode. At the end you have:

- `LISTING_URL`
- `crawler_schema.json` (from `/generate-data-schema`)
- `CONCURRENCY` (from `scrapeops_get_concurrency_limit`)

`product_schema.json` is generated later in S-Crawlee-4 after sampling product URLs.
`CONCURRENCY` becomes `maxConcurrency` on the Crawlee instance.

### S-Crawlee-2 — Consult Crawlee official docs (MANDATORY)

`crawlee.dev` is generally accessible via `WebFetch`. Try WebFetch first; fall back to
`Bash curl` only if it fails.

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

curl -sSL -A "$UA" "https://crawlee.dev/docs/quick-start"                       -o /tmp/crawlee_quickstart.html
curl -sSL -A "$UA" "https://crawlee.dev/docs/guides/proxy-management"          -o /tmp/crawlee_proxy.html
curl -sSL -A "$UA" "https://crawlee.dev/api/cheerio-crawler/class/CheerioCrawler" -o /tmp/crawlee_cheerio.html
curl -sSL -A "$UA" "https://crawlee.dev/docs/guides/routing"                    -o /tmp/crawlee_routing.html

for f in /tmp/crawlee_quickstart.html /tmp/crawlee_proxy.html /tmp/crawlee_cheerio.html /tmp/crawlee_routing.html; do
  head -c 200 "$f" | grep -q "<html\|<!DOCTYPE" && echo "OK $f" || echo "FAIL $f"
done
```

Extract from these:

- **quickstart** → minimum viable `CheerioCrawler` shape, default storage location.
- **proxy** → current `ProxyConfiguration` constructor API, recommended ways to wire a
  proxy URL with auth.
- **cheerio** → `requestHandler` parameter list (`{ $, request, pushData, enqueueLinks }`).
- **routing** → `createCheerioRouter()` pattern when there are multiple page types.

If all four fetches fail, fall back to `../generate-scraper/references/frameworks.md`
Section B and warn the user.

### S-Crawlee-3 — Consult ScrapeOps proxy docs (MANDATORY every run)

Same rule as Scrapy mode but with the **two ScrapeOps proxy URLs**:

- `https://scrapeops.io/docs/web-scraping-proxy-api-aggregator/quickstart/`
- `https://scrapeops.io/docs/residential-mobile-proxy-aggregator/overview/`

WebFetch → curl-fallback → `../generate-scraper/references/proxies.md`. Extract endpoint,
auth format, and listed optional parameters from each. The proxy snippet in
`src/proxy.js` (S-Crawlee-6) MUST reflect what the live docs say — do not hardcode from
this SKILL.md or the offline reference unless network is unreachable.

### S-Crawlee-4 — Submit two `parser_only` jobs to the Go backend

Submit **two `parser_only: true` jobs** with `target_library: "cheerio"` (intermediate —
Cheerio is the native parser inside `CheerioCrawler`).

**Job 1 — crawler parser** (listing page):
```json
{
  "urls": ["<LISTING_URL>"],
  "target_language": "javascript",
  "target_library": "cheerio",
  "scraper_type": "product_crawler",
  "parser_only": true,
  "schema_json": <crawler_schema.json>
}
```

Poll `scrapeops_poll_status` until `status === "completed"` (same CRITICAL rule as Step 6
of the default mode). Call `scrapeops_get_code` and save the returned `code` as
`crawler_parser_cheerio_body` (a JS function `extract_data($, baseUrl)`).

**Sample 3 product URLs.** After Job 1 finishes, run the returned Cheerio extractor
against the listing HTML to collect 3 product URLs for Job 2:

```javascript
// /tmp/scratch_crawl.mjs — throwaway, runs once
import * as cheerio from "cheerio";
import { writeFileSync } from "node:fs";

<crawler_parser_cheerio_body>

const listingHtml = process.argv[2] ? require("node:fs").readFileSync(process.argv[2], "utf8") : "";
const baseUrl = process.argv[3] || "<LISTING_URL>";
const $ = cheerio.load(listingHtml);
console.log(JSON.stringify(extract_data($, baseUrl)));
```

(For the Cheerio `cheerio.load(html)` invocation, you need the raw listing HTML on disk.
Pull it via `scrapeops_fetch_html` if direct `fetch` is blocked.)

This wrapper is intentionally Cheerio-based — the Go-returned body expects `$`. Runs
**once** to collect sample URLs, then gets deleted. NOT the final code.

Invoke `/generate-data-schema` with `target_page_type: product` to produce
`product_schema.json`.

**Job 2 — product parser** (detail pages):
```json
{
  "urls": [the 3 sampled product URLs],
  "target_language": "javascript",
  "target_library": "cheerio",
  "parser_only": true,
  "schema_json": <product_schema.json>
}
```

Poll until `completed`. Call `scrapeops_get_code` and save as `product_parser_cheerio_body`.

Delete the throwaway `/tmp/scratch_crawl.mjs` now that sampling is done.

### S-Crawlee-5 — Adapter conversion (trivial for Cheerio)

Cheerio is the native parser of `CheerioCrawler` — no selector conversion. Just verify
the function signatures match the contract:

- Parameter list: `($, baseUrl)` — `$` is the Cheerio root, `baseUrl` is a string.
- Return: a plain object (the extracted data) or `null`.

If the Go backend returned a different signature (rare), normalize it before pasting.

**Validation grep** — run after writing the project (S-Crawlee-6). Must return zero matches:

```bash
grep -rE "require\(['\"]axios['\"]\)|from ['\"]axios['\"]|require\(['\"]https?['\"]\)" <slug>_crawlee/src/
```

If matches show up, the function unexpectedly contains its own HTTP client — invoke
`parser-fixer` to strip those lines, since Crawlee owns transport.

### S-Crawlee-6 — Build the Crawlee project files (structure from S-Crawlee-2 docs)

Compute `slug = <domain-slug>_crawlee` (e.g. `walmart_com_crawlee`). All files live under
`<slug>/`.

Create these files using the **layout you extracted from the docs in S-Crawlee-2**, NOT
from SKILL.md. Reference fallback templates in
`../generate-scraper/references/frameworks.md` Section B.4 if a fetch failed.

**The project must use Crawlee's full native machinery** — Cheerio selectors mixing CSS
and traversal helpers (or `page.locator('css=...')` / `page.locator('xpath=...')` for
`PlaywrightCrawler`), `createCheerioRouter()` (or `createPlaywrightRouter()`),
`useSessionPool: true` with `sessionPoolOptions`, `failedRequestHandler` writing to a
`failed` Dataset, `maxConcurrency`, `preNavigationHooks` for proxy. Required-features
list and validation greps are in `../generate-scraper/references/frameworks.md` Section
E.2 and E.3 — read those before assembling, run the greps before declaring done.

#### `<slug>/package.json`

```json
{
  "name": "<slug>",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "crawl": "node src/crawler.js",
    "scrape": "node src/scraper.js"
  },
  "dependencies": {
    "crawlee": "^3.0.0"
  }
}
```

(If browser transport — `PlaywrightCrawler` — was selected in S-Crawlee-3 because the user
asked for JS rendering, also add `"playwright": "^1.40.0"` and adjust `src/crawler.js` /
`src/scraper.js` accordingly.)

#### `<slug>/src/proxy.js`

Helper module that builds the proxy URL or `ProxyConfiguration`. Contents come from
S-Crawlee-3 (live docs). For HTTP transport (default), this module exports
`buildProxyUrl(targetUrl)` and `PROXY_BASE_URL`. For browser transport, it exports
`createProxyConfig()` returning a `ProxyConfiguration` instance.

Reference template (HTTP — Proxy API Aggregator): see fallback in
`../generate-scraper/references/frameworks.md` Section B.3 (`src/proxy.js`).

#### `<slug>/src/crawler_extractor.js`

Pastes `crawler_parser_cheerio_body` and exports it:

```javascript
// crawler_parser_cheerio_body — returned by Go backend with target_library: "cheerio".
export function extract_data($, baseUrl) {
  // ... body from crawler_parser_cheerio_body ...
}
```

#### `<slug>/src/product_extractor.js`

Same shape, with `product_parser_cheerio_body`.

#### `<slug>/src/router.js`

Single shared router with two named handlers (`LISTING`, `PRODUCT`) — even though the two
spiders run as separate processes, route through the router for clean separation of
extraction vs. orchestration. Use `createCheerioRouter()` (or `createPlaywrightRouter()`
if browser transport):

```javascript
import { createCheerioRouter, Dataset } from "crawlee";
import { extract_data as extract_listing } from "./crawler_extractor.js";
import { extract_data as extract_product } from "./product_extractor.js";

export const router = createCheerioRouter();

router.addHandler("LISTING", async ({ $, request, log }) => {
  // … extract_listing($, request.userData.originalUrl), enqueue products + next page
});

router.addHandler("PRODUCT", async ({ $, request, pushData, log }) => {
  const data = extract_product($, request.userData.originalUrl) || {};
  await pushData({ url: request.userData.originalUrl, ...data });
});

router.addDefaultHandler(async ({ request, log }) => {
  log.warning(`Unrouted request: ${request.url}`);
});
```

#### `<slug>/src/crawler.js`

Entrypoint that crawls the listing page, follows pagination to `--max-pages`, and writes
discovered URLs to a JSONL file. Use `CheerioCrawler` (HTTP) with `requestHandler: router`,
`preNavigationHooks` that rewrites `request.url` through Proxy API,
`useSessionPool: true`, `sessionPoolOptions: { maxPoolSize: 100 }`,
`failedRequestHandler` that writes to a `failed` Dataset, and `maxConcurrency: <CONCURRENCY>`.
Reference template: `../generate-scraper/references/frameworks.md` Section B.4
(`src/crawler.js`).

CLI:
```bash
node src/crawler.js --listing-url "<URL>" --max-pages <N> --output urls.jsonl
```

The `LISTING` router handler should:
- Call `extract_data($, request.userData.originalUrl)` (NOT `request.loadedUrl` — that's
  the rewritten proxy URL with `?api_key=...&url=...`; we want the original target URL).
- For each `data.products[].url`, write a JSONL line `{ url, productId, name, discoveredOnPage }`.
- If `data.pagination.nextPageUrl` is set and `page < maxPages`, push the next page via
  `crawler.addRequests([{ url, label: "LISTING", userData: { page: page + 1, originalUrl: nextUrl } }])`.

#### `<slug>/src/scraper.js`

Entrypoint that reads a JSONL of URLs and writes a JSONL of full product objects. Same
config as crawler: `requestHandler: router`, `preNavigationHooks`, `useSessionPool: true`,
`sessionPoolOptions`, `failedRequestHandler`, `maxConcurrency: <CONCURRENCY>`. Pushes
`{ url, label: "PRODUCT", userData }` per JSONL line.

CLI:
```bash
node src/scraper.js --urls-file urls.jsonl --concurrency <N> --output products.jsonl
```

The `PRODUCT` router handler calls `extract_data($, request.userData.originalUrl)` and
`pushData(...)`. The scraper script writes one JSONL line per Dataset entry on shutdown
(or streams from the dataset, your call — both work).

#### `<slug>/.gitignore`

```
node_modules/
storage/
*.jsonl
```

#### Also write

- `<slug>/crawler_schema.json` — copy the schema produced in S-Crawlee-1.
- `<slug>/product_schema.json` — copy the schema produced in S-Crawlee-4.

#### Final validation before moving to S-Crawlee-7

Two grep passes, both required:

**1) Transport-purity grep** — must return zero matches:

```bash
grep -rE "require\(['\"]axios['\"]\)|from ['\"]axios['\"]|require\(['\"]https?['\"]\)" <slug>/src/
```

If anything shows up, fix it before the smoke test (Crawlee owns transport).

**2) Native-features grep** — each line below must NOT print `MISSING:`:

```bash
grep -rE 'createCheerioRouter|createPlaywrightRouter' <slug>/src/ || echo "MISSING: router"
grep -rE 'useSessionPool\s*:\s*true' <slug>/src/ || echo "MISSING: session pool"
grep -rE 'failedRequestHandler' <slug>/src/ || echo "MISSING: failedRequestHandler"
grep -rE 'maxConcurrency' <slug>/src/ || echo "MISSING: maxConcurrency"
grep -rE 'preNavigationHooks' <slug>/src/ || echo "MISSING: proxy hooks"
```

Reference list of required features: `../generate-scraper/references/frameworks.md` Section E.2.

### S-Crawlee-7 — Install deps + smoke test + local self-heal

```bash
cd <slug>
npm install
export SCRAPEOPS_API_KEY=<value pasted by user when prompted — NEVER read from ~/.claude/settings.json>

# Smoke test crawler — max-pages=1 for speed
node src/crawler.js --listing-url "<LISTING_URL>" --max-pages 1 --output smoke_urls.jsonl
```

Validate `smoke_urls.jsonl`: file exists, has ≥1 line, first line is JSON with `url`
starting with `http`, domain matches `LISTING_URL`.

If broken, invoke `parser-fixer`:

```
Agent(
  subagent_type: "parser-fixer",
  description: "Fix Crawlee crawler",
  prompt: "The Crawlee project at <slug> runs but produces bad output from the listing crawl.

Inputs:
- project_path: <slug>
- parser_path: <slug>/src/crawler_extractor.js
- html_path: fetch fresh listing HTML via scrapeops_fetch_html and save to /tmp/<slug>_listing.html
- language: javascript
- task: Crawler extract_data($, baseUrl) returns no products / wrong URLs / wrong fields.

Run command: cd <slug> && node src/crawler.js --listing-url \"<LISTING_URL>\" --max-pages 1 --output /tmp/<slug>_smoke_urls.jsonl

CRITICAL: keep the project Cheerio-only. Do NOT add `axios`, `node-fetch`, `require('https')`,
or any hand-rolled HTTP client — Crawlee owns transport. Only the Cheerio `$` API is
allowed in the extractor. Verify with grep before finishing."
)
```

Then smoke test the scraper:

```bash
head -1 smoke_urls.jsonl > smoke_one.jsonl
node src/scraper.js --urls-file smoke_one.jsonl --output smoke_products.jsonl
```

Validate ≥1 line with valid JSON containing core product fields. Same `parser-fixer`
fallback against `<slug>/src/product_extractor.js` if broken.

### S-Crawlee-8 — Final summary (Crawlee flavor)

Show:

```
✓ Crawlee project built successfully!

Directory: ./<slug>/
  ├── package.json
  ├── README.md
  ├── crawler_schema.json
  ├── product_schema.json
  └── src/
      ├── proxy.js               — ScrapeOps Proxy API URL builder
      ├── crawler_extractor.js   — extract_data($, baseUrl) for listing pages
      ├── product_extractor.js   — extract_data($, baseUrl) for product pages
      ├── crawler.js             — listing → product URLs (JSONL)
      └── scraper.js             — product URLs → full details (JSONL)

This project is 100% Crawlee — no axios, no hand-rolled HTTP.
Selected proxy: <Proxy API Aggregator | Residential & Mobile Proxy Aggregator> — <reason>.

Setup:
  cd <slug>
  npm install
  export SCRAPEOPS_API_KEY=<your key>   # required — proxy is enabled by default

Three ways to run it:

1) Crawler only:
   node src/crawler.js --listing-url "<LISTING_URL>" --max-pages <max_pages> --output urls.jsonl

2) Scraper only (needs urls.jsonl from step 1):
   node src/scraper.js --urls-file urls.jsonl --concurrency <CONCURRENCY> --output products.jsonl

3) Both chained:
   node src/crawler.js --listing-url "<LISTING_URL>" --max-pages <max_pages> --output urls.jsonl && \
     node src/scraper.js --urls-file urls.jsonl --concurrency <CONCURRENCY> --output products.jsonl

Concurrency is controlled by `maxConcurrency` in src/crawler.js and src/scraper.js
(currently <CONCURRENCY>, matching the ScrapeOps plan limit).
```

### S-Crawlee-9 — Generate README.md (Crawlee flavor)

Write `<slug>/README.md`. Structure mirrors the Scrapy README (S9) but for Node:

- **Project summary** — `<domain>` Crawlee crawler + scraper, generated by
  `/generate-crawler-scraper` on `<date>`.
- **Metadata** — listing URL, search query, language=JavaScript, library=Crawlee
  (Cheerio transport by default, or Playwright if browser was chosen), max_pages default,
  concurrency, date, **selected proxy product** (Proxy API Aggregator vs Residential).
- **Files in this directory** — table listing each file with a 1-line description.
- **Prerequisites** — Node 18+. Show `npm install`. Show `export SCRAPEOPS_API_KEY=<your-key>`.
- **How to run** — three options (crawler only, scraper only, chained).
- **Customizing**:
  - Change search URL → `--listing-url` flag.
  - More pages → `--max-pages N`.
  - More concurrency → `--concurrency N` on the scraper, never above the ScrapeOps cap.
  - Change extracted fields → edit `src/crawler_extractor.js` / `src/product_extractor.js`.
  - Disable proxy → comment out the `preNavigationHooks` block in `src/crawler.js` /
    `src/scraper.js`.
- **Troubleshooting** — same items as Scrapy README plus "verify SCRAPEOPS_API_KEY is
  exported and `src/proxy.js` returns the rewritten URL".
- **How it works** — brief: crawler runs `CheerioCrawler` against the listing URL via the
  ScrapeOps proxy, extracts product URLs and pagination using native Cheerio `$`, writes
  JSONL; scraper reads JSONL, fetches each URL via proxy, extracts full product object.

**Important**:
- Do NOT mention `axios` anywhere. The project has no axios.
- Do NOT show absolute paths — keep instructions relative to `<slug>/`.

---

## Framework Mode notes

- **Never** mix Framework Mode with the standalone-script mode. If the user picks
  `library=scrapy` or `library=crawlee`, all output lives inside the framework project dir.
- **ScrapeOps proxy is ON by default.** Tell the user they need
  `export SCRAPEOPS_API_KEY=...` before running. To bypass the proxy, they comment out
  the middleware entry (Scrapy `settings.py`) or the `preNavigationHooks` block (Crawlee
  `src/crawler.js` / `src/scraper.js`).
- **Always consult ScrapeOps proxy docs at runtime** (S3 / S-Crawlee-3). The offline
  reference `../generate-scraper/references/proxies.md` is fallback only.
- **DO call `scrapeops_get_concurrency_limit`** — `CONCURRENT_REQUESTS` (Scrapy) or
  `maxConcurrency` (Crawlee) respects the plan cap.
- **Zero BS4 (Scrapy) or axios (Crawlee) in the generated project.** If the final grep
  matches anywhere, the skill is broken and must re-run the conversion / strip step.
- **Framework docs are the source of truth**, not SKILL.md. If Scrapy renames a setting or
  Crawlee changes a handler argument, you pick that up on the next run via S2 /
  S-Crawlee-2 fetches. No need to manually sync this skill.
- **Fallback templates exist** (Scrapy: appendix below; Crawlee:
  `../generate-scraper/references/frameworks.md` Section B) for when the framework or
  proxy docs are unreachable. Use only when fetches fail. Warn the user when falling back.
- **Fix-scraper path**: for local self-heal, invoke the `parser-fixer` agent DIRECTLY
  (not the `/fix-scraper` skill). Pass `project_path=<slug>` and the specific extractor
  file as `parser_path`. The agent must NOT reintroduce BS4 / axios — make that explicit
  in the prompt.

---

## Appendix — Scrapy fallback templates (use ONLY if `docs.scrapy.org` is unreachable)

When the S2 `curl` downloads fail (network down, all three pages unreachable), fall back to these minimal templates. They reflect the **2026-era Scrapy layout** and are known to work with Scrapy 2.x. If you can reach the docs, prefer the docs — these are offline insurance.

⚠️ **Log a warning** to the user when falling back:
> *"docs.scrapy.org unreachable — using fallback templates. If Scrapy recently changed defaults, the generated project may need manual adjustment."*

<details>
<summary>Fallback: <code>scrapy.cfg</code></summary>

```
[settings]
default = <project_pkg>.settings

[deploy]
project = <project_pkg>
```
</details>

<details>
<summary>Fallback: <code>settings.py</code></summary>

```python
import os

BOT_NAME = "<project_pkg>"
SPIDER_MODULES = ["<project_pkg>.spiders"]
NEWSPIDER_MODULE = "<project_pkg>.spiders"

SCRAPEOPS_API_KEY = os.environ.get("SCRAPEOPS_API_KEY", "")

DOWNLOADER_MIDDLEWARES = {
    "<project_pkg>.middlewares.ScrapeOpsProxyMiddleware": 725,
}

ITEM_PIPELINES = {
    "<project_pkg>.pipelines.ValidationPipeline": 100,
    "<project_pkg>.pipelines.DuplicatesPipeline": 200,
    "<project_pkg>.pipelines.NormalizationPipeline": 300,
}

CONCURRENT_REQUESTS = <CONCURRENCY>
CONCURRENT_REQUESTS_PER_DOMAIN = <CONCURRENCY>
DOWNLOAD_TIMEOUT = 60
RETRY_TIMES = 3
RETRY_HTTP_CODES = [500, 502, 503, 504, 408, 429]
DOWNLOAD_DELAY = 0

AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 1.0
AUTOTHROTTLE_MAX_DELAY = 10.0
AUTOTHROTTLE_TARGET_CONCURRENCY = <CONCURRENCY>
AUTOTHROTTLE_DEBUG = False

ROBOTSTXT_OBEY = False
LOG_LEVEL = "INFO"

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

FEED_EXPORT_ENCODING = "utf-8"
```
</details>

<details>
<summary>Fallback: <code>middlewares.py</code></summary>

```python
from urllib.parse import urlencode


class ScrapeOpsProxyMiddleware:
    """Enabled by default. Rewrites every outgoing request to route through
    https://proxy.scrapeops.io/v1/. Requires SCRAPEOPS_API_KEY in the environment."""

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
</details>

<details>
<summary>Fallback: <code>pipelines.py</code> (three real pipelines — validation, dedup, normalization)</summary>

```python
import re
from urllib.parse import urljoin

from scrapy.exceptions import DropItem


REQUIRED_FIELDS = ("url", "name")


class ValidationPipeline:
    """Drop items missing required fields."""

    def process_item(self, item, spider):
        missing = [f for f in REQUIRED_FIELDS if not item.get(f)]
        if missing:
            raise DropItem(f"Missing required fields: {missing}")
        return item


class DuplicatesPipeline:
    """Drop duplicate items by `url` (or `productId` if present)."""

    def __init__(self):
        self.seen = set()

    def process_item(self, item, spider):
        key = item.get("productId") or item.get("url")
        if key and key in self.seen:
            raise DropItem(f"Duplicate item dropped: {key}")
        if key:
            self.seen.add(key)
        return item


class NormalizationPipeline:
    """Whitespace cleanup, URL resolution, light type coercion for prices."""

    _ws_re = re.compile(r"\s+")

    def process_item(self, item, spider):
        for key, value in list(item.items()):
            if isinstance(value, str):
                item[key] = self._ws_re.sub(" ", value).strip()

        # Resolve relative URLs against the source URL stored in meta (if any).
        source = (getattr(spider, "_last_source_url", None)
                  or item.get("discoveredFromListing"))
        if source and item.get("url") and not item["url"].startswith("http"):
            item["url"] = urljoin(source, item["url"])

        # Coerce price-like fields to float.
        for k in ("price", "originalPrice"):
            v = item.get(k)
            if isinstance(v, str):
                m = re.search(r"-?\d+(?:[\.,]\d+)?", v)
                if m:
                    try:
                        item[k] = float(m.group(0).replace(",", "."))
                    except ValueError:
                        pass
        return item
```
</details>

<details>
<summary>Fallback: <code>items.py</code> skeleton (Item + ItemLoader subclass)</summary>

```python
import scrapy
from itemloaders.processors import TakeFirst, MapCompose, Join, Identity


def _strip(v):
    return v.strip() if isinstance(v, str) else v


class ProductItem(scrapy.Item):
    # Generate one scrapy.Field() per top-level key in product_schema.json.
    # Example fields — actually emit only the ones present in the schema:
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


class ProductLoader(scrapy.loader.ItemLoader):
    """Centralizes per-field cleanup so spiders stay small."""

    default_output_processor = TakeFirst()
    default_input_processor = MapCompose(_strip)

    # List-shaped fields keep their list shape:
    images_out = Identity()
    reviews_out = Identity()
    features_out = Identity()
    specifications_out = Identity()

    # Joined-text fields get concatenated with spaces:
    description_out = Join(" ")
```
</details>

<details>
<summary>Fallback: <code>spiders/crawler.py</code> skeleton (paste the CONVERTED extract_data, not BS4)</summary>

```python
import scrapy
from urllib.parse import urljoin


# <crawler_parser_scrapy_body> — the Scrapy-pure extract_data(response, base_url) from S5.
# NEVER paste the BS4 version here.
<crawler_parser_scrapy_body>


class CrawlerSpider(scrapy.Spider):
    """Discovers product URLs from a listing page and follows pagination."""

    name = "crawler"

    def __init__(self, listing_url=None, max_pages="1", *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not listing_url:
            raise ValueError("listing_url is required (-a listing_url=...)")
        self.listing_url = listing_url
        self.max_pages = int(max_pages)
        self._seen = set()

    def start_requests(self):
        yield scrapy.Request(self.listing_url, callback=self.parse_listing, meta={"page": 1})

    def parse_listing(self, response):
        page = response.meta.get("page", 1)
        data = extract_data(response, response.url) or {}

        for product in data.get("products") or []:
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
</details>

<details>
<summary>Fallback: <code>spiders/product.py</code> skeleton (paste the CONVERTED extract_data, not BS4)</summary>

```python
import json
import scrapy

from <project_pkg>.items import ProductItem, ProductLoader


# <product_parser_scrapy_body> — the Scrapy-pure extract_data(response, base_url) from S5.
# Mixes response.css(...) and response.xpath(...). NEVER paste the BS4 version here.
<product_parser_scrapy_body>


class ProductSpider(scrapy.Spider):
    """Reads a JSONL file of URLs (one {"url": "..."} per line) and extracts product details."""

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
        source_url = response.meta.get("source_url") or response.url
        self._last_source_url = source_url  # consumed by NormalizationPipeline for URL resolution
        raw = extract_data(response, source_url) or {}
        loader = ProductLoader(item=ProductItem(), response=response)
        loader.add_value("url", source_url)
        for key, value in raw.items():
            if key == "url":
                continue
            if key in ProductItem.fields:
                loader.add_value(key, value)
        yield loader.load_item()
```
</details>

<details>
<summary>Fallback: venv setup commands (macOS/Linux)</summary>

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install scrapy
export SCRAPEOPS_API_KEY=<your key>
```

Windows (git-bash / WSL): same but `source .venv/Scripts/activate`.
Windows (cmd / PowerShell): `.venv\Scripts\activate.bat` or `.venv\Scripts\Activate.ps1`.
</details>
