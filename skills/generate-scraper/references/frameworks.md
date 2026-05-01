# Framework Mode — Scrapy & Crawlee Templates (offline fallback + cheatsheets)

> **READ THIS FIRST.** Live framework docs are the source of truth. Every Framework Mode
> run must FIRST `curl` the canonical doc URLs below (mirroring the Scrapy Mode S2 pattern
> in `generate-crawler-scraper/SKILL.md`) and use the live content. This file is the
> **offline fallback** — used only when fetches fail. Templates here are last verified
> 2026-04 and are known to work, but may lag behind upstream defaults.

Both `generate-scraper` and `generate-crawler-scraper` use this file. The reference path is
relative to those skills:
`../../generate-scraper/references/frameworks.md` from `generate-crawler-scraper`.

---

## When Framework Mode is active

Triggered when the user picks one of:

| Language | Library | `framework_mode` flag |
|---|---|---|
| Python | Scrapy | `scrapy` |
| JavaScript | Crawlee | `crawlee` |

For these combinations, the skill submits the Go backend with `parser_only: true`, an
**intermediate** `target_library` (`beautifulsoup` for Scrapy, `cheerio` for Crawlee), then
locally converts the returned `extract_data(...)` and assembles a framework-idiomatic
project with proxy injection.

Browsers (Playwright/Puppeteer/Selenium) are **not** framework libraries — they go through
the standard monolithic path (`parser_only: false`).

---

## Section A — Scrapy (Python)

### A.1 Canonical doc URLs (curl in runtime)

| Page | URL |
|---|---|
| Tutorial / project layout | `https://docs.scrapy.org/en/latest/intro/tutorial.html` |
| Settings reference | `https://docs.scrapy.org/en/latest/topics/settings.html` |
| Downloader middleware | `https://docs.scrapy.org/en/latest/topics/downloader-middleware.html` |

`docs.scrapy.org` blocks `WebFetch` via Cloudflare 403. **Use `Bash curl` with a browser
User-Agent**, save to `/tmp/scrapy_*.html`, then `Read` + `Grep`. Verbatim pattern is in
`generate-crawler-scraper/SKILL.md` Scrapy Mode S2 (lines 728–738).

### A.2 BS4 → Scrapy selector cheatsheet

The Go backend returns a `extract_data(soup, base_url=None) -> dict` BeautifulSoup
function. Convert to `extract_data(response, base_url=None)` using native Scrapy selectors.
**Zero `BeautifulSoup`, `from bs4`, `soup.find`, `soup.select`, `.get_text(`, `.prettify()`
must remain after conversion** — verify with `grep -E 'BeautifulSoup|from bs4|soup\.|\.get_text\('`.

**Selector queries:**

| BS4 | Scrapy |
|---|---|
| `soup.select(".foo .bar")` | `response.css(".foo .bar")` |
| `soup.select_one(".foo")` | `response.css(".foo").get()` |
| `soup.find("a", class_="x")` | `response.css("a.x").get()` |
| `soup.find_all("a", class_="x")` | `response.css("a.x").getall()` |
| `soup.find(attrs={"data-id": "123"})` | `response.css('[data-id="123"]').get()` |
| `soup.find_all("a", href=True)` | `response.css("a[href]").getall()` |

**Text and attributes:**

| BS4 | Scrapy |
|---|---|
| `el.get_text(strip=True)` | `el.css("::text").get("").strip()` |
| `el.get_text(" ", strip=True)` | `" ".join(el.css("::text").getall()).strip()` |
| `el.get("href")` / `el["href"]` | `el.css("::attr(href)").get()` |
| `el.get("data-id")` | `el.css("::attr(data-id)").get()` |

**Iteration nested** — `Selector` objects from `.css()` chain like BS4 `Tag`s; only the
method names change:

```python
# BS4
for card in soup.select(".product-card"):
    title = card.select_one("h3").get_text(strip=True)

# Scrapy (native)
for card in response.css(".product-card"):
    title = card.css("h3::text").get("").strip()
```

For `el.parent` / sibling navigation use XPath axes:
`el.xpath("./parent::*").get()`, `el.xpath("following-sibling::*[1]").get()`.

### A.3 Single-URL Scrapy project (used by `generate-scraper` Framework Mode)

Layout for a one-URL spider that the user runs as
`scrapy crawl scraper -a url="<target>" -O out.jsonl`:

```
<slug>_scrapy/
├── scrapy.cfg
├── README.md
└── <project_pkg>/
    ├── __init__.py
    ├── settings.py
    ├── items.py
    ├── pipelines.py
    ├── middlewares.py
    └── spiders/
        ├── __init__.py
        └── scraper.py
```

**`scrapy.cfg`**:

```
[settings]
default = <project_pkg>.settings

[deploy]
project = <project_pkg>
```

**`<project_pkg>/settings.py`** (fallback — prefer values from the live `settings.html`):

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

CONCURRENT_REQUESTS = 1
CONCURRENT_REQUESTS_PER_DOMAIN = 1
DOWNLOAD_TIMEOUT = 60
RETRY_TIMES = 3
RETRY_HTTP_CODES = [500, 502, 503, 504, 408, 429]

AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 1.0
AUTOTHROTTLE_MAX_DELAY = 10.0
AUTOTHROTTLE_TARGET_CONCURRENCY = 1
AUTOTHROTTLE_DEBUG = False

ROBOTSTXT_OBEY = False
LOG_LEVEL = "INFO"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
FEED_EXPORT_ENCODING = "utf-8"
```

**`<project_pkg>/middlewares.py`** — Proxy API Aggregator URL rewrite (same middleware
used by the crawler-scraper Scrapy Mode):

```python
from urllib.parse import urlencode


class ScrapeOpsProxyMiddleware:
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
        payload = {"api_key": self.api_key, "url": request.url}
        request._set_url(self.PROXY_URL + "?" + urlencode(payload))
```

**`<project_pkg>/pipelines.py`** — three real pipelines:

```python
import re
from urllib.parse import urljoin

from scrapy.exceptions import DropItem


REQUIRED_FIELDS = ("url", "name")


class ValidationPipeline:
    """Drop items missing required keys."""

    def process_item(self, item, spider):
        missing = [f for f in REQUIRED_FIELDS if not item.get(f)]
        if missing:
            raise DropItem(f"Missing required fields: {missing}")
        return item


class DuplicatesPipeline:
    """Drop items whose `url` (or `productId`) was already seen in this run."""

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
    """Whitespace cleanup, URL resolution, light type coercion."""

    _ws_re = re.compile(r"\s+")

    def process_item(self, item, spider):
        for key, value in list(item.items()):
            if isinstance(value, str):
                item[key] = self._ws_re.sub(" ", value).strip()

        # Resolve relative URLs against the original request URL when present.
        original = (spider.crawler.stats.get_value("source_url")
                    if hasattr(spider, "crawler") else None)
        if original and item.get("url") and not item["url"].startswith("http"):
            item["url"] = urljoin(original, item["url"])

        # Coerce price-like fields.
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

**`<project_pkg>/items.py`** — `Item` + `ItemLoader` subclass:

```python
import scrapy
from itemloaders.processors import TakeFirst, MapCompose, Join, Identity


def _strip(v):
    return v.strip() if isinstance(v, str) else v


class ProductItem(scrapy.Item):
    url = scrapy.Field()
    name = scrapy.Field()
    price = scrapy.Field()
    images = scrapy.Field()
    description = scrapy.Field()
    # ... one Field() per top-level schema key


class ProductLoader(scrapy.loader.ItemLoader):
    default_output_processor = TakeFirst()
    default_input_processor = MapCompose(_strip)

    images_out = Identity()           # keep list as-is
    description_out = Join(" ")
```

**`<project_pkg>/spiders/scraper.py`** (single-URL, paste the CONVERTED `extract_data`):

```python
import scrapy

from <project_pkg>.items import ProductItem, ProductLoader


# <extract_data_scrapy_body> — the converted extract_data(response, base_url=None) from S5.
# Mixes response.css(...) and response.xpath(...) per the BS4→Scrapy cheatsheet.
# NEVER paste the BS4 version here.
<extract_data_scrapy_body>


class ScraperSpider(scrapy.Spider):
    name = "scraper"

    def __init__(self, url=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not url:
            raise ValueError("url is required (-a url=...)")
        self.start_url = url

    def start_requests(self):
        yield scrapy.Request(self.start_url, callback=self.parse_product)

    def parse_product(self, response):
        raw = extract_data(response, response.url) or {}
        loader = ProductLoader(item=ProductItem(), response=response)
        loader.add_value("url", response.url)
        for key, value in raw.items():
            if key == "url":
                continue
            if key in ProductItem.fields:
                loader.add_value(key, value)
        yield loader.load_item()
```

CLI: `scrapy crawl scraper -a url="<target>" -O out.jsonl`

### A.4 Crawler-scraper Scrapy project

Already documented in `generate-crawler-scraper/SKILL.md` Scrapy Mode (sections S6–S9 plus
the appendix at the bottom of that file). That mode is intentionally not duplicated here —
the crawler-scraper skill remains its own source of truth for that variant. This file only
adds the **single-URL Scrapy variant** above for the new `generate-scraper` Framework Mode.

---

## Section B — Crawlee (JavaScript)

### B.1 Canonical doc URLs (fetch in runtime)

| Page | URL |
|---|---|
| Quick start | `https://crawlee.dev/docs/quick-start` |
| Proxy management | `https://crawlee.dev/docs/guides/proxy-management` |
| `CheerioCrawler` API | `https://crawlee.dev/api/cheerio-crawler/class/CheerioCrawler` |
| `PlaywrightCrawler` API | `https://crawlee.dev/api/playwright-crawler/class/PlaywrightCrawler` |
| Routing | `https://crawlee.dev/docs/guides/routing` |

`crawlee.dev` is generally accessible via `WebFetch`. Fall back to `Bash curl` only if
WebFetch fails.

### B.2 Cheerio → Crawlee handler cheatsheet

The Go backend returns a Cheerio `extract_data($, baseUrl)` function. Cheerio is the
**native** parser inside Crawlee's `CheerioCrawler` — conversion is mostly about wiring
the function into a request handler. The function body itself usually doesn't change.

| Standalone Cheerio | Crawlee handler |
|---|---|
| `const $ = cheerio.load(html)` (manual) | `$` is provided in handler args: `({ $ }) => …` |
| `axios.get(url)` to fetch | Crawler manages fetching — push URLs via `crawler.run([url])` or `enqueueLinks` |
| Returning `data` object | `await pushData(data)` (writes to `storage/datasets/default/`) |
| Manual loop over URLs | Use `requestQueue` / `enqueueLinks({ urls })` |

**Adapter pattern**: keep `extract_data($, baseUrl)` exactly as the Go backend returned it,
and call it from the Crawlee handler:

```javascript
import { extract_data } from "./extractor.js";

const crawler = new CheerioCrawler({
  requestHandler: async ({ $, request, pushData }) => {
    const data = extract_data($, request.loadedUrl);
    if (data) await pushData({ url: request.loadedUrl, ...data });
  },
});
```

### B.3 Single-URL Crawlee project (used by `generate-scraper` Framework Mode)

Layout for a one-URL Cheerio crawler the user runs as `node src/main.js --url "<target>"`:

```
<slug>_crawlee/
├── package.json
├── README.md
└── src/
    ├── main.js
    ├── router.js
    ├── extractor.js
    └── proxy.js
```

**`package.json`**:

```json
{
  "name": "<slug>-crawlee",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node src/main.js"
  },
  "dependencies": {
    "crawlee": "^3.0.0"
  }
}
```

**`src/extractor.js`** — paste the Cheerio function returned by the Go backend, exported:

```javascript
// <extract_data_body> — returned by Go backend with target_library: "cheerio".
// Must export a function with signature ($, baseUrl) -> object | null.
export function extract_data($, baseUrl) {
  // ... Cheerio code returned by the backend ...
}
```

**`src/proxy.js`** — Proxy API Aggregator URL builder:

```javascript
const PROXY_BASE = "https://proxy.scrapeops.io/v1/";

export function buildProxyUrl(targetUrl) {
  const apiKey = process.env.SCRAPEOPS_API_KEY ?? "";
  if (!apiKey) {
    throw new Error("SCRAPEOPS_API_KEY not set in environment");
  }
  if (targetUrl.startsWith(PROXY_BASE)) return targetUrl;
  const params = new URLSearchParams({ api_key: apiKey, url: targetUrl });
  return `${PROXY_BASE}?${params.toString()}`;
}

export const PROXY_BASE_URL = PROXY_BASE;
```

**`src/router.js`** — single-handler router (Crawlee's idiom even for one URL):

```javascript
import { createCheerioRouter, Dataset } from "crawlee";
import { extract_data } from "./extractor.js";

export const router = createCheerioRouter();

router.addDefaultHandler(async ({ $, request, pushData, log }) => {
  const originalUrl = request.userData.originalUrl ?? request.url;
  const data = extract_data($, originalUrl) || {};
  await pushData({ url: originalUrl, ...data });
  log.info(`Extracted ${originalUrl}`);
});
```

**`src/main.js`** — `CheerioCrawler` with router, sessionPool, failedRequestHandler, and
`preNavigationHooks` rewriting URL through ScrapeOps Proxy API:

```javascript
import { CheerioCrawler, Dataset } from "crawlee";
import { router } from "./router.js";
import { buildProxyUrl, PROXY_BASE_URL } from "./proxy.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.url) {
  console.error("Usage: node src/main.js --url <target_url>");
  process.exit(1);
}

const crawler = new CheerioCrawler({
  maxRequestsPerCrawl: 1,
  maxConcurrency: 1,
  useSessionPool: true,
  sessionPoolOptions: { maxPoolSize: 100 },
  persistCookiesPerSession: true,
  requestHandler: router,
  preNavigationHooks: [
    async ({ request }) => {
      if (request.url.startsWith(PROXY_BASE_URL)) return;
      request.url = buildProxyUrl(request.url);
    },
  ],
  failedRequestHandler: async ({ request, error, log }) => {
    log.error(`Request failed: ${request.url} — ${error?.message}`);
    const failed = await Dataset.open("failed");
    await failed.pushData({
      url: request.userData?.originalUrl ?? request.url,
      error: String(error?.message ?? error),
      retryCount: request.retryCount,
    });
  },
});

await crawler.run([{ url: args.url, userData: { originalUrl: args.url } }]);
```

**Run**:

```bash
export SCRAPEOPS_API_KEY=<your-key>
npm install
node src/main.js --url "https://example.com/target"
# Output goes to ./storage/datasets/default/*.json (Crawlee's default storage)
```

### B.4 Crawler+scraper Crawlee project (used by `generate-crawler-scraper` Framework Mode)

Two-spider layout: one crawler that walks a listing+pagination and writes a JSONL of
product URLs; one scraper that reads that JSONL and writes a JSONL of products.

```
<slug>_crawlee/
├── package.json
├── README.md
├── crawler_schema.json
├── product_schema.json
└── src/
    ├── proxy.js               # builds proxy URL or proxyConfiguration
    ├── crawler_extractor.js   # extract_data($, baseUrl) for listing pages
    ├── product_extractor.js   # extract_data($, baseUrl) for product pages
    ├── router.js              # createCheerioRouter() with LISTING + PRODUCT handlers
    ├── crawler.js             # entrypoint: crawl listing, write urls.jsonl
    └── scraper.js             # entrypoint: read urls.jsonl, write products.jsonl
```

**`package.json`** (HTTP transport — `CheerioCrawler`):

```json
{
  "name": "<slug>-crawlee",
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

For browser transport (`PlaywrightCrawler`), add `"playwright": "^1.40.0"` and an
appropriate proxy via `ProxyConfiguration` instead of `preNavigationHooks` (see B.5).

**`src/router.js`** — shared router with LISTING + PRODUCT handlers:

```javascript
import { createCheerioRouter, Dataset } from "crawlee";
import { extract_data as extract_listing } from "./crawler_extractor.js";
import { extract_data as extract_product } from "./product_extractor.js";

export const router = createCheerioRouter();

// LISTING handler — extracts product URLs and follows pagination.
// Side effects (writing JSONL, stopping after maxPages) come from `userData.context`
// supplied by the entrypoint.
router.addHandler("LISTING", async ({ $, request, log }) => {
  const ctx = request.userData.context;
  const page = request.userData.page ?? 1;
  const originalUrl = request.userData.originalUrl ?? request.url;
  const data = extract_listing($, originalUrl) || {};

  for (const product of data.products ?? []) {
    const productUrl = product?.url;
    if (!productUrl || ctx.seen.has(productUrl)) continue;
    ctx.seen.add(productUrl);
    ctx.output.write(JSON.stringify({
      url: productUrl,
      productId: product.productId,
      name: product.name,
      discoveredOnPage: page,
      discoveredFromListing: originalUrl,
    }) + "\n");
  }

  const nextUrl = data.pagination?.nextPageUrl;
  if (nextUrl && page < ctx.maxPages) {
    await ctx.crawler.addRequests([{
      url: nextUrl,
      label: "LISTING",
      userData: { page: page + 1, originalUrl: nextUrl, context: ctx },
    }]);
  }
});

// PRODUCT handler — extracts full product details and pushes to default Dataset.
router.addHandler("PRODUCT", async ({ $, request, pushData, log }) => {
  const originalUrl = request.userData.originalUrl ?? request.url;
  const data = extract_product($, originalUrl) || {};
  await pushData({ url: originalUrl, ...data });
  if (request.userData.outputStream) {
    request.userData.outputStream.write(JSON.stringify({ url: originalUrl, ...data }) + "\n");
  }
});

router.addDefaultHandler(async ({ request, log }) => {
  log.warning(`Unrouted request: ${request.url} (label=${request.label ?? "none"})`);
});
```

**`src/crawler.js`** — listing entrypoint:

```javascript
import fs from "node:fs";
import { CheerioCrawler, Dataset } from "crawlee";
import { router } from "./router.js";
import { buildProxyUrl, PROXY_BASE_URL } from "./proxy.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args["listing-url"]) {
  console.error("Usage: node src/crawler.js --listing-url <url> [--max-pages 1] [--output urls.jsonl]");
  process.exit(1);
}
const maxPages = parseInt(args["max-pages"] ?? "1", 10);
const outputPath = args.output ?? "urls.jsonl";
const output = fs.createWriteStream(outputPath, { flags: "w" });

const crawler = new CheerioCrawler({
  requestHandler: router,
  maxConcurrency: <CONCURRENCY>,
  useSessionPool: true,
  sessionPoolOptions: { maxPoolSize: 100 },
  persistCookiesPerSession: true,
  preNavigationHooks: [
    async ({ request }) => {
      if (request.url.startsWith(PROXY_BASE_URL)) return;
      request.url = buildProxyUrl(request.url);
    },
  ],
  failedRequestHandler: async ({ request, error, log }) => {
    log.error(`LISTING request failed: ${request.url} — ${error?.message}`);
    const failed = await Dataset.open("failed");
    await failed.pushData({
      label: request.label,
      url: request.userData?.originalUrl ?? request.url,
      error: String(error?.message ?? error),
      retryCount: request.retryCount,
    });
  },
});

const ctx = { crawler, output, seen: new Set(), maxPages };

await crawler.run([{
  url: args["listing-url"],
  label: "LISTING",
  userData: { page: 1, originalUrl: args["listing-url"], context: ctx },
}]);
output.end();
```

**`src/scraper.js`** — product entrypoint:

```javascript
import fs from "node:fs";
import readline from "node:readline";
import { CheerioCrawler, Dataset } from "crawlee";
import { router } from "./router.js";
import { buildProxyUrl, PROXY_BASE_URL } from "./proxy.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return args;
}

const args = parseArgs(process.argv);
const inputFile = args["urls-file"];
if (!inputFile) {
  console.error("Usage: node src/scraper.js --urls-file urls.jsonl [--output products.jsonl] [--concurrency N]");
  process.exit(1);
}
const outputPath = args.output ?? "products.jsonl";
const concurrency = parseInt(args.concurrency ?? "<CONCURRENCY>", 10);
const outputStream = fs.createWriteStream(outputPath, { flags: "w" });

const requests = [];
const rl = readline.createInterface({ input: fs.createReadStream(inputFile) });
for await (const line of rl) {
  if (!line.trim()) continue;
  const obj = JSON.parse(line);
  if (obj.url) {
    requests.push({
      url: obj.url,
      label: "PRODUCT",
      userData: { originalUrl: obj.url, outputStream },
    });
  }
}

const crawler = new CheerioCrawler({
  requestHandler: router,
  maxConcurrency: concurrency,
  useSessionPool: true,
  sessionPoolOptions: { maxPoolSize: 100 },
  persistCookiesPerSession: true,
  preNavigationHooks: [
    async ({ request }) => {
      if (request.url.startsWith(PROXY_BASE_URL)) return;
      request.url = buildProxyUrl(request.url);
    },
  ],
  failedRequestHandler: async ({ request, error, log }) => {
    log.error(`PRODUCT request failed: ${request.url} — ${error?.message}`);
    const failed = await Dataset.open("failed");
    await failed.pushData({
      label: request.label,
      url: request.userData?.originalUrl ?? request.url,
      error: String(error?.message ?? error),
      retryCount: request.retryCount,
    });
  },
});

await crawler.run(requests);
outputStream.end();
```

### B.5 Browser transport (PlaywrightCrawler) — uses Residential proxy

When the user explicitly asks for JS rendering / a real browser, swap `CheerioCrawler` for
`PlaywrightCrawler`. The proxy switches from "URL rewrite via preNavigationHooks" to
"proxy on the wire via `ProxyConfiguration`":

```javascript
import { PlaywrightCrawler, ProxyConfiguration } from "crawlee";

const apiKey = process.env.SCRAPEOPS_API_KEY ?? "";
const proxyConfiguration = new ProxyConfiguration({
  proxyUrls: [
    `http://scrapeops:${apiKey}@residential-proxy.scrapeops.io:8181`,
  ],
});

const crawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxConcurrency: <CONCURRENCY>,
  requestHandler: async ({ page, request, pushData }) => {
    const html = await page.content();
    // For browser mode, $ is not provided — either:
    // (a) load Cheerio manually: const $ = cheerio.load(html);
    // (b) use page.locator(...) and rewrite extract_data to take `page` instead of `$`.
  },
});
```

For the first cut, Crawlee mode defaults to **HTTP transport (`CheerioCrawler`)** since
the Go backend already returns Cheerio code. Browser transport is supported but requires
either manual Cheerio loading inside the handler or rewriting `extract_data` to take
`page` directly — call this out to the user before generating.

### B.6 Validation grep

After writing the project, verify with `grep -rE 'axios|require\(['"]https?['"]\)' <slug>_crawlee/src/`
returns zero matches — the project should not depend on `axios` or hand-rolled
`http`/`https` clients; Crawlee owns transport.

---

## Section C — Decision matrix (proxy choice per framework + transport)

| Framework + transport | Proxy product | Mechanism |
|---|---|---|
| Scrapy (default downloader) | Proxy API Aggregator | `DownloaderMiddleware` rewriting `request.url` |
| Crawlee `CheerioCrawler` / `HttpCrawler` | Proxy API Aggregator | `preNavigationHooks` rewriting `request.url` |
| Crawlee `PlaywrightCrawler` / `PuppeteerCrawler` | Residential & Mobile Proxy Aggregator | `ProxyConfiguration({ proxyUrls: [...] })` |
| Plain Playwright/Puppeteer/Selenium | Residential & Mobile Proxy Aggregator | Browser launch option `proxy: { server, username, password }` |

The skill must state the choice and reason once, before generating proxy code:

> *Selected proxy: **\<product\>** — \<one-line reason\>.*

---

## Section E — Native framework features REQUIRED in every Framework Mode project

The whole point of using Scrapy or Crawlee is to leverage their native machinery. A
Framework Mode project that just wraps `extract_data(...)` in a thin spider is **not
idiomatic** and must be rejected during assembly. Every Framework Mode run MUST include
the following per-framework features in the generated project. Verify each item with the
greps in Section D before declaring the project done.

### E.1 Scrapy required features

**1. Selectors — both CSS and XPath, used where each is strongest.**

The converted `extract_data(response, base_url)` should mix `response.css(...)` and
`response.xpath(...)` based on what fits best. Don't force everything into CSS. Use XPath
for: parent/sibling/ancestor traversal, predicates with `contains(text(), ...)`,
positional access (`[1]`, `[last()]`), and mixed-namespace HTML. Use CSS for: class/id
selectors, `::text`, `::attr(...)`. In the appendix's Scrapy fallback templates, the
spider entry shows both in use. Don't strip XPath from the converted body.

**2. Items + ItemLoaders.**

Define a `scrapy.Item` subclass per page type with `scrapy.Field()` per top-level schema
key. Don't mutate dicts in the spider. Populate items via `ItemLoader` with input/output
processors so cleanup (whitespace strip, type coercion, dedup) happens in one place:

```python
import scrapy
from itemloaders.processors import TakeFirst, MapCompose, Join, Identity


class ProductItem(scrapy.Item):
    url = scrapy.Field()
    name = scrapy.Field()
    price = scrapy.Field()
    images = scrapy.Field()
    description = scrapy.Field()


class ProductLoader(scrapy.loader.ItemLoader):
    default_output_processor = TakeFirst()
    name_in = MapCompose(str.strip)
    price_in = MapCompose(str.strip, lambda v: v.replace("$", "").replace(",", ""))
    images_out = Identity()           # keep list as-is
    description_in = MapCompose(str.strip)
    description_out = Join(" ")
```

Spider populates the loader from the converted `extract_data` output:

```python
def parse_product(self, response):
    raw = extract_data(response, response.url) or {}
    loader = ProductLoader(item=ProductItem(), response=response)
    for key, value in raw.items():
        if key in ProductItem.fields:
            loader.add_value(key, value)
    yield loader.load_item()
```

**3. Item Pipelines — at least three real ones (not no-ops).**

In `<pkg>/pipelines.py`:

- `ValidationPipeline` — drop items missing required fields (e.g. `url`, `name`). Raise
  `DropItem` from `scrapy.exceptions`.
- `DuplicatesPipeline` — track seen `url` (or `productId`) in a set, drop dupes.
- `NormalizationPipeline` — collapse whitespace, coerce types, normalize URLs (resolve
  relative against `response.url` if not already absolute).

Wire them in `settings.py` with explicit priorities (lower = earlier):

```python
ITEM_PIPELINES = {
    "<pkg>.pipelines.ValidationPipeline": 100,
    "<pkg>.pipelines.DuplicatesPipeline": 200,
    "<pkg>.pipelines.NormalizationPipeline": 300,
}
```

The native `-O <file>.jsonl` CLI flag handles JSONL writing — don't write a
`JsonLinesPipeline` no-op just to "have one"; either it does real work or it's omitted.

**4. Middlewares.**

- `ScrapeOpsProxyMiddleware` (`DownloaderMiddleware`) — already required, rewrites
  `request.url` to the Proxy API Aggregator. Priority `725`.
- Scrapy's built-in `RetryMiddleware` — keep enabled (it is by default). Configure via
  `RETRY_TIMES`, `RETRY_HTTP_CODES` in settings.
- Optional: a `SpiderMiddleware` `OffsiteRequestsLogger` that logs and drops requests
  outside the seed domain — only add if the user asked for strict scope. Default off.

**5. Settings — autothrottle ON.**

```python
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 1.0
AUTOTHROTTLE_MAX_DELAY = 10.0
AUTOTHROTTLE_TARGET_CONCURRENCY = <CONCURRENCY>
AUTOTHROTTLE_DEBUG = False
```

Plus `CONCURRENT_REQUESTS`, `CONCURRENT_REQUESTS_PER_DOMAIN`, `DOWNLOAD_TIMEOUT`,
`RETRY_TIMES`, `RETRY_HTTP_CODES`, `ROBOTSTXT_OBEY = False` (we're going through a paid
proxy), `LOG_LEVEL = "INFO"`, `FEED_EXPORT_ENCODING = "utf-8"`. All from S2's
`settings.html`.

**6. Feed exports — Scrapy native.**

Use `-O <file>.jsonl` (uppercase O = overwrite, lowercase = append). No custom file
writers. Document this in the README.

### E.2 Crawlee required features

**1. Selectors — both CSS and XPath where each is strongest.**

Cheerio (`$` in `CheerioCrawler`) supports CSS via `$('selector')`. For XPath, use the
`xpath()` plugin pattern or fall back to traversal helpers (`.parent()`, `.siblings()`,
`.find()`). For `PlaywrightCrawler`, prefer `page.locator('css=...')` and
`page.locator('xpath=//...')` — both are first-class. Mix as needed; don't avoid XPath.

**2. Datasets and KeyValueStore (Crawlee's items + storage).**

- `await pushData({...})` writes to the default `Dataset` at
  `./storage/datasets/default/`. Use this for the main scraped output.
- `await Dataset.open('failed').then(d => d.pushData({...}))` for a separate dataset of
  failed requests / partial extractions.
- `KeyValueStore` for per-run state (last cursor, run metadata). Use only when needed.

**3. Routers — `createCheerioRouter()` (or `createPlaywrightRouter()` for browser).**

Even for single-URL flows, register a single `default` handler in the router. For
crawler+scraper combos the router has named handlers (`LISTING`, `PRODUCT`):

```javascript
import { createCheerioRouter } from "crawlee";
import { extract_data as extract_listing } from "./crawler_extractor.js";
import { extract_data as extract_product } from "./product_extractor.js";

export const router = createCheerioRouter();

router.addHandler("LISTING", async ({ $, request, enqueueLinks, pushData, log }) => {
  const data = extract_listing($, request.userData.originalUrl) || {};
  // ... enqueue product URLs with label "PRODUCT", enqueue next page with label "LISTING"
});

router.addHandler("PRODUCT", async ({ $, request, pushData, log }) => {
  const data = extract_product($, request.userData.originalUrl) || {};
  await pushData({ url: request.userData.originalUrl, ...data });
});

router.addDefaultHandler(async ({ request, log }) => {
  log.warning(`Unrouted request: ${request.url}`);
});
```

Wire on the crawler: `requestHandler: router`.

**4. SessionPool — enabled by default.**

Crawlee tracks per-request session health. For HTTP transport via Proxy API, a session
pool is mostly cosmetic but cheap to enable; for browser/residential, it's load-bearing
(sticky sessions). Always enable:

```javascript
const crawler = new CheerioCrawler({
  // ...
  useSessionPool: true,
  sessionPoolOptions: { maxPoolSize: 100 },
  persistCookiesPerSession: true,
});
```

For `PlaywrightCrawler` + Residential proxy, set
`sessionPoolOptions: { sessionOptions: { maxUsageCount: 50 } }` to rotate sessions before
ban.

**5. `failedRequestHandler` — required.**

Capture failures so the user can debug:

```javascript
failedRequestHandler: async ({ request, error, log }) => {
  log.error(`Request failed after retries: ${request.url} — ${error?.message}`);
  const failed = await Dataset.open("failed");
  await failed.pushData({
    url: request.userData?.originalUrl ?? request.url,
    error: String(error?.message ?? error),
    label: request.label,
    retryCount: request.retryCount,
  });
},
```

**6. preNavigationHooks / postNavigationHooks.**

- `preNavigationHooks` — already used to inject the ScrapeOps proxy URL (HTTP transport).
- `postNavigationHooks` — optional, for telemetry / response-size logging. Add only if it
  earns its keep.

**7. autoscaledPoolOptions / maxConcurrency.**

Set `maxConcurrency: <CONCURRENCY>` (from `scrapeops_get_concurrency_limit`). Don't
configure `autoscaledPoolOptions.minConcurrency` unless the user asks — Crawlee's defaults
are sane.

**8. RequestQueue — implicit, but used explicitly when adding mid-run.**

The crawler maintains a request queue automatically. Mid-run, add via
`crawler.addRequests([...])` (NOT by mutating the array passed to `crawler.run()`).

**9. Storage layout.**

Crawlee writes to `./storage/`:
- `./storage/datasets/default/` — `pushData()` results, one JSON file per call.
- `./storage/datasets/failed/` — per the `failedRequestHandler`.
- `./storage/key_value_stores/default/` — KV store entries.
- `./storage/request_queues/default/` — internal queue state (delete to start fresh).

Document this in the README — users tend to ask "where did my data go?" the first time.

### E.3 Validation greps for required native features

After assembly, run these to ensure features are wired (zero matches = feature missing):

**Scrapy** (in `<slug>_scrapy/<pkg>/`):

```bash
grep -E 'class .*Loader' <pkg>/items.py || echo "MISSING: ItemLoader subclass"
grep -E 'AUTOTHROTTLE_ENABLED\s*=\s*True' <pkg>/settings.py || echo "MISSING: autothrottle"
grep -E 'class ValidationPipeline|class DuplicatesPipeline|class NormalizationPipeline' <pkg>/pipelines.py || echo "MISSING: real pipelines"
grep -E 'ITEM_PIPELINES' <pkg>/settings.py || echo "MISSING: ITEM_PIPELINES"
```

**Crawlee** (in `<slug>_crawlee/src/`):

```bash
grep -rE 'createCheerioRouter|createPlaywrightRouter' src/ || echo "MISSING: router"
grep -rE 'useSessionPool\s*:\s*true' src/ || echo "MISSING: session pool"
grep -rE 'failedRequestHandler' src/ || echo "MISSING: failedRequestHandler"
grep -rE 'maxConcurrency' src/ || echo "MISSING: maxConcurrency"
```

If any of these warn `MISSING`, the project is not idiomatic — fix the assembly, do NOT
ship the project as-is.

---

## Section D — Validation grep (paste in skill code)

Always run after assembling a Framework Mode project. Zero matches required.

**Scrapy (Python)**:
```bash
grep -rE 'BeautifulSoup|from bs4|import bs4|soup\.|\.get_text\(|\.prettify\(\)' <slug>_scrapy/<project_pkg>/
```

**Crawlee (JS)**:
```bash
grep -rE "require\(['\"]axios['\"]\)|from ['\"]axios['\"]|require\(['\"]https?['\"]\)" <slug>_crawlee/src/
```

If anything matches, the conversion is incomplete — invoke `parser-fixer` on the
offending file with explicit "do NOT keep BS4 / axios" instructions. (See `parser-fixer.md`.)
