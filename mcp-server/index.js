#!/usr/bin/env node
import { createInterface } from "readline";
import { setTimeout as sleep } from "timers/promises";
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

// ─── Config from environment ──────────────────────────────────────────────────

function getApiKey() {
  const key = process.env.SCRAPEOPS_API_KEY;
  if (!key) throw new Error("SCRAPEOPS_API_KEY environment variable is not set. Run /scrapeops-setup to configure it.");
  return key;
}

function getApiUrl() {
  return (process.env.SCRAPEOPS_API_URL || "https://parser.scrapeops.io").replace(/\/$/, "");
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
];

const HANDLERS = {
  scrapeops_submit_job:    submitJob,
  scrapeops_poll_status:   pollStatus,
  scrapeops_download_code: downloadCode,
  scrapeops_fetch_html:    fetchHtml,
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
