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

async function submitJob({ urls, target_language, target_library }) {
  const api_key = getApiKey();
  const api_url = getApiUrl();
  const body = JSON.stringify({
    urls,
    target_language,
    target_library,
    parser_only: true,
    sse_support: true,
  });
  return request(
    `${api_url}/scraping-assistant/scraper_code_generator?api_key=${api_key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body }
  );
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
  d._summary = `Status: ${status} — ${progress}`;
  return d;
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

async function fetchHtml({ url }) {
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
  return { _raw: response.html };
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

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "scrapeops_submit_job",
    description:
      "Submit a scraper generation job to the ScrapeOps API. Returns version_id. API key and URL are read from environment automatically.",
    inputSchema: {
      type: "object",
      properties: {
        urls:            { type: "array", items: { type: "string" }, description: "1–5 URLs from the same domain" },
        target_language: { type: "string", description: "e.g. python, javascript" },
        target_library:  { type: "string", description: "e.g. beautifulsoup, cheerio" },
      },
      required: ["urls", "target_language", "target_library"],
    },
  },
  {
    name: "scrapeops_poll_status",
    description:
      "Wait 30 seconds then check job status. Call repeatedly until status is 'completed' or 'error'. API key and URL are read from environment automatically.",
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
      "Fetch rendered HTML from a URL via the ScrapeOps proxy (used by fix-scraper). API key and URL are read from environment automatically.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Page URL to fetch" },
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
];

const HANDLERS = {
  scrapeops_submit_job:        submitJob,
  scrapeops_poll_status:       pollStatus,
  scrapeops_download_code:     downloadCode,
  scrapeops_fetch_html:        fetchHtml,
  scrapeops_fetch_html_batch:  fetchHtmlBatch,
  scrapeops_start_fix:         startFix,
  scrapeops_poll_fix_status:   pollFixStatus,
  scrapeops_get_fix_result:    getFixResult,
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
