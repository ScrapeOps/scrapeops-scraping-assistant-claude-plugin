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
  - label: "Playwright"
    description: "Real browser — use when JS rendering is required."
  - label: "Puppeteer"
    description: "Headless Chrome automation."
```

**PHP / Ruby / Go / Rust / Java / C#:** use `AskUserQuestion` with the options from `references/languages.md`. Apply the same "no preference marker" rule — don't add `(recommended)` / `(default)` anywhere.

### 1.3 — URLs (if not provided)

If the user didn't include a URL, ask: "Paste 1–5 URLs from the target website (same domain). These are used only as generation-time samples — the generated script will accept any URL via CLI."

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
- `parser_only: false` + `include_api_key: false` are the two flags that matter for this flow.
- All URLs must be from the same domain — the backend validates this.
- Maximum 5 URLs per job — they are generation-time samples, not runtime inputs.
- The generated script runs on ONE URL at a time (from CLI). For batch use, the user calls the script multiple times or wraps it in a loop.
- No smoke test, no local HTML download, no parser execution at generation time. The skill ends at Step 10.
