---
name: generate-scraper
description: Use this skill ONLY when the user explicitly asks to generate, build, create, or write a scraper/parser for SPECIFIC URLs they already have. Trigger phrases: "generate scraper", "build scraper", "make scraper", "new scraper", "create a scraper", "write a scraper", "I need a scraper", "generate a scraper for", "build a scraper for", "create scraper for". Do NOT trigger for generic requests like "fetch this page", "download HTML", "get the content of this URL", "scrape this" (without mentioning scraper/parser), or any request that is not specifically about generating a reusable scraper file. IMPORTANT: Do NOT trigger if the user mentions "crawler" anywhere in their request — use the generate-crawler-scraper skill instead. If the request mentions "crawler", "crawler + scraper", "crawler-scraper", "crawl", "search for X on site Y", "busca", "buscando", or describes discovering/collecting product URLs from a listing page, use generate-crawler-scraper, NOT this skill.
version: 3.0.0
---

# ScrapeOps — Generate Scraper Skill

Generates a production-ready single-URL scraper using the ScrapeOps AI backend via the `scrapeops` MCP server. The generated script:

- Accepts a URL as a CLI argument at runtime.
- Fetches HTML **in-memory** through the ScrapeOps proxy (`https://proxy.scrapeops.io/v1/` for HTTP-client libs, or `residential-proxy.scrapeops.io:8181` for browser-based libs).
- Runs the extractor and writes the result to a JSONL output file.
- Reads the API key from the `SCRAPEOPS_API_KEY` environment variable.
- Ships with a `README.md` that explains install, env setup, and usage.

No HTML is downloaded to disk at generation time. No execution happens at the end — the user runs the scraper manually against any URL they want.

## Overview

1. Collect inputs (URLs, language, library)
2. Submit job via `scrapeops_submit_job` with `parser_only: false` + `include_api_key: false`
3. Poll until complete via `scrapeops_poll_status`
4. Retrieve the full scraper via `scrapeops_get_code`
5. Install dependencies (optional)
6. Save the file verbatim, then apply two targeted Edits: (a) API-key env var, (b) hardcoded URL list → CLI arg
7. Generate `<domain>_README.md`
8. Show the final summary — do NOT execute the scraper

> **API key handling:** The MCP server reads `SCRAPEOPS_API_KEY` from `~/.claude/settings.json` automatically. Do NOT check or validate it before making tool calls. If a MCP tool call fails with "SCRAPEOPS_API_KEY is not configured", handle it inline:
> 1. Ask the user: "Enter your ScrapeOps API key (find it at https://scrapeops.io/app/dashboard):"
> 2. Read `~/.claude/settings.json`, add the key to `env.SCRAPEOPS_API_KEY` using Edit, and retry the failed tool call
> 3. Do NOT tell the user to run `/scrapeops-setup` or restart — just ask, save, and continue

---

## Step 1 — Collect Inputs

| Slot | Required |
|------|----------|
| `urls` | Yes — 1 to 5 URLs from the same domain. They are used ONLY as generation-time samples to teach the backend the page structure. At runtime the generated script accepts a single URL via CLI. |
| `language` | Yes — always ask if not explicitly provided |
| `library` | Yes — always ask if not explicitly provided |
| `country` | No — skip if not mentioned |

**Rule: never assume language or library.** Ask one at a time using `AskUserQuestion`. Only skip a question if the user already stated that value clearly.

> **🚨 MANDATORY BEFORE MOVING TO STEP 2:** After collecting language + library + URLs, you MUST run **Step 1.5 (search-page detection)** below. Do NOT jump straight from Step 1.4 to Step 2 — Step 1.5 routes the user to **Search Page Mode** when their URL is a search/query page (e.g. `?q=...`, `/search?...`). Skipping Step 1.5 produces a broken single-URL scraper for what should have been a keyword-loop search scraper. This applies even when the user already provided language and library up front — the routing decision is independent of Steps 1.1–1.4.

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

Use the EXACT labels and descriptions below. Do NOT add any marker like "(default)" / "(recommended)" / "most common" / "default choice" / "popular", and do NOT reorder the options.

**Python:**
```
question: "Which Python library?"
header: "Library"
options:
  - label: "BeautifulSoup"
    description: "HTML parser used with the requests HTTP client."
  - label: "Scrapy"
    description: "Full framework with project structure, middlewares, and built-in concurrency."
  - label: "Playwright"
    description: "Real browser — use when JS rendering is required."
  - label: "Selenium"
    description: "Real browser (older) — use when JS rendering is required."
```

**JavaScript:**
```
question: "Which JavaScript library?"
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

**Scrapy and Crawlee are framework libraries — if the user picks one, take a completely
different path (Framework Mode).** They impose their own project structure, request
lifecycle, and middleware system, so the standard monolithic template from the Go backend
doesn't fit. After Step 1.4, if the chosen library is Scrapy or Crawlee, **skip Steps 2–10
below and go straight to the `# Framework Mode (Scrapy / Crawlee)` section at the end of
this skill.** Steps 2–10 assume a single standalone script with backend-baked proxy.

**PHP / Ruby / Go / Rust / Java / C#:** use `AskUserQuestion` with the options from `references/languages.md`. Apply the same "no preference marker" rule — don't add `(recommended)` / `(default)` anywhere.

### 1.3 — URLs (if not provided)

If the user didn't include a URL, ask: "Paste 1–5 URLs from the target website (same domain). These are used only as generation-time samples — the generated script will accept any URL via CLI."

### 1.4 — Map to API values

Use `references/languages.md` to map language + library selections to the correct `target_language` and `target_library` API values.

### 1.5 — 🚨 MANDATORY: Detect search-page URLs (route to Search Page Mode if matched)

**This step is REQUIRED on every run. Do NOT skip to Step 2 without executing the detection below — even if the user provided language/library up front and you're tempted to "just go to confirmation".** Search-page URLs need a totally different scraper shape (keyword × filters × pagination loop, not single-URL fetch). Missing this step produces the wrong scraper.

After collecting URLs (and before confirming in Step 2), run a quick heuristic on each URL to detect search pages. A search page is a URL whose query string carries a search keyword (`?k=`, `?q=`, `?query=`, `?s=`, `?search=`, `?term=`, `?kw=`, `?keyword(s)=`) OR whose path looks like a search route (`/search`, `/s/`, `/busca`, `/find`, `/results`).

Apply both regexes via Bash:

```bash
SEARCH_URL_REGEX='[?&](k|q|query|search|s|term|kw|keywords?)=[^&]+'
SEARCH_PATH_REGEX='/(search|s|busca|find|results)(/|\?|$)'
echo "<URL>" | grep -E "$SEARCH_URL_REGEX|$SEARCH_PATH_REGEX"
```

If **any** of the user's URLs matches either regex, ask via `AskUserQuestion`:

```
question: "I detected a search page. Build a search scraper (keyword × filters × pagination loop)?"
header: "Search mode"
options:
  - label: "Yes — build a search scraper"
    description: "Loops over keywords, filters, and pages. Output: cards from search results page."
  - label: "No — single URL only"
    description: "Just scrape this exact URL once (default generate-scraper behavior)."
```

Routing based on the answer:

- **"Yes" + library ∈ {BeautifulSoup, Cheerio}** → SKIP Steps 2–10 below and jump to the `# Search Page Mode (BS4 / Cheerio)` section at the end of this skill.
- **"Yes" + library ∈ {Scrapy, Crawlee}** → ask the follow-up below; Search Page Mode currently only supports BS4 / Cheerio (Phase 1):
  ```
  question: "Search Page Mode currently supports BeautifulSoup (Python) or Cheerio (JS) only. What do you prefer?"
  header: "Switch path"
  options:
    - label: "Switch library to BeautifulSoup"
    - label: "Switch library to Cheerio (JavaScript)"
    - label: "Keep <Scrapy|Crawlee> but treat the URL as a single-URL job (no keyword loop)"
  ```
  Apply the user's choice — re-derive `target_library` from `references/languages.md` and proceed (Search Page Mode if BS4/Cheerio chosen; Framework Mode if Scrapy/Crawlee retained).
- **"No"** → proceed with Steps 2–10 below as a standard single-URL scraper, OR Framework Mode if library is Scrapy/Crawlee.

If no URL matches the regex, skip this step entirely and continue to Step 2.

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
- `parser_only`: `false` — request the full runnable scraper (with proxy fetcher), not just the `extract_data` snippet
- `include_api_key`: `false` — the backend will emit `"YOUR-API-KEY"` as a placeholder, which Step 6 replaces with an env-var read

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

The tool waits 30 seconds internally before making the request — no sleep needed on your side.

After each call:
- Show: `[Poll #N] <_summary field from response>`
- `status = "completed"` → proceed to Step 5
- `status = "error"` / `"failed"` / `"wrong_page_type"` / `"cancelled"` / `"expired"` → show `error_message` and stop
- Any other status (`queued`, `processing`, `running`, `step_N`, `generating_*`, `refactoring`, `ai_fix_suggestions`, `agent_fix`, `re_execute_parser`) → call `scrapeops_poll_status` again

**CRITICAL — ONLY proceed when `status === "completed"`.** Never based on `completed_at` being set, never based on `_summary` text, never based on elapsed time. Only the literal string `"completed"` in the `status` field. `scrapeops_poll_status` intentionally does NOT return `output_code` / `link_output_code` — those are only available via `scrapeops_get_code` in Step 5.

Jobs typically take 5–15 minutes but can take longer when the backend runs validation/self-heal loops. Keep polling silently until a terminal status. Never surface a "Stuck job" question.

Capture `install_command` from the final response.

---

## Step 5 — Retrieve the Generated Code

Call **`scrapeops_get_code`** MCP tool with:
- `version_id`

On success it returns `{ code, language, library, install_command, version_id }`. Use the `code` field for the Write in Step 7.

If the tool errors saying the job isn't completed yet, loop back to Step 4 and keep polling.

---

## Step 6 — Install Dependencies

If `install_command` is non-empty, show the command and ask via `AskUserQuestion`:

```
question: "Install dependencies now?"
header: "Dependencies"
options:
  - label: "Yes, run"
  - label: "No, I'll install later"
```

**For Python** (language = `python`) — **always use a venv**. `pip install` directly on system Python fails on macOS/Homebrew, Ubuntu 23.04+, Debian 12+, Fedora 38+ and other modern distros because of [PEP 668](https://peps.python.org/pep-0668/). Detect and skip only if the user is already inside a venv (`$VIRTUAL_ENV` is set) or inside a Docker/CI container (`$CI`, `/.dockerenv`).

Flow:
1. Check env: `[ -n "$VIRTUAL_ENV" ]` — if already in a venv, just run `pip install <pkgs>`.
2. Otherwise, create a project-local venv:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install <pkgs from install_command>
   ```
3. Tell the user: *"Created a venv at `.venv/`. Before running the scraper later, activate it: `source .venv/bin/activate`."*
4. Include that activation step in the README (Step 8).

**For JavaScript / Node.js** — just run `npm install <pkgs>` in the current directory. Create `package.json` if missing: `npm init -y` first.

**For other languages (PHP, Ruby, Go, Rust, Java, C#)** — show the install command from `install_command` and ask the user to install manually; don't try to run language-specific package managers from the skill.

---

## Step 7 — Save the Scraper File

Compute the domain slug from the first URL: `books.toscrape.com` → `books_toscrape_com`. Extension by language: `.py`, `.js`, `.php`, `.rb`, `.go`, `.rs`, `.java`, `.cs`.

Save `<slug>_scraper.<ext>` using the **Write** tool (never echo/heredoc).

**CRITICAL — save VERBATIM.** Write exactly what `scrapeops_get_code` returned in the `code` field. Do NOT refactor, reformat, rename variables, add type hints, add docstrings, remove comments, or "clean up" imports. The only modifications allowed are the two targeted Edits in Step 8.

---

## Step 8 — Refactor the saved file for CLI use

The Go backend emits a template with (a) a hardcoded `"YOUR-API-KEY"` literal, and (b) a hardcoded list of URLs inside `main()` / `if __name__ == "__main__"` / equivalent. Two Edits fix both.

### 8.1 — Replace `"YOUR-API-KEY"` with an env-var read

Use **Edit** on the saved file:

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

The assignment in the template usually looks like `API_KEY = "YOUR-API-KEY"` (or the language equivalent). The Edit's `old_string` should include the quotes — e.g. `old_string = "YOUR-API-KEY"`, `new_string = os.environ.get("SCRAPEOPS_API_KEY", "")` — so the surrounding assignment becomes `API_KEY = os.environ.get("SCRAPEOPS_API_KEY", "")`.

For Python, ensure `import os` is at the top of the file. If missing, add it.
For Go, ensure `"os"` is in the import block.
For Rust, no extra import needed (`std::env` is stdlib).
For Java/C#, ensure `System` / `Environment` namespaces are accessible (usually yes by default).

### 8.2 — Replace the hardcoded URL list with a CLI arg read

The template iterates over a hardcoded list. The user runs the script with **one** URL at the CLI:

```
python3 <slug>_scraper.py <url>
node <slug>_scraper.js <url>
php <slug>_scraper.php <url>
ruby <slug>_scraper.rb <url>
go run <slug>_scraper.go <url>
cargo run -- <url>       # Rust, inside a cargo project
java <ClassName> <url>
dotnet run -- <url>      # C#
```

Find the hardcoded URL list in the saved file by running Bash with `grep -n` using a language-appropriate pattern:

| Language | grep pattern |
|----------|--------------|
| Python | `urls = \[` or `URLS = \[` |
| JavaScript | `const urls = \[` or `let urls = \[` or `urls: \[` |
| PHP | `\$urls = \[` |
| Ruby | `urls = \[` |
| Go | `urls := \[\]string{` |
| Rust | `let urls = vec!\[` or `let urls: Vec<.*?> = vec!\[` |
| Java | `String\[\] urls = {` or `List<String> urls = ` |
| C# | `string\[\] urls = {` or `var urls = new .*?{` |

Use Read to see the full block (from the `urls = [` start through the closing `]`). Then Edit replacing the entire block with CLI arg parsing:

| Language | Replacement block |
|----------|-------------------|
| **Python** | ```python<br>import sys<br>if len(sys.argv) < 2:<br>    sys.exit("Usage: python3 <script>.py <url>")<br>urls = [sys.argv[1]]<br>``` |
| **JavaScript** | ```js<br>if (process.argv.length < 3) {<br>  console.error("Usage: node <script>.js <url>");<br>  process.exit(1);<br>}<br>const urls = [process.argv[2]];<br>``` |
| **PHP** | ```php<br>if ($argc < 2) { fwrite(STDERR, "Usage: php <script>.php <url>\n"); exit(1); }<br>$urls = [$argv[1]];<br>``` |
| **Ruby** | ```ruby<br>abort("Usage: ruby <script>.rb <url>") if ARGV.empty?<br>urls = [ARGV[0]]<br>``` |
| **Go** | ```go<br>if len(os.Args) < 2 { fmt.Fprintln(os.Stderr, "Usage: go run <script>.go <url>"); os.Exit(1) }<br>urls := []string{os.Args[1]}<br>``` |
| **Rust** | ```rust<br>let url = std::env::args().nth(1).unwrap_or_else(\|\| { eprintln!("Usage: <bin> <url>"); std::process::exit(1); });<br>let urls = vec![url];<br>``` |
| **Java** | ```java<br>if (args.length < 1) { System.err.println("Usage: java <Class> <url>"); System.exit(1); }<br>String[] urls = { args[0] };<br>``` |
| **C#** | ```csharp<br>if (args.Length < 1) { Console.Error.WriteLine("Usage: dotnet run -- <url>"); Environment.Exit(1); }<br>string[] urls = { args[0] };<br>``` |

For Python, also ensure `import sys` is at the top (add if missing). For Go, ensure `"fmt"` and `"os"` are in the import block.

After Edit, verify with grep:
- The hardcoded URLs are gone: `grep -n '<original-URL>' <file>` should return nothing.
- The CLI arg parsing is present: `grep -n 'argv\|ARGV\|Args\|os.Args\|std::env::args' <file>` should show matches.

If the backend's template uses a different URL-list shape than the patterns above (can happen for PHP/Ruby/Go/Rust/Java/C# since those don't have dedicated templates in the backend and the LLM produces variable shapes), use judgment:
- Grep broadly for string literals that look like URLs.
- Read the surrounding 20-40 lines to understand the entry-point structure.
- Replace the initialization of whatever variable holds the URL list with the CLI arg read.
- Preserve any loop/worker structure that iterates over that variable.

---

## Step 9 — Generate `<slug>_README.md`

Use the **Write** tool to create a README that explains:

1. **What the scraper does** — one paragraph.
2. **Prerequisites** — runtime version (Python 3.9+ / Node 18+ / PHP 8.1+ / etc.).
3. **Install** — the `install_command` from Step 5. For Python, show venv setup commands first:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   <install_command>
   ```
4. **Set the API key** — export env var:
   ```bash
   export SCRAPEOPS_API_KEY=<your-scrapeops-key>
   ```
   Find the key at https://scrapeops.io/app/dashboard.
5. **Run** — one line showing the CLI form for the chosen language:
   ```bash
   python3 <slug>_scraper.py "<url>"
   ```
   (or `node …`, `php …`, `ruby …`, `go run …`, `cargo run -- …`, `java …`, `dotnet run -- …`).
6. **Output** — one paragraph on where the output goes (default JSONL filename from the template, one line per URL processed). For single-URL runs, the file will have a single JSON line.
7. **How it works under the hood** — brief: fetches through `https://proxy.scrapeops.io/v1/?api_key=$SCRAPEOPS_API_KEY&url=<url>` (or residential proxy for browser libs), runs the extractor, writes JSONL.
8. **Troubleshooting**:
   - `SCRAPEOPS_API_KEY not set` → `echo $SCRAPEOPS_API_KEY` should be non-empty.
   - HTTP 401/403 → check the key at the dashboard.
   - Empty output → the page may need JS rendering; regenerate with Playwright/Selenium/Puppeteer.

Keep the README concise (under 100 lines). Do NOT include examples of the expected output JSON — the user will see it when they run the script.

---

## Step 10 — Final Summary

Show:

```
Scraper generated successfully!

Files saved:
  <slug>_scraper.<ext>
  <slug>_README.md

Language: <language> / <library>
Job ID: <version_id>

Before running:
  export SCRAPEOPS_API_KEY=<your-key>

Run:
  python3 <slug>_scraper.py "<any URL from the same domain>"
```

**Do NOT execute the scraper.** The user runs it manually with whatever URL they want. Never download HTML locally. Never invoke the parser at this step. The job is done.

---

## Error Handling

| Situation | Response |
|-----------|----------|
| Missing API key on MCP call | Ask user inline (see box at top), save to `~/.claude/settings.json`, retry |
| `scrapeops_submit_job` returns error | Show full response, stop |
| `scrapeops_poll_status` returns an error status | Show `error_message`, stop |
| `scrapeops_get_code` returns `_error` (job not completed) | Loop back to Step 4 and keep polling |
| `scrapeops_get_code` returns `_error: "neither output_code nor link_output_code is set"` | Show warning + raw response, stop |
| Step 8.2 grep finds no URL list (non-Python/JS language with off-template LLM output) | Read the file, use judgment to locate the URL variable, Edit accordingly. If the structure is truly opaque, show the user the saved file and ask them to wire the CLI arg themselves — don't guess blindly. |

---

## Important Notes

- The `scrapeops` MCP server is started automatically by the plugin — no manual setup.
- `parser_only: false` + `include_api_key: false` are the two flags that matter for the standard flow (Steps 2–10). Framework Mode (Scrapy/Crawlee) uses `parser_only: true` instead.
- All URLs must be from the same domain — the backend validates this.
- Maximum 5 URLs per job — they are generation-time samples, not runtime inputs.
- The generated script runs on ONE URL at a time (from CLI). For batch use, the user calls the script multiple times or wraps it in a loop.
- No smoke test, no local HTML download, no parser execution at generation time. The standard skill ends at Step 10. Framework Mode runs a smoke test (FM-Step 7) because frameworks have non-trivial wiring that benefits from a single end-to-end check.

---

# Framework Mode (Scrapy / Crawlee)

Active when the user picks `Python + Scrapy` or `JavaScript + Crawlee` in Step 1. The Go
backend doesn't return monolithic Scrapy projects or Crawlee projects — it returns
extractor functions in BeautifulSoup (Python) or Cheerio (JavaScript) and the skill **builds
the framework project locally** around them. ScrapeOps proxy is injected via the
framework's idiomatic mechanism (Scrapy `DownloaderMiddleware`, Crawlee
`preNavigationHooks` / `ProxyConfiguration`).

Reference files:
- `references/frameworks.md` — templates, BS4→Scrapy and Cheerio→Crawlee cheatsheets, decision matrix.
- `references/proxies.md` — offline fallback for the two ScrapeOps proxy product docs.

## FM-Step 1 — Confirmation (replaces Step 2)

Show a summary table identifying Framework Mode explicitly:

```
Now let me confirm before submitting (Framework Mode):

| Field        | Value                          |
|--------------|--------------------------------|
| **URL**      | <url>                          |
| **Language** | <language>                     |
| **Library**  | <library>  (framework mode)    |
| **Country**  | <country or "not set">         |
```

Then ask via `AskUserQuestion`:

```
question: "Does everything look correct?"
header: "Confirm"
options:
  - label: "Yes, generate it"
  - label: "No, change something"
```

## FM-Step 2 — Fetch framework docs (mandatory)

Download the canonical framework docs to `/tmp/`. **Use `Bash curl` with a browser
User-Agent**, not `WebFetch` (Cloudflare blocks it on `docs.scrapy.org`; `crawlee.dev` is
usually fine via WebFetch but curl is the safe default).

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
```

For **Scrapy**:
```bash
curl -sSL -A "$UA" "https://docs.scrapy.org/en/latest/intro/tutorial.html" -o /tmp/scrapy_tutorial.html
curl -sSL -A "$UA" "https://docs.scrapy.org/en/latest/topics/settings.html" -o /tmp/scrapy_settings.html
curl -sSL -A "$UA" "https://docs.scrapy.org/en/latest/topics/downloader-middleware.html" -o /tmp/scrapy_middleware.html
```

For **Crawlee**:
```bash
curl -sSL -A "$UA" "https://crawlee.dev/docs/quick-start" -o /tmp/crawlee_quickstart.html
curl -sSL -A "$UA" "https://crawlee.dev/docs/guides/proxy-management" -o /tmp/crawlee_proxy.html
curl -sSL -A "$UA" "https://crawlee.dev/api/cheerio-crawler/class/CheerioCrawler" -o /tmp/crawlee_cheerio.html
```

Verify each file is non-empty HTML (`head -c 200 /tmp/<file> | grep -q "<html\|<!DOCTYPE"`).
If ALL fail, fall back to `references/frameworks.md` and warn the user.

## FM-Step 3 — Fetch ScrapeOps proxy docs (MANDATORY every run)

This is non-negotiable. The plugin must consult both proxy product docs **before** writing
any proxy code, on every Framework Mode run. Order:

1. **Try `WebFetch`** for both URLs:
   - `https://scrapeops.io/docs/web-scraping-proxy-api-aggregator/quickstart/`
   - `https://scrapeops.io/docs/residential-mobile-proxy-aggregator/overview/`

   Use a prompt that extracts: endpoint URL, auth method, target-URL parameter, listed
   optional parameters, Python and JS snippets. If both succeed and contain those
   fields, proceed to FM-Step 4 with the live data.

2. If WebFetch fails (403, timeout, empty), **fall back to `Bash curl`** with the same UA
   pattern as FM-Step 2:
   ```bash
   curl -sSL -A "$UA" "https://scrapeops.io/docs/web-scraping-proxy-api-aggregator/quickstart/" -o /tmp/scrapeops_proxy_api.html
   curl -sSL -A "$UA" "https://scrapeops.io/docs/residential-mobile-proxy-aggregator/overview/" -o /tmp/scrapeops_residential.html
   ```
   Then `Read` + `Grep` to extract the same fields.

3. If both methods fail for both URLs, fall back to `references/proxies.md` and **warn the
   user explicitly**:
   > *scrapeops.io docs unreachable — using offline reference. The generated proxy code
   > reflects a 2026-04 snapshot; verify against the live docs before running in
   > production.*

The skill does NOT proceed to FM-Step 5 until it has, for both proxy products: the
endpoint, the auth format, and at least the listed optional parameters.

## FM-Step 4 — Submit the parser-only job

Call **`scrapeops_submit_job`** with the **intermediate** `target_library` from
`references/languages.md`:

| Framework | `target_language` | `target_library` (intermediate) | `parser_only` |
|---|---|---|---|
| Scrapy | `python` | `beautifulsoup` | `true` |
| Crawlee | `javascript` | `cheerio` | `true` |

Other parameters: `urls` (the user's input URLs), no `scraper_type` (let backend
auto-detect), no `include_api_key` (irrelevant when `parser_only: true` — there's no proxy
fetcher to inject the key into).

Poll with **`scrapeops_poll_status`** as in Step 4 — only proceed when
`status === "completed"`. Then call **`scrapeops_get_code`** and save the returned `code`
in memory as `extract_data_body` (a Python BS4 function for Scrapy, or a JS Cheerio
function for Crawlee).

## FM-Step 5 — Convert / adapt the extractor

### Scrapy (BS4 → native Scrapy selectors)

The Go backend returns `def extract_data(soup, base_url=None) -> dict`. Convert to
`def extract_data(response, base_url=None) -> dict` using the cheatsheet in
`references/frameworks.md` (Section A.2). Save the result as `extract_data_scrapy_body`.

**Validation grep** — ABSOLUTE rule, must return zero matches:
```bash
grep -E 'BeautifulSoup|from bs4|import bs4|soup\.|\.get_text\(|\.prettify\(\)' <converted_file>
```

If after one rewrite pass any token remains, invoke the `parser-fixer` agent on the file
with explicit "do NOT keep BS4 tokens" instructions.

### Crawlee (Cheerio adapter)

The Go backend returns `function extract_data($, baseUrl) { ... }` using Cheerio. Cheerio
**is** the native parser inside Crawlee's `CheerioCrawler` — no selector conversion
needed. Just save the body verbatim as `extract_data_body` for use in `src/extractor.js`.

**Validation grep** — must return zero matches in the final project:
```bash
grep -rE "require\(['\"]axios['\"]\)|from ['\"]axios['\"]|require\(['\"]https?['\"]\)" <slug>_crawlee/src/
```

## FM-Step 6 — Choose the proxy product

Apply the decision matrix from `references/frameworks.md` Section C and `references/proxies.md`:

| Framework + transport | Proxy product | Why |
|---|---|---|
| Scrapy default downloader | **Proxy API Aggregator** | URL rewrite is clean in Scrapy middleware; pay-per-success cheapest |
| Crawlee `CheerioCrawler` (default) | **Proxy API Aggregator** | URL rewrite via `preNavigationHooks`; pay-per-success |
| Crawlee `PlaywrightCrawler` (if user explicitly asked for browser/JS render) | **Residential & Mobile Proxy Aggregator** | URL rewrite breaks browser navigation; need real proxy on the wire |

Print the choice and reason to the user (one line each):

> *Selected proxy: **\<product\>** — \<one-line reason\>.*

For the first cut of Crawlee, default to `CheerioCrawler` + Proxy API Aggregator. Switch
to `PlaywrightCrawler` + Residential only if the user said they need JS rendering (you can
ask if unsure).

## FM-Step 7 — Assemble the framework project

Use templates from `references/frameworks.md` filled with values gathered so far.
**Critically — every Framework Mode project must include the framework's native machinery
(items + loaders, real pipelines, middlewares, sessions, routers, failed-request handlers,
autothrottle/concurrency).** A thin wrapper around `extract_data(...)` is NOT acceptable.
The required-features list is in `references/frameworks.md` Section E (E.1 for Scrapy, E.2
for Crawlee, E.3 for the validation greps you must run before declaring the project done).

Compute:

- `slug = <domain-slug>` (e.g. `books_toscrape_com` → `books_toscrape_com_scrapy` or
  `books_toscrape_com_crawlee`).
- For Scrapy: `project_pkg = <domain-slug>` (no dashes, valid Python identifier).
- API key: read from env var `SCRAPEOPS_API_KEY` at runtime — NEVER bake into source.

### Scrapy single-URL project

Write the files documented in `references/frameworks.md` Section A.3, with **all features
from Section E.1 wired in** (selectors mixing CSS+XPath, ItemLoader, three real Item
Pipelines, autothrottle in settings, both `ScrapeOpsProxyMiddleware` and Scrapy's built-in
`RetryMiddleware` configured):

- `<slug>_scrapy/scrapy.cfg`
- `<slug>_scrapy/<project_pkg>/__init__.py` (empty)
- `<slug>_scrapy/<project_pkg>/settings.py` — populated with `AUTOTHROTTLE_ENABLED = True`,
  `RETRY_TIMES`, `RETRY_HTTP_CODES`, `ITEM_PIPELINES` registering all three real pipelines,
  `DOWNLOADER_MIDDLEWARES` with `ScrapeOpsProxyMiddleware`.
- `<slug>_scrapy/<project_pkg>/items.py` — `ProductItem(scrapy.Item)` with one
  `scrapy.Field()` per top-level key returned by `extract_data`, **plus** a
  `ProductLoader(scrapy.loader.ItemLoader)` subclass with `default_output_processor`,
  `_in` / `_out` processors per field (`MapCompose(str.strip)`, `TakeFirst()`,
  `Identity()` for lists, `Join(" ")` for joined text).
- `<slug>_scrapy/<project_pkg>/pipelines.py` — three real classes:
  `ValidationPipeline` (drops items missing required keys), `DuplicatesPipeline`
  (tracks `url`/`productId` in a set), `NormalizationPipeline` (whitespace + URL
  resolution + numeric coercion). Each raises `DropItem` from `scrapy.exceptions` where
  appropriate.
- `<slug>_scrapy/<project_pkg>/middlewares.py` — `ScrapeOpsProxyMiddleware` populated with
  the endpoint and auth format from FM-Step 3 (live docs preferred).
- `<slug>_scrapy/<project_pkg>/spiders/__init__.py` (empty)
- `<slug>_scrapy/<project_pkg>/spiders/scraper.py` — pastes `extract_data_scrapy_body`
  (which mixes `response.css` and `response.xpath` per Section A.2) and defines
  `ScraperSpider` with `-a url=` CLI arg. The spider's `parse_product` populates
  `ProductLoader` (NOT a raw dict) and yields `loader.load_item()`.

### Crawlee single-URL project

Write the files documented in `references/frameworks.md` Section B.3, with **all features
from Section E.2 wired in** (router with default handler, `useSessionPool: true`,
`failedRequestHandler` writing to a `failed` Dataset, `maxConcurrency`,
`preNavigationHooks` for proxy):

- `<slug>_crawlee/package.json`
- `<slug>_crawlee/src/extractor.js` — `export function extract_data($, baseUrl) { ... }`
  with the body from `extract_data_body`. Uses both CSS (`$('selector')`) and XPath where
  appropriate (`.find()` traversal helpers, or for `PlaywrightCrawler` `page.locator('xpath=//...')`).
- `<slug>_crawlee/src/router.js` — `createCheerioRouter()` (or `createPlaywrightRouter()`)
  with a single `default` handler that calls `extract_data($, request.userData.originalUrl)`
  and `pushData(...)`. Even for one URL, route through the router.
- `<slug>_crawlee/src/proxy.js` — Proxy API Aggregator URL builder (or Residential
  `ProxyConfiguration` if browser transport was chosen in FM-Step 6).
- `<slug>_crawlee/src/main.js` — `CheerioCrawler` (or `PlaywrightCrawler`) with:
  `requestHandler: router`, `preNavigationHooks` rewriting URL through Proxy API,
  `useSessionPool: true`, `sessionPoolOptions: { maxPoolSize: 100 }`,
  `failedRequestHandler` pushing to a `failed` Dataset, `maxRequestsPerCrawl: 1` for the
  single-URL skill, `maxConcurrency: 1`.

After writing, run **both** sets of validation greps:

1. From FM-Step 5: zero `BeautifulSoup`/`from bs4`/etc. (Scrapy) or
   `axios`/`require('http')` (Crawlee) matches.
2. From `references/frameworks.md` Section E.3: each required native feature must be
   detectable via grep. If any prints `MISSING:`, the project is broken — fix the
   assembly before moving to FM-Step 8.

## FM-Step 8 — Smoke test (1 URL) + local self-heal

Run the project against the user's first URL. The framework's wiring is non-trivial; a
smoke test catches assembly mistakes before the user sees them.

### Scrapy

```bash
cd <slug>_scrapy
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip
pip install scrapy
export SCRAPEOPS_API_KEY=<value>   # ask user via AskUserQuestion if not in env
scrapy crawl scraper -a url="<first user URL>" -O smoke_out.jsonl
```

Validate `smoke_out.jsonl`: file exists, has ≥1 line, the line is valid JSON with at least
the top-level fields the schema implied (e.g. `name`, `price`, etc.).

If broken, fetch the URL's HTML via `scrapeops_fetch_html`, save to
`/tmp/<slug>_sample.html`, and invoke `parser-fixer` directly:

```
Agent(
  description: "Fix Scrapy spider locally",
  subagent_type: "parser-fixer",
  prompt: "Fix the Scrapy spider at <slug>_scrapy/<project_pkg>/spiders/scraper.py.

Inputs:
- project_path: <slug>_scrapy
- parser_path: <slug>_scrapy/<project_pkg>/spiders/scraper.py (the extract_data function inside)
- html_path: /tmp/<slug>_sample.html
- language: python
- task: Smoke test failed — <stderr or empty output description>.

Run command: cd <slug>_scrapy && scrapy crawl scraper -a url=\"<URL>\" -O /tmp/smoke_test.jsonl

CRITICAL: keep the spider Scrapy-pure. Do NOT add `from bs4`, `BeautifulSoup`, or any BS4
usage. Only native response.css / response.xpath. Do NOT touch the
`SCRAPEOPS_API_KEY = os.environ.get(...)` line in settings.py. Verify with grep before
finishing."
)
```

### Crawlee

```bash
cd <slug>_crawlee
npm install
export SCRAPEOPS_API_KEY=<value>
node src/main.js --url "<first user URL>"
```

Output goes to `storage/datasets/default/*.json`. Validate ≥1 file with valid JSON.

If broken, same pattern: fetch HTML, invoke `parser-fixer` with project_path
`<slug>_crawlee` and `parser_path` `<slug>_crawlee/src/extractor.js`. Critical guard:
"do NOT add axios or hand-rolled http imports — Crawlee owns transport".

## FM-Step 9 — Generate `<slug>_<framework>/README.md`

Write a README with:

1. What the project is — domain, language, framework, generated date.
2. Prerequisites — Python 3.9+ / Node 18+. Show the venv setup commands explicitly for
   Scrapy.
3. **API key** — `export SCRAPEOPS_API_KEY=<your-key>` is required. State that the project
   reads from env at runtime; rotating the key needs no code edits.
4. **Run** — exact CLI for the framework:
   - Scrapy: `scrapy crawl scraper -a url="<target>" -O out.jsonl`
   - Crawlee: `node src/main.js --url "<target>"`
5. **Output** — Scrapy writes JSONL to the path passed via `-O`. Crawlee writes JSON files
   into `./storage/datasets/default/`.
6. **Proxy** — name the chosen ScrapeOps proxy product and how it's wired (one paragraph).
   Mention how to disable for debugging (comment out middleware / hook).
7. **Customize** — point at `extract_data` for selectors, `settings.py` /
   `CheerioCrawler` config for concurrency.
8. Troubleshooting — same items as the standard README (Step 9), plus "verify proxy
   middleware is enabled".

## FM-Step 10 — Final Summary

Show the project tree, the run command, and a one-line note that proxy is on by default.
Do NOT execute anything else after the smoke test.

```
Scraper project generated successfully (Framework Mode).

Directory: ./<slug>_<framework>/
  └── <tree of files written>

Language / library: <language> / <library>
Selected proxy: <Proxy product> — <one-line reason>

Before running:
  export SCRAPEOPS_API_KEY=<your-key>

Run:
  <runner command>
```

## Framework Mode notes

- **Always consult the proxy docs at runtime** (FM-Step 3) — the offline fallback
  `references/proxies.md` is insurance, not the source of truth.
- **`include_api_key` is irrelevant in Framework Mode.** `parser_only: true` returns only
  the extractor function — there's no `API_KEY = "YOUR-API-KEY"` literal to substitute.
  The key is read from env at runtime by the framework project's settings/proxy config.
- **Backend `target_library` is intermediate.** Sending `beautifulsoup` for Scrapy and
  `cheerio` for Crawlee is correct — that's what the backend can produce today, and the
  skill converts/adapts locally.
- **Smoke test is mandatory in Framework Mode.** Frameworks have non-trivial wiring (proxy
  middleware, project layout, item pipelines) that the standard skill doesn't have. A
  smoke test catches assembly errors before the user runs it.
- **`parser-fixer` for self-heal must be told NOT to reintroduce BS4 (Scrapy) or axios
  (Crawlee).** Hard-code that constraint in the prompt; verify with grep after the agent
  returns.

---

# Search Page Mode (BS4 / Cheerio)

Active when Step 1.5 confirmed the URL is a search page AND the chosen library is
BeautifulSoup (Python) or Cheerio (JavaScript). The Go backend doesn't generate
keyword-driven scrapers natively — instead, it returns an `extract_data($, base_url)`
function for a single search-results page, and the skill **wraps it locally** with a URL
builder that loops over `keywords × filters × pages`.

The generated script supports three keyword input modes at runtime — `--keywords`
(comma-separated CLI), `--keywords-file` (JSON), or hardcoded defaults — plus one CLI
flag per filter the user chose to expose, plus `--max-pages`. Output is JSONL with one
line per product card found, annotated with `keyword`, `page`, and `source_url`.

Frameworks (Scrapy, Crawlee) for search pages are **out of scope for this version**. If
the user picked Scrapy/Crawlee + search URL, Step 1.5 already routed them to a switch
question.

## SP-Step 1 — Confirmation (replaces Step 2)

Show a summary table identifying Search Page Mode explicitly:

```
Now let me confirm before submitting (Search Page Mode):

| Field         | Value                          |
|---------------|--------------------------------|
| **URL**       | <url>                          |
| **Language**  | <language>                     |
| **Library**   | <library>                      |
| **Mode**      | Search page (keyword × filters × pagination) |
| **Country**   | <country or "not set">         |
```

Then ask via `AskUserQuestion`:

```
question: "Does everything look correct?"
header: "Confirm"
options:
  - label: "Yes, generate it"
  - label: "No, change something"
```

## SP-Step 2 — Discovery: parse the URL structure

Local URL parsing — no fetch, no network. Use Bash + Python `urllib.parse` (or `node -e` /
`URL` for JS users — Python is fine even for a JS project, just for parsing):

```bash
python3 - <<'PY'
from urllib.parse import urlsplit, parse_qsl
u = urlsplit("<URL>")
print("base:", f"{u.scheme}://{u.netloc}{u.path}")
print("params:", list(parse_qsl(u.query, keep_blank_values=True)))
PY
```

Identify:

- `KEYWORD_PARAM` — the param matching the search regex (`k`, `q`, `query`, `s`,
  `search`, `term`, `kw`, `keyword`, `keywords`).
- `KEYWORD_VALUE_DEFAULT` — the current value of that param (becomes one of the
  hardcoded keywords in the script default).
- `PAGINATION_PARAM` — try `page`, `p`, `offset`, `start`, `from`. Note which (if any)
  is present in the initial URL. If none, leave as `None` for now — SP-Step 3's DOM
  inspection will try to find pagination via the page itself.
- `PAGINATION_KIND` — `page-number` if the value is small (1–50), `offset-based` if the
  value looks like a row offset (multiples of 12/24/48). When in doubt, default to
  `page-number`.
- `OTHER_QUERY_PARAMS` — every other key=value pair. These are filter candidates.
- `SEARCH_URL_BASE` — `<scheme>://<netloc><path>` (without any query string).

Save these as variables in your working memory for SP-Steps 5 / 7 / 8.

## SP-Step 3 — Discovery: inspect the page DOM

Fetch the search page once via `scrapeops_fetch_html` to:

1. **Confirm pagination structure** (especially when SP-Step 2 found no pagination
   param). Grep the saved HTML for:
   ```bash
   grep -E '<a[^>]+rel="next"' <html_file>
   grep -E 'pagination|paginator|page-link' <html_file> | head -10
   grep -oE '\?[a-z]+=([0-9]+|next)[^"]*' <html_file> | sort -u | head -20
   ```
   If a `rel="next"` link or numbered anchor exists, parse out the param name and adopt
   it as `PAGINATION_PARAM`.

2. **Identify filter candidates** by scanning forms and sidebar/aside facets:
   ```bash
   grep -E '<form[^>]*(role="search"|class="[^"]*(filter|facet|refine)[^"]*")' <html_file> | head -10
   grep -oE '<input[^>]+name="[^"]+"' <html_file> | sort -u
   grep -oE '<select[^>]+name="[^"]+"' <html_file> | sort -u
   grep -oE 'data-(filter|facet|refine)-[a-z-]+="[^"]*"' <html_file> | sort -u
   ```

3. **Combine** the candidates: union of `OTHER_QUERY_PARAMS` (from SP-Step 2) and
   `name=` attributes found in the DOM. Deduplicate. For each candidate, capture (when
   visible): the human-readable label / placeholder / select options. SP-Step 4
   auto-exposes all of them as CLI flags — no user filter-selection prompt.

The HTML may be saved at `.scrapeops_cache/<hash>.html` — `scrapeops_fetch_html` already
handles caching (see `mcp-server/index.js` linhas 261–316). Use that file path with
`Read` / `Grep` / `Bash`.

## SP-Step 4 — Auto-expose all detected filters as CLI flags

**Do NOT prompt the user.** Every filter candidate from SP-Step 3 is automatically
exposed as a `--<name>` CLI flag in the generated script — no multi-select, no question.
The user already chose this trade-off at skill design time: more flags is fine, friction
during generation is not.

Build `EXPOSED_FILTERS` from the SP-Step 3 candidates directly:

```
EXPOSED_FILTERS = {
  "<filter_name_1>": None,
  "<filter_name_2>": None,
  ...
}
```

`FIXED_FILTERS` stays empty in the default path. If the original URL had query params that
DON'T look like filters (e.g. `affid`, `tracking_id`, `_refineresult`, session tokens —
parameters that should be preserved verbatim, not user-controlled), put those in
`FIXED_FILTERS = {<name>: <original_value>}` instead. Use judgment: tracking/session
params → fixed; user-meaningful params (price, category, sort, brand, rating) → exposed.

Print to the user a short, non-blocking summary so they know what was wired:

```
✓ Auto-exposed <N> filters as CLI flags: --min-price, --max-price, --sort, --cat-id
  (Edit the script's EXPOSED_FILTERS / FIXED_FILTERS blocks if you want to move
   any between exposed and fixed.)
```

No `AskUserQuestion` here. Continue straight to SP-Step 5.

## SP-Step 5 — Keyword source choice

`AskUserQuestion`:

```
question: "How should the keyword list be provided?"
header: "Keywords"
options:
  - label: "Inline now (comma-separated)"
    description: "Type them now. They become the script's hardcoded default."
  - label: "Sample with the URL keyword + 4 placeholders"
    description: 'Default = ["<KEYWORD_VALUE_DEFAULT>", "TODO_keyword_2", "TODO_keyword_3", "TODO_keyword_4", "TODO_keyword_5"]. User edits later.'
  - label: "From a JSON file at runtime only"
    description: "No hardcoded default. Script always requires --keywords or --keywords-file."
```

Resolve to `DEFAULT_KEYWORDS`:

- **Inline**: ask a free-text follow-up `"Paste the keywords (comma-separated):"`. Split,
  trim, drop empties.
- **Sample**: `[KEYWORD_VALUE_DEFAULT, "TODO_keyword_2", "TODO_keyword_3", "TODO_keyword_4", "TODO_keyword_5"]`.
- **JSON-file-only**: `[]` (the script will exit with an error if invoked without
  `--keywords` or `--keywords-file`).

Note which choice was made — SP-Step 9 conditionally writes a sample JSON file.

## SP-Step 6 — Generate the search-page schema

Invoke the `/generate-data-schema` skill programmatically:

```
target_page_type: product_search_page
user_description: "Search results page for '<KEYWORD_VALUE_DEFAULT>' on <domain> — extract product cards with name, price, url, image, rating; plus pagination."
output_path: ./<slug>_search_schema.json
```

The skill writes the schema and returns the path. Read the file with the `Read` tool so
the JSON is in context for SP-Step 7.

## SP-Step 7 — Submit the parser-only job

Call **`scrapeops_submit_job`** with:

| Param | Value |
|---|---|
| `urls` | `[<the original URL with KEYWORD_VALUE_DEFAULT>]` (just one — backend uses it as a sample) |
| `target_language` | `python` (BS4) or `javascript` (Cheerio) |
| `target_library` | `beautifulsoup` or `cheerio` |
| `scraper_type` | `product_search_page` |
| `parser_only` | `true` |
| `schema_json` | parsed content of `<slug>_search_schema.json` |
| `country` | from Step 1 (if the user provided one) |

Do NOT pass `include_api_key` — `parser_only: true` returns just the extractor function,
no `API_KEY = "..."` literal exists.

Poll with **`scrapeops_poll_status`** as in Step 4 — only proceed when
`status === "completed"`. Then call **`scrapeops_get_code`** and save the returned `code`
in memory as `extract_data_body` (a Python BS4 function or a JS Cheerio function).

## SP-Step 8 — Render the local script

Compute slug from domain (`books.toscrape.com` → `books_toscrape_com`). Extension by
language: `.py` for Python+BS4, `.js` for JavaScript+Cheerio.

Render the appropriate template, substituting all discovery-time constants. Save as
`<slug>_search.<ext>` using **Write**.

### Python (BS4) template

```python
#!/usr/bin/env python3
"""<domain> search scraper — keywords × filters × pagination.

Generated by ScrapeOps generate-scraper on <YYYY-MM-DD>. Output is JSONL: one line per
product card visible on a search results page, annotated with `keyword`, `page`, and
`source_url`.
"""
import argparse
import json
import os
import sys
from urllib.parse import urlencode, quote

import requests
from bs4 import BeautifulSoup

API_KEY = os.environ.get("SCRAPEOPS_API_KEY", "")
PROXY_BASE = "https://proxy.scrapeops.io/v1/"

# === Discovery-time constants (filled in at generation) ===
SEARCH_URL_BASE = "<SEARCH_URL_BASE>"          # e.g. "https://www.amazon.com/s"
KEYWORD_PARAM = "<KEYWORD_PARAM>"              # e.g. "k"
PAGINATION_PARAM = "<PAGINATION_PARAM>"        # e.g. "page"; None if pagination is not used
PAGINATION_KIND = "<page-number|offset-based>"
PAGE_SIZE = <PAGE_SIZE_OR_NONE>                # only used when offset-based; ignored otherwise
FIXED_FILTERS = <FIXED_FILTERS_DICT_LITERAL>   # filters baked in from the original URL
DEFAULT_KEYWORDS = <DEFAULT_KEYWORDS_LIST>     # may be empty list when JSON-file-only mode
DEFAULT_MAX_PAGES = 1
EXPOSED_FILTERS = <EXPOSED_FILTERS_DICT>       # {"min_price": None, "category": None, ...}


# === extract_data — pasted verbatim from Go backend (parser_only=true) ===
<extract_data_body>


def build_search_url(keyword, filters, page):
    params = {KEYWORD_PARAM: keyword}
    params.update(FIXED_FILTERS)
    params.update({k: v for k, v in filters.items() if v not in (None, "")})
    if PAGINATION_PARAM:
        if PAGINATION_KIND == "offset-based":
            params[PAGINATION_PARAM] = (page - 1) * (PAGE_SIZE or 1)
        else:
            params[PAGINATION_PARAM] = page
    return f"{SEARCH_URL_BASE}?{urlencode(params, doseq=True)}"


def fetch_via_proxy(url):
    proxy_url = f"{PROXY_BASE}?api_key={API_KEY}&url={quote(url, safe='')}"
    resp = requests.get(proxy_url, timeout=120)
    resp.raise_for_status()
    return resp.text


def load_keywords(args):
    if args.keywords_file:
        with open(args.keywords_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        out = []
        for item in data:
            if isinstance(item, str):
                out.append({"keyword": item, "filters": {}})
            elif isinstance(item, dict) and item.get("keyword"):
                out.append({"keyword": item["keyword"], "filters": item.get("filters", {}) or {}})
        return out
    if args.keywords:
        return [{"keyword": k.strip(), "filters": {}} for k in args.keywords.split(",") if k.strip()]
    return [{"keyword": k, "filters": {}} for k in DEFAULT_KEYWORDS]


def main():
    ap = argparse.ArgumentParser(description="<domain> search scraper")
    ap.add_argument("--keywords", help="Comma-separated keywords (overrides DEFAULT_KEYWORDS)")
    ap.add_argument("--keywords-file", help="Path to JSON file with keyword list")
    ap.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES,
                    help="Pages to crawl per keyword (stops early on empty page)")
    ap.add_argument("--output", default="<slug>_search.jsonl",
                    help="Output JSONL path")
    # one --<name> flag per exposed filter — the skill emits these dynamically
    <FILTER_FLAG_DEFINITIONS>
    args = ap.parse_args()

    if not API_KEY:
        sys.exit("SCRAPEOPS_API_KEY not set in environment. `export SCRAPEOPS_API_KEY=...` first.")

    cli_filters = <FILTER_VALUES_FROM_ARGS>
    keywords = load_keywords(args)
    if not keywords:
        sys.exit("No keywords provided. Use --keywords or --keywords-file.")

    total_rows = 0
    with open(args.output, "w", encoding="utf-8") as out:
        for kw_entry in keywords:
            kw = kw_entry["keyword"]
            filters = {**cli_filters, **kw_entry.get("filters", {})}
            for page in range(1, args.max_pages + 1):
                url = build_search_url(kw, filters, page)
                print(f"[{kw}] page={page} → {url}", file=sys.stderr)
                try:
                    html = fetch_via_proxy(url)
                except Exception as exc:
                    print(f"  failed: {exc}", file=sys.stderr)
                    continue
                soup = BeautifulSoup(html, "html.parser")
                data = extract_data(soup, url) or {}
                products = data.get("products") or []
                if not products:
                    print(f"  empty page — stopping pagination for keyword '{kw}'", file=sys.stderr)
                    break
                for product in products:
                    out.write(json.dumps({
                        "keyword": kw,
                        "page": page,
                        "source_url": url,
                        **product,
                    }, ensure_ascii=False) + "\n")
                    total_rows += 1

    print(f"\n✓ Wrote {total_rows} rows to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

`<FILTER_FLAG_DEFINITIONS>` — one `ap.add_argument("--<name>", default=EXPOSED_FILTERS["<name>"])`
per exposed filter, joined with newlines+indent.

`<FILTER_VALUES_FROM_ARGS>` — `{"<name>": getattr(args, "<name>".replace("-", "_"))}` for
each exposed filter.

`<FIXED_FILTERS_DICT_LITERAL>` and `<EXPOSED_FILTERS_DICT>` — literal Python dict syntax,
not f-string interpolation. Empty dicts are fine (`{}`).

`<extract_data_body>` — paste verbatim from `scrapeops_get_code`. The function signature
expected by the template is `def extract_data(soup, base_url=None)`. If the backend
returned a different signature, normalize before pasting.

### JavaScript (Cheerio) template

Same shape, with `axios` + `cheerio.load`, and manual `process.argv` parsing:

```javascript
#!/usr/bin/env node
/**
 * <domain> search scraper — keywords × filters × pagination.
 * Output is JSONL: one line per product card.
 */
import fs from "node:fs";
import axios from "axios";
import * as cheerio from "cheerio";

const API_KEY = process.env.SCRAPEOPS_API_KEY ?? "";
const PROXY_BASE = "https://proxy.scrapeops.io/v1/";

// === Discovery-time constants ===
const SEARCH_URL_BASE = "<SEARCH_URL_BASE>";
const KEYWORD_PARAM = "<KEYWORD_PARAM>";
const PAGINATION_PARAM = <"PAGINATION_PARAM" | null>;
const PAGINATION_KIND = "<page-number|offset-based>";
const PAGE_SIZE = <PAGE_SIZE_OR_NULL>;
const FIXED_FILTERS = <FIXED_FILTERS_OBJECT_LITERAL>;
const DEFAULT_KEYWORDS = <DEFAULT_KEYWORDS_ARRAY>;
const DEFAULT_MAX_PAGES = 1;
const EXPOSED_FILTERS = <EXPOSED_FILTERS_OBJECT>;

// === extract_data — pasted verbatim from Go backend ===
<extract_data_body>

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function buildSearchUrl(keyword, filters, page) {
  const params = new URLSearchParams();
  params.set(KEYWORD_PARAM, keyword);
  for (const [k, v] of Object.entries(FIXED_FILTERS)) params.set(k, String(v));
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  }
  if (PAGINATION_PARAM) {
    const value = PAGINATION_KIND === "offset-based"
      ? String((page - 1) * (PAGE_SIZE ?? 1))
      : String(page);
    params.set(PAGINATION_PARAM, value);
  }
  return `${SEARCH_URL_BASE}?${params.toString()}`;
}

async function fetchViaProxy(url) {
  const proxyUrl = `${PROXY_BASE}?api_key=${API_KEY}&url=${encodeURIComponent(url)}`;
  const resp = await axios.get(proxyUrl, { timeout: 120000 });
  return resp.data;
}

function loadKeywords(args) {
  if (args["keywords-file"]) {
    const data = JSON.parse(fs.readFileSync(args["keywords-file"], "utf-8"));
    const out = [];
    for (const item of data) {
      if (typeof item === "string") out.push({ keyword: item, filters: {} });
      else if (item && item.keyword) out.push({ keyword: item.keyword, filters: item.filters ?? {} });
    }
    return out;
  }
  if (args.keywords) {
    return args.keywords.split(",").map(k => k.trim()).filter(Boolean)
      .map(k => ({ keyword: k, filters: {} }));
  }
  return DEFAULT_KEYWORDS.map(k => ({ keyword: k, filters: {} }));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!API_KEY) {
    console.error("SCRAPEOPS_API_KEY not set in environment.");
    process.exit(1);
  }
  const maxPages = parseInt(args["max-pages"] ?? String(DEFAULT_MAX_PAGES), 10);
  const outputPath = args.output ?? "<slug>_search.jsonl";
  const cliFilters = <CLI_FILTERS_FROM_ARGS>;
  const keywords = loadKeywords(args);
  if (keywords.length === 0) {
    console.error("No keywords provided. Use --keywords or --keywords-file.");
    process.exit(1);
  }
  const out = fs.createWriteStream(outputPath, { flags: "w" });
  let totalRows = 0;
  for (const entry of keywords) {
    const kw = entry.keyword;
    const filters = { ...cliFilters, ...(entry.filters ?? {}) };
    for (let page = 1; page <= maxPages; page++) {
      const url = buildSearchUrl(kw, filters, page);
      console.error(`[${kw}] page=${page} → ${url}`);
      let html;
      try { html = await fetchViaProxy(url); }
      catch (exc) { console.error(`  failed: ${exc.message ?? exc}`); continue; }
      const $ = cheerio.load(html);
      const data = extract_data($, url) ?? {};
      const products = data.products ?? [];
      if (products.length === 0) {
        console.error(`  empty page — stopping pagination for keyword '${kw}'`);
        break;
      }
      for (const product of products) {
        out.write(JSON.stringify({ keyword: kw, page, source_url: url, ...product }) + "\n");
        totalRows++;
      }
    }
  }
  out.end();
  console.error(`\n✓ Wrote ${totalRows} rows to ${outputPath}`);
}

main();
```

`<CLI_FILTERS_FROM_ARGS>` — `{ <name>: args["<name>"] ?? EXPOSED_FILTERS["<name>"] }` for
each exposed filter. Convert kebab-case (`--min-price`) ↔ camelCase or stick with the
original param name — match whatever the website expects.

After Write, do NOT run any of the pre-existing Step 8 grep substitutions (those apply
only to standard mode templates).

## SP-Step 9 — Sample keywords JSON (only if D3 = "JSON file at runtime only")

If the user picked the "From a JSON file" option in SP-Step 5, also Write
`<slug>_keywords.sample.json`:

```json
[
  "<KEYWORD_VALUE_DEFAULT>",
  "TODO_keyword_2",
  "TODO_keyword_3",
  "TODO_keyword_4",
  "TODO_keyword_5"
]
```

Otherwise skip this step entirely.

## SP-Step 10 — Smoke test (1 keyword × 1 page) + local self-heal

The script's wiring (URL builder, filter merging, pagination, extract_data integration)
is non-trivial — a one-shot smoke test catches assembly errors before the user runs it.

Install dependencies (use the same venv pattern from Step 6 of the standard mode for
Python; `npm install` for JS).

Then invoke:

**Python**:
```bash
export SCRAPEOPS_API_KEY=<value>   # ask user via AskUserQuestion if not in env
python3 <slug>_search.py --keywords "<KEYWORD_VALUE_DEFAULT>" --max-pages 1 \
  --output /tmp/<slug>_smoke.jsonl
wc -l /tmp/<slug>_smoke.jsonl
head -1 /tmp/<slug>_smoke.jsonl
```

**JavaScript**:
```bash
export SCRAPEOPS_API_KEY=<value>
node <slug>_search.js --keywords "<KEYWORD_VALUE_DEFAULT>" --max-pages 1 \
  --output /tmp/<slug>_smoke.jsonl
wc -l /tmp/<slug>_smoke.jsonl
head -1 /tmp/<slug>_smoke.jsonl
```

Validate `/tmp/<slug>_smoke.jsonl`:
- File exists, ≥1 line.
- First line is valid JSON with `keyword`, `page`, `source_url`, and at least
  `name` + `url` populated (matching the schema's `critical` priority fields).

If broken, fetch the URL's HTML via `scrapeops_fetch_html`, save to
`/tmp/<slug>_search_sample.html`, and invoke `parser-fixer`:

```
Agent(
  description: "Fix search-page extractor",
  subagent_type: "parser-fixer",
  prompt: "Fix the extract_data() function inside <slug>_search.<ext>.

Inputs:
- parser_path: <slug>_search.<ext> (the extract_data function inside)
- html_path: /tmp/<slug>_search_sample.html
- language: <python|javascript>
- task: Smoke test failed — extract_data($, url) returned 0 products OR products are
  missing required card fields (name, url, price, image). Expected at least name + url
  populated per product card.

Run command (Python): python3 <slug>_search.py --keywords \"<KEYWORD_VALUE_DEFAULT>\" --max-pages 1 --output /tmp/<slug>_smoke.jsonl
Run command (JS):     node <slug>_search.js --keywords \"<KEYWORD_VALUE_DEFAULT>\" --max-pages 1 --output /tmp/<slug>_smoke.jsonl

CRITICAL:
- Do NOT touch the URL builder (build_search_url / buildSearchUrl), the proxy fetch
  function, the argparse/yargs CLI wiring, or the discovery-time constants block at the
  top of the file. Only edit selectors inside extract_data.
- Do NOT touch the SCRAPEOPS_API_KEY env-var read.
- Verify the smoke command produces ≥1 valid JSON line before finishing."
)
```

After the agent returns, re-run the smoke command and re-validate. If still broken,
offer the user: regenerate / manual fix / stop.

## SP-Step 11 — Generate `<slug>_README.md`

Use **Write** to create a README documenting:

1. **What the script does** — domain, search scraper, output JSONL.
2. **Prerequisites** — Python 3.9+ / Node 18+. Show venv setup for Python (per Step 6 of
   standard mode).
3. **API key** — `export SCRAPEOPS_API_KEY=<your-key>`. State that the script reads from
   env at runtime; rotating the key needs no edits.
4. **Three keyword input modes** with one-line example each:
   ```bash
   # 1) Hardcoded defaults
   python3 <slug>_search.py

   # 2) Inline CLI list
   python3 <slug>_search.py --keywords "shirts,jeans,jackets"

   # 3) JSON file
   python3 <slug>_search.py --keywords-file <slug>_keywords.json
   ```
5. **JSON file format** — show both supported shapes (lista de strings vs lista de
   objetos `{keyword, filters}`).
6. **Filter flags** — table listing each exposed `--<filter>` flag, its current default,
   and a one-line semantics note.
7. **Pagination** — `--max-pages N`. Mention the early-stop behavior on empty pages.
8. **Output shape** — one JSONL line per product card, with `keyword`, `page`,
   `source_url` annotations + the schema fields.
9. **Customizing** — point at the discovery-time constants block at the top of the
   script, and at `extract_data` for selector edits.
10. **Troubleshooting** — same items as the standard README plus "empty results = either
    selector broken or all keywords return zero hits".

Keep under 120 lines.

## SP-Step 12 — Final summary

Show the file list, a one-line note on the discovered URL structure, and the run command.
Do NOT execute anything else.

```
Search scraper generated successfully (Search Page Mode).

Files saved:
  <slug>_search.<ext>
  <slug>_search_schema.json
  <slug>_README.md
  <slug>_keywords.sample.json   # only if "JSON file" mode was chosen

Discovery:
  Keyword param:   <KEYWORD_PARAM>
  Pagination:      <PAGINATION_PARAM> (<PAGINATION_KIND>)
  Exposed filters: <list of --flags>
  Fixed filters:   <list of fixed=value pairs>

Before running:
  export SCRAPEOPS_API_KEY=<your-key>

Run examples:
  python3 <slug>_search.py
  python3 <slug>_search.py --keywords "term1,term2" --max-pages 3
  python3 <slug>_search.py --keywords-file <slug>_keywords.sample.json
```

## Search Page Mode notes

- **Output is list-only.** Search Page Mode never follows into individual product detail
  pages. For that, use `/generate-crawler-scraper` — it's the right tool when the user
  needs full product objects per result.
- **`include_api_key` is irrelevant** in Search Page Mode (same as Framework Mode).
  `parser_only: true` returns just `extract_data`; the API key is read from env at
  runtime by the local fetch function.
- **Empty-page early-stop** is built into the loop. If a page returns zero products, the
  script stops paginating that keyword and moves to the next. So `--max-pages 100` won't
  burn 100 fetches if results run out at page 7.
- **`parser-fixer` for self-heal must be told NOT to touch the URL builder, fetch
  function, CLI wiring, or discovery constants** — only `extract_data` selectors. Hard-code
  that in the prompt, like Framework Mode does for BS4/axios.
- **Backend `target_library` is intermediate** for the same reason as Framework Mode:
  the backend can produce BS4 / Cheerio extractors today, and we wrap them locally.
