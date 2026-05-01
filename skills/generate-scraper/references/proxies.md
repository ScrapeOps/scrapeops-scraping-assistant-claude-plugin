# ScrapeOps Proxy Products — Reference (offline fallback)

> **READ THIS FIRST.** This file is the **offline fallback** used by Framework Mode in
> `generate-scraper` and `generate-crawler-scraper` only when the live docs cannot be
> reached. Every Framework Mode run must FIRST try to fetch the two canonical pages below
> and use the live content. Use this file only when both `WebFetch` AND `Bash curl` (with
> a browser User-Agent) fail or return empty content for both URLs.

## Canonical doc URLs (always try these first, in order)

| Proxy product | Canonical doc URL |
|---|---|
| Proxy API Aggregator | `https://scrapeops.io/docs/web-scraping-proxy-api-aggregator/quickstart/` |
| Residential & Mobile Proxy Aggregator | `https://scrapeops.io/docs/residential-mobile-proxy-aggregator/overview/` |

Fetch order in Framework Mode:

1. `WebFetch` with a prompt that extracts: endpoint, auth, target URL parameter, optional
   parameters, language snippets.
2. If WebFetch returns 403 / timeout / empty — fall back to `Bash curl -sSL -A "<browser UA>"`
   into `/tmp/scrapeops_proxy_api.html` and `/tmp/scrapeops_residential.html`, then `Read`
   + `Grep` for the same fields. (Same pattern used by Scrapy Mode S2 in the
   `generate-crawler-scraper` skill.)
3. If both methods fail for both URLs, use this file and warn the user:
   *"scrapeops.io docs unreachable — using offline reference. Generated proxy code reflects
   2026-04 snapshot; verify against live docs before running in production."*

---

## 1. Proxy API Aggregator

**Use when**: client code controls the request URL and can rewrite it before sending
(Scrapy default downloader, Crawlee `CheerioCrawler`/`HttpCrawler`, plain `requests` /
`axios` / `fetch` HTTP clients). Pricing model is **pay-per-successful-request**.

### Endpoint

`https://proxy.scrapeops.io/v1/`

### Authentication

API key passed as a query string parameter: `api_key=YOUR_API_KEY`. No headers, no proxy
tunneling.

### Target URL

Pass the target URL as the `url` query string parameter. Must be URL-encoded.

### Optional parameters (verified subset)

| Parameter | Effect |
|---|---|
| `render_js=true` | Headless browser renders JS before returning HTML. Slower, costs more. |
| `country=us` (or other ISO codes) | Geo-locate the request from a specific country. |
| `residential=true` | Route through residential IPs instead of datacenter IPs. |

> The quickstart only documents the three parameters above. Additional parameters
> (`premium`, `device`, `session`, `keep_headers`, `bypass`, `optimize_request`) appear in
> other parts of the public docs and may be supported. When the live doc fetch succeeds,
> use whatever it lists. When using this fallback, stick to the verified subset.

### Python (requests)

```python
import requests
from urllib.parse import urlencode

proxy_params = {
    "api_key": "YOUR_API_KEY",
    "url": "https://example.com/target",
    "render_js": "true",  # optional
}
response = requests.get(
    url="https://proxy.scrapeops.io/v1/",
    params=urlencode(proxy_params),
    timeout=120,
)
```

### JavaScript (axios / fetch)

```javascript
const params = new URLSearchParams({
  api_key: process.env.SCRAPEOPS_API_KEY,
  url: "https://example.com/target",
});
const resp = await fetch(`https://proxy.scrapeops.io/v1/?${params}`);
const html = await resp.text();
```

### Scrapy (URL-rewrite middleware)

```python
from urllib.parse import urlencode

class ScrapeOpsProxyMiddleware:
    PROXY_URL = "https://proxy.scrapeops.io/v1/"

    @classmethod
    def from_crawler(cls, crawler):
        api_key = crawler.settings.get("SCRAPEOPS_API_KEY")
        if not api_key:
            raise ValueError("SCRAPEOPS_API_KEY not set")
        return cls(api_key)

    def __init__(self, api_key):
        self.api_key = api_key

    def process_request(self, request, spider):
        if request.url.startswith(self.PROXY_URL):
            return
        payload = {"api_key": self.api_key, "url": request.url}
        request._set_url(self.PROXY_URL + "?" + urlencode(payload))
```

### Crawlee `CheerioCrawler` (preNavigationHooks URL rewrite)

```javascript
import { CheerioCrawler } from "crawlee";

const PROXY_BASE = "https://proxy.scrapeops.io/v1/";

const crawler = new CheerioCrawler({
  preNavigationHooks: [
    async ({ request }) => {
      if (request.url.startsWith(PROXY_BASE)) return;
      const params = new URLSearchParams({
        api_key: process.env.SCRAPEOPS_API_KEY ?? "",
        url: request.url,
      });
      request.url = `${PROXY_BASE}?${params}`;
    },
  ],
  requestHandler: async ({ $, request, pushData }) => {
    // extract_data($, request.loadedUrl) ...
  },
});
```

---

## 2. Residential & Mobile Proxy Aggregator

**Use when**: client code cannot rewrite request URLs cleanly (headless browsers like
Crawlee `PlaywrightCrawler`/`PuppeteerCrawler`, plain Playwright/Puppeteer/Selenium, any
flow that needs a real proxy on the wire and sticky sessions). Pricing model is
**pay-per-bandwidth**.

### Connection

| Field | Value |
|---|---|
| Host | `residential-proxy.scrapeops.io` |
| Port | `8181` |
| Protocol | HTTP/HTTPS proxy with Basic auth |

### Authentication

Standard HTTP proxy Basic auth, encoded in the proxy URL:

```
http://scrapeops:YOUR_API_KEY@residential-proxy.scrapeops.io:8181
```

| Credential | Value |
|---|---|
| Username | `scrapeops` (literal) |
| Password | Your ScrapeOps API key |

### Target URL

Passed transparently through standard HTTP proxy tunneling. The client makes a normal
request to the target URL; the proxy intercepts. No query parameters, no URL rewriting.

### Optional parameters (verified)

The overview page does not enumerate optional parameters in detail. Country selection,
sticky sessions, and mobile-vs-residential variants are mentioned as available features.
When the live doc fetch succeeds, use whatever the doc lists. In this fallback, default to
plain residential without extras and surface a note to the user that finer control needs
the live docs.

### Python (requests)

```python
import requests

api_key = os.environ["SCRAPEOPS_API_KEY"]
proxies = {
    "http":  f"http://scrapeops:{api_key}@residential-proxy.scrapeops.io:8181",
    "https": f"http://scrapeops:{api_key}@residential-proxy.scrapeops.io:8181",
}
response = requests.get("https://example.com/target", proxies=proxies, verify=False)
```

> **SSL note**: the docs show `verify=False`. The proxy presents a CA chain that
> `requests` may not trust by default. Either disable verification (less safe) or install
> the ScrapeOps CA cert.

### JavaScript / Node (HttpsProxyAgent)

```javascript
import { HttpsProxyAgent } from "https-proxy-agent";

const apiKey = process.env.SCRAPEOPS_API_KEY;
const proxyUrl = `http://scrapeops:${apiKey}@residential-proxy.scrapeops.io:8181`;
const agent = new HttpsProxyAgent(proxyUrl);

const resp = await fetch("https://example.com/target", { agent });
```

### Crawlee `PlaywrightCrawler` (proxyConfiguration)

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
  requestHandler: async ({ page, request, pushData }) => {
    // extract_data(page, request.url) ...
  },
});
```

### Plain Playwright (proxy server)

```javascript
const browser = await chromium.launch({
  proxy: {
    server: "http://residential-proxy.scrapeops.io:8181",
    username: "scrapeops",
    password: process.env.SCRAPEOPS_API_KEY,
  },
});
```

---

## Decision rule (which proxy to inject)

| Client code shape | Proxy product |
|---|---|
| HTTP client whose URL the code controls (Scrapy default, Crawlee `CheerioCrawler`/`HttpCrawler`, plain `requests`/`axios`) | **Proxy API Aggregator** (URL rewrite) |
| Headless browser or any flow where rewriting URL breaks navigation (Crawlee `PlaywrightCrawler`/`PuppeteerCrawler`, plain Playwright/Puppeteer/Selenium) | **Residential & Mobile Proxy Aggregator** (proxy on the wire) |

When unsure between the two, default to **Proxy API Aggregator** for HTTP-only flows
(cheaper per-request) and switch to Residential only when the framework's transport is a
browser.

The skill should print the choice to the user with a one-line reason, e.g.:

> *Selected proxy: **Proxy API Aggregator** — Scrapy's downloader middleware rewrites
> request URLs cleanly; pay-per-success is the cheapest path for HTTP-only crawls.*
