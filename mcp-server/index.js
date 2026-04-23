#!/usr/bin/env node
import { createInterface } from "readline";
import { setTimeout as sleep } from "timers/promises";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import https from "https";
import http from "http";

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function request(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
    };
    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestLargeBody(url, { method = "POST", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers, "Content-Length": Buffer.byteLength(body || "") },
    };
    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Config from environment ──────────────────────────────────────────────────

function readSettingsEnv(key) {
  try {
    const settingsPath = join(homedir(), ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    return settings?.env?.[key] || "";
  } catch {
    return "";
  }
}

function getApiKey() {
  const key = process.env.SCRAPEOPS_API_KEY || readSettingsEnv("SCRAPEOPS_API_KEY");
  if (!key) throw new Error("SCRAPEOPS_API_KEY is not configured. Run /scrapeops-setup to configure it.");
  return key;
}

function getApiUrl() {
  const url = process.env.SCRAPEOPS_API_URL || readSettingsEnv("SCRAPEOPS_API_URL") || "https://parser.scrapeops.io";
  return url.replace(/\/$/, "");
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function submitJob({
  urls,
  target_language,
  target_library,
  country,
  scraper_type,
  parser_only,
  schema_json,
  max_pages,
  concurrency,
  input_from_jsonl,
  include_api_key,
}) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  const payload = {
    urls,
    target_language,
    target_library,
    // parser_only defaults to TRUE for the generate-scraper skill (HTML parser only,
    // no HTTP client). The /generate-crawler-scraper skill must pass parser_only=false
    // explicitly to get a full crawler/scraper with ScrapeOps proxy fetching baked in.
    parser_only: typeof parser_only === "boolean" ? parser_only : true,
    sse_support: true,
    // Identifies the origin of the request so the Go backend can distinguish
    // plugin-submitted jobs from dashboard/server-internal ones. Every call that
    // goes through this MCP tool comes from the Claude Code plugin by definition.
    request_source: "plugin",
  };
  if (country) payload.country = country;
  if (scraper_type) payload.scraper_type = scraper_type;
  if (schema_json && typeof schema_json === "object") payload.schema_json = schema_json;
  if (typeof max_pages === "number" && max_pages > 0) payload.max_pages = max_pages;
  if (typeof concurrency === "number" && concurrency > 0) payload.concurrency = concurrency;
  if (input_from_jsonl === true) payload.input_from_jsonl = true;
  // When false, the Go backend generates code with "YOUR-API-KEY" as a placeholder
  // instead of the real hardcoded key. Callers (like the crawler-scraper skill)
  // then swap the placeholder for an env-var read so the key doesn't live in source.
  if (typeof include_api_key === "boolean") payload.include_api_key = include_api_key;

  const body = JSON.stringify(payload);
  const res = await requestLargeBody(
    `${api_url}/scraping-assistant/scraper_code_generator?api_key=${api_key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body }
  );
  // Strip internal/verbose fields the caller doesn't need to see.
  if (res && typeof res === "object") {
    delete res.queue_status;
  }
  return res;
}

async function getConcurrencyLimit() {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  const res = await request(
    `${api_url}/scraping-assistant/account/concurrency-limit?api_key=${api_key}`,
    { headers: { Api_key: api_key } }
  );
  if (res && typeof res === "object") {
    delete res.plan_id;
  }
  return res;
}

async function pollStatus({ version_id }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  await sleep(30_000);
  const d = await request(
    `${api_url}/scraping-assistant/job/${version_id}/status`,
    { headers: { Api_key: api_key } }
  );
  const status = d.status ?? "";
  const progress = d.last_progress_message || d.step || "";
  // ALWAYS strip the code fields from polling responses — the backend populates
  // `output_code` / `link_output_code` mid-pipeline (before status = "completed"),
  // which tempts the caller to proceed with incomplete code. The caller must use
  // `scrapeops_get_code` AFTER status = "completed" to retrieve the final code.
  delete d.output_code;
  delete d.link_output_code;
  return {
    _summary: `Status: ${status} — ${progress}`,
    status: d.status,
    step: d.step,
    last_progress_message: d.last_progress_message,
    error_message: d.error_message,
    language: d.language,
    library: d.library,
    install_command: d.install_command,
    completed_at: d.completed_at,
    version_id: d.version_id,
  };
}

async function getCode({ version_id }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  const d = await request(
    `${api_url}/scraping-assistant/job/${version_id}/status`,
    { headers: { Api_key: api_key } }
  );
  if (d.status !== "completed") {
    return {
      _error: `Job status is "${d.status}", not "completed". Call scrapeops_poll_status until status is "completed" before calling scrapeops_get_code.`,
      status: d.status,
      step: d.step,
    };
  }
  // Prefer inline `output_code`; fall back to downloading `link_output_code`.
  if (d.output_code && String(d.output_code).trim().length > 0) {
    return {
      code: d.output_code,
      language: d.language,
      library: d.library,
      install_command: d.install_command,
      version_id: d.version_id,
    };
  }
  if (d.link_output_code) {
    const raw = await new Promise((resolve, reject) => {
      const parsed = new URL(d.link_output_code);
      const mod = parsed.protocol === "https:" ? https : http;
      mod.get(d.link_output_code, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
      }).on("error", reject);
    });
    return {
      code: raw,
      language: d.language,
      library: d.library,
      install_command: d.install_command,
      version_id: d.version_id,
    };
  }
  return {
    _error: "Job is completed but neither output_code nor link_output_code is set — unexpected state.",
  };
}

async function downloadCode({ url }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    mod.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ _raw: Buffer.concat(chunks).toString() }));
    }).on("error", reject);
  });
}

async function fetchHtml({ url, output_path }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  const body = JSON.stringify({ url });
  const response = await request(
    `${api_url}/scraping-assistant/http-fetch?api_key=${api_key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body }
  );
  if (response.status !== "success" || !response.html) {
    throw new Error(`Failed to fetch HTML from ${url}: ${response.error || response.status || "unknown error"}`);
  }

  const html = response.html;
  const sizeBytes = Buffer.byteLength(html, "utf-8");
  const INLINE_LIMIT = 200 * 1024; // 200KB — comfortable margin for Claude's context
  const { writeFileSync, mkdirSync } = await import("fs");
  const { dirname } = await import("path");

  // Always write to disk when the caller passed an output_path OR when the HTML
  // is big enough that returning inline would strain Claude's context window.
  // For auto-saved files, use a predictable temp path so the caller can Read it.
  let savedTo = null;
  if (output_path || sizeBytes > INLINE_LIMIT) {
    let finalPath = output_path;
    if (!finalPath) {
      // Save inside the caller's cwd (project dir) instead of /tmp/ — avoids
      // permission-scope denials in Claude Code, where /tmp/ can be outside the
      // user's allowed read paths. The folder `.scrapeops_cache/` should be
      // added to .gitignore by the user if needed.
      const { createHash } = await import("crypto");
      const hash = createHash("sha1").update(url).digest("hex").slice(0, 12);
      finalPath = `.scrapeops_cache/${hash}.html`;
    }
    try {
      mkdirSync(dirname(finalPath), { recursive: true });
    } catch (_) { /* dir may already exist */ }
    writeFileSync(finalPath, html, "utf-8");
    savedTo = finalPath;
  }

  // Oversized: never return the full body inline — would blow up Claude's context.
  if (sizeBytes > INLINE_LIMIT) {
    return {
      saved_to: savedTo,
      size_bytes: sizeBytes,
      url,
      note: `HTML too large to return inline (${Math.round(sizeBytes / 1024)} KB). Saved to ${savedTo}. Use the Read tool (with offset/limit) or Grep to inspect it.`,
    };
  }

  // Small enough to be comfortably inlined. Also echo saved_to if the caller explicitly asked.
  if (output_path) {
    return { saved_to: savedTo, size_bytes: sizeBytes, url, _raw: html };
  }
  return { _raw: html };
}

async function fetchHtmlBatch({ urls, output_dir = "." }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  const suffixes = ["", "_b", "_c", "_d", "_e", "_f", "_g", "_h", "_i", "_j"];
  const results = [];

  // Fetch all URLs in parallel
  const promises = urls.slice(0, 10).map(async (url, i) => {
    try {
      const body = JSON.stringify({ url });
      const response = await request(
        `${api_url}/scraping-assistant/http-fetch?api_key=${api_key}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body }
      );
      if (response.status === "success" && response.html) {
        const filename = `${output_dir}/fetched_page${suffixes[i]}.html`;
        const { writeFileSync } = await import("fs");
        writeFileSync(filename, response.html, "utf-8");
        return { url, filename, status: "ok", size: response.html.length };
      }
      return { url, filename: null, status: "error", error: response.error || "no html returned" };
    } catch (err) {
      return { url, filename: null, status: "error", error: err.message };
    }
  });

  const settled = await Promise.all(promises);
  return settled;
}

// ─── Fix tools (talk to Go backend, which proxies to Agent Service) ──────────

async function startFix({ parser_code, parser_filename, language, task, html_files, html_paths, fetch_urls, job_id }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();

  // Build html_files array — prefer html_paths (MCP reads from disk directly), fall back to html_files (pre-encoded)
  const files = [];
  if (Array.isArray(html_paths) && html_paths.length) {
    const { basename } = await import("path");
    for (const p of html_paths) {
      try {
        const content = readFileSync(p);
        files.push({
          filename: basename(p),
          content_base64: content.toString("base64"),
        });
      } catch (err) {
        throw new Error(`Failed to read HTML file '${p}': ${err.message}`);
      }
    }
  }
  if (Array.isArray(html_files) && html_files.length) {
    files.push(...html_files);
  }

  const payload = {
    api_key,
    parser_code,
    parser_filename,
    language,
    task,
    html_files: files,
    fetch_urls: fetch_urls || [],
  };
  if (job_id) payload.job_id = job_id;
  const body = JSON.stringify(payload);
  return requestLargeBody(
    `${api_url}/scraping-assistant/fix-session/start?api_key=${api_key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body }
  );
}

async function pollFixStatus({ job_id }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  await sleep(20_000);
  const d = await request(`${api_url}/scraping-assistant/fix-session/${job_id}/status?api_key=${api_key}`);
  const progress = d.last_progress_message ? ` — ${d.last_progress_message}` : "";
  // Return a lean response so Claude's display focuses on status + progress
  return {
    _summary: `Status: ${d.status}${d.error ? " — " + d.error : progress}`,
    status: d.status,
    progress: d.last_progress_message || null,
    error: d.error || null,
    iterations: d.iterations || 0,
  };
}

async function getFixResult({ job_id }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  return request(`${api_url}/scraping-assistant/fix-session/${job_id}/result?api_key=${api_key}`);
}

// ─── Crawler-scraper flow (server-side orchestration) ─────────────────────────

async function startCrawlerScraper({ domain, search_query, language, library }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  const body = JSON.stringify({ api_key, domain, search_query, language, library });
  return request(
    `${api_url}/scraping-assistant/crawler-scraper/start?api_key=${api_key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body }
  );
}

async function pollCrawlerScraperStatus({ job_id }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  await sleep(20_000);
  const d = await request(
    `${api_url}/scraping-assistant/crawler-scraper/${job_id}/status?api_key=${api_key}`
  );
  const progress = d.last_progress_message ? ` — ${d.last_progress_message}` : "";
  return {
    _summary: `Status: ${d.status}${d.error ? " — " + d.error : progress}`,
    status: d.status,
    progress: d.last_progress_message || null,
    error: d.error || null,
    iterations: d.iterations || 0,
  };
}

async function getCrawlerScraperResult({ job_id }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  return request(
    `${api_url}/scraping-assistant/crawler-scraper/${job_id}/result?api_key=${api_key}`
  );
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "scrapeops_submit_job",
    description:
      "Submit a scraper generation job to the ScrapeOps API. Returns version_id. API key and URL are read from environment automatically. " +
      "Defaults to parser_only=true (HTML parser only, no HTTP client). " +
      "The /generate-crawler-scraper skill passes parser_only=false plus scraper_type='product_crawler' and/or input_from_jsonl=true to get runnable crawlers/scrapers with ScrapeOps proxy fetching, pagination follow-through, and bounded concurrency baked in. " +
      "schema_json overrides the backend's built-in data schemas with a user-provided schema (persisted to DO Spaces and reused across extraction, compression, and code generation).",
    inputSchema: {
      type: "object",
      properties: {
        urls:             { type: "array", items: { type: "string" }, description: "1–5 URLs from the same domain" },
        target_language:  { type: "string", description: "e.g. python, javascript, php, ruby, go, rust, java, csharp" },
        target_library:   { type: "string", description: "e.g. beautifulsoup, cheerio, symfony/dom-crawler, nokogiri, goquery, scraper, jsoup, HtmlAgilityPack" },
        country:          { type: "string", description: "Optional ISO country code for proxy geotargeting" },
        scraper_type:     { type: "string", description: "Optional — e.g. 'product_crawler' for slim listing-page crawler; omit for auto-detect on detail pages" },
        parser_only:      { type: "boolean", description: "Default true. Set false to get a full runnable scraper with HTTP fetching + concurrency (required for the crawler+scraper flow)" },
        schema_json:      { type: "object", description: "Optional custom data schema (Go-format). When provided, bypasses dataSchema/*.json and LLM schema generation — persisted to DO Spaces so the pipeline reuses it" },
        max_pages:        { type: "integer", description: "Crawler-only: stop pagination after N pages (default 3 in template)" },
        concurrency:      { type: "integer", description: "Scraper-only: thread pool / promise pool size in the generated code" },
        input_from_jsonl: { type: "boolean", description: "Scraper variant: generated code reads URLs from argv[1] JSONL file (produced by the crawler) instead of using hardcoded urls[]" },
      },
      required: ["urls", "target_language", "target_library"],
    },
  },
  {
    name: "scrapeops_poll_status",
    description:
      "Wait 30 seconds then check job status. Call repeatedly until status is 'completed' or 'error'. API key and URL are read from environment automatically. IMPORTANT: this tool intentionally STRIPS the generated code (output_code / link_output_code) from the response — the backend populates those fields before the pipeline is finished, which would otherwise tempt the caller to proceed with incomplete code. Use scrapeops_get_code AFTER status is 'completed' to retrieve the final code.",
    inputSchema: {
      type: "object",
      properties: {
        version_id: { type: "integer", description: "Job ID returned by scrapeops_submit_job" },
      },
      required: ["version_id"],
    },
  },
  {
    name: "scrapeops_get_code",
    description:
      "Retrieve the generated scraper code for a completed job. ONLY call this AFTER scrapeops_poll_status has returned status = 'completed'. If the job isn't completed yet, this tool returns an error. The response includes the code (inline, already downloaded if the backend returned a link), language, library, and install_command.",
    inputSchema: {
      type: "object",
      properties: {
        version_id: { type: "integer", description: "Job ID returned by scrapeops_submit_job" },
      },
      required: ["version_id"],
    },
  },
  {
    name: "scrapeops_download_code",
    description:
      "Download generated code from a URL (used when link_output_code is returned instead of inline output_code).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "link_output_code URL" },
      },
      required: ["url"],
    },
  },
  {
    name: "scrapeops_fetch_html",
    description:
      "Fetch rendered HTML from a URL via the ScrapeOps proxy. API key and URL are read from environment automatically. " +
      "Behavior: HTML over 200 KB is automatically saved to ./.scrapeops_cache/<hash>.html (relative to the process cwd — i.e. inside the user's project, so Read/Grep work without permission issues) and the response returns { saved_to, size_bytes, note } instead of inline text (prevents context overflow). " +
      "For small HTML, inline text is returned as _raw. " +
      "To force save to a specific path, pass `output_path` (any relative or absolute path the caller has write access to).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Page URL to fetch" },
        output_path: { type: "string", description: "Optional: save the HTML to this exact path. When omitted, small HTML is returned inline and large HTML is auto-saved to ./.scrapeops_cache/ (cwd-relative)." },
      },
      required: ["url"],
    },
  },
  {
    name: "scrapeops_fetch_html_batch",
    description:
      "Fetch HTML from multiple URLs in parallel via ScrapeOps proxy. Saves each page as fetched_page.html, fetched_page_b.html, etc. in the output directory. Use this when fixing a scraper that runs against multiple pages — pass up to 5 URLs at once.",
    inputSchema: {
      type: "object",
      properties: {
        urls:       { type: "array", items: { type: "string" }, description: "List of URLs to fetch (up to 10)" },
        output_dir: { type: "string", description: "Directory to save HTML files (default: current directory)" },
      },
      required: ["urls"],
    },
  },
  {
    name: "scrapeops_get_concurrency_limit",
    description:
      "Returns the authenticated account's ScrapeOps proxy concurrency limit (plan limit + extra concurrency). " +
      "Used by the /generate-crawler-scraper skill to choose a safe --concurrency value for the generated scraper, so the user never exceeds their plan cap when running the scraper locally. " +
      "Response: { concurrency_limit, plan_id, plan_limit, extra_concurrency }.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "scrapeops_start_fix",
    description:
      "Submit a parser fix job to the ScrapeOps agent service. Sends parser code and HTML files for server-side fixing. Returns job_id for polling. For follow-up fixes, pass the same job_id to reuse the existing workspace (HTMLs already fetched). PREFER html_paths over html_files — it avoids base64 encoding in Claude's context.",
    inputSchema: {
      type: "object",
      properties: {
        parser_code:     { type: "string", description: "Parser source code" },
        parser_filename: { type: "string", description: "Parser filename (e.g. scraper.py)" },
        language:        { type: "string", description: "Programming language (python, javascript, etc.)" },
        task:            { type: "string", description: "What needs to be fixed" },
        html_paths:      { type: "array", items: { type: "string" }, description: "PREFERRED: Absolute or relative paths to local HTML files. MCP server reads them directly from disk — no base64 encoding needed." },
        html_files:      { type: "array", items: { type: "object", properties: { filename: { type: "string" }, content_base64: { type: "string" } } }, description: "Legacy: HTML files as base64-encoded content. Use html_paths instead when possible." },
        fetch_urls:      { type: "array", items: { type: "string" }, description: "URLs to fetch server-side if no local HTML" },
        job_id:          { type: "string", description: "Previous job_id for follow-up fixes (reuses existing workspace with HTMLs)" },
      },
      required: ["parser_code", "parser_filename", "language", "task"],
    },
  },
  {
    name: "scrapeops_poll_fix_status",
    description:
      "Wait 20 seconds then check fix job status. Call repeatedly until status is 'completed' or 'failed'.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID returned by scrapeops_start_fix" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "scrapeops_get_fix_result",
    description:
      "Get the result of a completed fix job, including the fixed parser code and changes summary.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "scrapeops_start_crawler_scraper",
    description:
      "Start a server-side crawler+scraper generation flow. The agent will: (1) discover the site's search URL pattern, (2) generate a slim crawler parser, (3) execute it to collect up to 5 product URLs, (4) generate a detailed product scraper, (5) merge both into a single self-contained parser. Returns job_id for polling. Takes several minutes to complete.",
    inputSchema: {
      type: "object",
      properties: {
        domain:       { type: "string", description: "Target site domain, e.g. 'amazon.com' or 'mercadolivre.com.br'" },
        search_query: { type: "string", description: "What the user wants to search for (natural language, e.g. 'mens t-shirts' or 'camisetas masculinas')" },
        language:     { type: "string", description: "Target programming language (python, javascript, etc.)" },
        library:      { type: "string", description: "Target library (beautifulsoup, cheerio, etc.)" },
      },
      required: ["domain", "search_query", "language", "library"],
    },
  },
  {
    name: "scrapeops_poll_crawler_scraper_status",
    description:
      "Wait 20 seconds then check crawler-scraper job status. Call repeatedly until status is 'completed' or 'failed'.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID returned by scrapeops_start_crawler_scraper" },
      },
      required: ["job_id"],
    },
  },
  {
    name: "scrapeops_get_crawler_scraper_result",
    description:
      "Get the final result of a completed crawler-scraper job. Returns crawler_code, product_code, and merged_code — all three parsers ready to save to disk.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Job ID" },
      },
      required: ["job_id"],
    },
  },
];

const HANDLERS = {
  scrapeops_submit_job:                    submitJob,
  scrapeops_poll_status:                   pollStatus,
  scrapeops_get_code:                      getCode,
  scrapeops_download_code:                 downloadCode,
  scrapeops_fetch_html:                    fetchHtml,
  scrapeops_fetch_html_batch:              fetchHtmlBatch,
  scrapeops_get_concurrency_limit:         getConcurrencyLimit,
  scrapeops_start_fix:                     startFix,
  scrapeops_poll_fix_status:               pollFixStatus,
  scrapeops_get_fix_result:                getFixResult,
  scrapeops_start_crawler_scraper:         startCrawlerScraper,
  scrapeops_poll_crawler_scraper_status:   pollCrawlerScraperStatus,
  scrapeops_get_crawler_scraper_result:    getCrawlerScraperResult,
};

// ─── MCP method handlers ──────────────────────────────────────────────────────

const METHODS = {
  "initialize": (id) => respond(id, {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "scrapeops", version: "1.0.0" },
  }),
  "notifications/initialized": () => {},
  "tools/list": (id) => respond(id, { tools: TOOLS }),
  "tools/call": async (id, params) => {
    const handler = HANDLERS[params.name];
    if (!handler) return respondError(id, -32601, `Unknown tool: ${params.name}`);
    try {
      const result = await handler(params.arguments);
      // If the result has _raw, return its content directly (not JSON-serialized)
      const text = result && result._raw !== undefined ? result._raw : JSON.stringify(result, null, 2);
      respond(id, { content: [{ type: "text", text }] });
    } catch (err) {
      respond(id, { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
    }
  },
};

// ─── Stdin loop ───────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const handler = METHODS[msg.method];
  if (handler) await handler(msg.id, msg.params ?? {});
  else if (msg.id != null) respondError(msg.id, -32601, `Method not found: ${msg.method}`);
});
