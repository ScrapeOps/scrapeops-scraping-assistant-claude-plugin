# Supported Languages & Libraries

## Python

| Library | `target_library` value | Description |
|---------|----------------------|-------------|
| **BeautifulSoup** (recommended) | `beautifulsoup` | Simple HTML parsing with requests |
| **Playwright** | `playwright` | Browser automation, handles JavaScript |
| **Selenium** | `selenium` | Browser automation, handles JavaScript |

## JavaScript / Node.js

| Library | `target_library` value | Description |
|---------|----------------------|-------------|
| **Cheerio + Axios** (recommended) | `cheerio` | Lightweight jQuery-like parsing |
| **Playwright** | `playwright` | Browser automation, handles JavaScript |
| **Puppeteer** | `puppeteer` | Headless Chrome automation |

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
  "javascript + cheerio":   { "target_language": "javascript", "target_library": "cheerio" },
  "javascript + playwright":{ "target_language": "javascript", "target_library": "playwright" },
  "javascript + puppeteer": { "target_language": "javascript", "target_library": "puppeteer" }
}
```
