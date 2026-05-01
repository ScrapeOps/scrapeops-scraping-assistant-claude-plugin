# Supported Languages & Libraries

## Python

| Library | `target_library` value (sent to backend) | `framework_mode` | Description |
|---------|----------------------|---|---|
| **BeautifulSoup** | `beautifulsoup` | — | Simple HTML parsing with requests |
| **Playwright** | `playwright` | — | Browser automation, handles JavaScript |
| **Selenium** | `selenium` | — | Browser automation, handles JavaScript |
| **Scrapy** | `beautifulsoup` *(intermediate)* | `scrapy` | Full framework — backend returns BS4 extractor and the skill converts to native Scrapy selectors locally, then assembles a Scrapy project with `ScrapeOpsProxyMiddleware` |

## JavaScript / Node.js

| Library | `target_library` value (sent to backend) | `framework_mode` | Description |
|---------|----------------------|---|---|
| **Cheerio + Axios** | `cheerio` | — | Lightweight jQuery-like parsing |
| **Playwright** | `playwright` | — | Browser automation, handles JavaScript |
| **Puppeteer** | `puppeteer` | — | Headless Chrome automation |
| **Crawlee** | `cheerio` *(intermediate)* | `crawlee` | Full Node.js framework — backend returns a Cheerio extractor and the skill assembles a Crawlee project around it (`CheerioCrawler` for HTTP, `PlaywrightCrawler` for browser) |

> **Framework Mode**: when `framework_mode` is non-empty, the skill takes a different path:
> submits the backend with `parser_only: true` (asks for the extractor function only — no
> HTTP client, no proxy, no `main()`), then **locally** converts the function and assembles
> a framework-idiomatic project with proxy injection. The `target_library` value sent to
> the backend is **intermediate** — it is what the backend can produce today, NOT the
> library shown to the end user. Details and templates: `references/frameworks.md`.

> **Search Page Mode + frameworks**: Search Page Mode (the keyword × filters × pagination
> loop in `generate-scraper`) currently supports only **BeautifulSoup** (Python) and
> **Cheerio** (JavaScript). When the user picks Scrapy or Crawlee on a search-page URL,
> the skill asks them to switch library to BS4/Cheerio or fall back to Framework Mode
> (single-URL). Phase 2 will add keyword-driven `start_requests()` for Scrapy and a
> keyword-built initial-request array for Crawlee.

## Other Languages (auto-converted by backend)

The backend generates the scraper in Python/JavaScript and then converts to:

- **Go** — idiomatic Go with `net/http` and `goquery`
- **Ruby** — with `nokogiri`
- **PHP** — with `symfony/dom-crawler`
- **Rust** — with `reqwest` and `scraper`
- **Java** — with `jsoup`
- **C#** — with `HtmlAgilityPack`

> For these languages, set `target_language` to `python` and the backend will handle conversion automatically.

## When to Use JS Rendering

Use Playwright or Puppeteer/Selenium/Pyppeteer when the target website:
- Loads content via JavaScript (React, Vue, Angular apps)
- Has content that requires scrolling or interaction
- Shows a blank page when fetched with a plain HTTP request

Use BeautifulSoup/Cheerio for static HTML pages (faster and simpler).

## API Values Reference

```json
{
  "python + beautifulsoup": { "target_language": "python", "target_library": "beautifulsoup" },
  "python + playwright":    { "target_language": "python", "target_library": "playwright" },
  "python + selenium":      { "target_language": "python", "target_library": "selenium" },
  "python + scrapy":        { "target_language": "python", "target_library": "beautifulsoup", "framework_mode": "scrapy" },
  "javascript + cheerio":   { "target_language": "javascript", "target_library": "cheerio" },
  "javascript + playwright":{ "target_language": "javascript", "target_library": "playwright" },
  "javascript + puppeteer": { "target_language": "javascript", "target_library": "puppeteer" },
  "javascript + crawlee":   { "target_language": "javascript", "target_library": "cheerio", "framework_mode": "crawlee" }
}
```
