---
name: generate-data-schema
description: Use this skill to build a data-extraction schema JSON file that tells ScrapeOps what fields to extract. Trigger on phrases like "generate schema", "create schema", "data schema for X", "schema for crawler", "build a schema". Also invoked programmatically by other skills (e.g. generate-crawler-scraper) — in that case the args target_page_type, user_description, and output_path are passed in. The output is a JSON file in the Go backend's expected shape (fields with type, required, priority_level, null_value, description), ready to be sent via schema_json in scrapeops_submit_job. Do NOT trigger for requests to generate actual scraper code (use generate-scraper or generate-crawler-scraper instead).
version: 1.0.0
---

# Generate Data Schema Skill

Build a **data-extraction schema JSON** that the ScrapeOps Go backend accepts via `schema_json` in `scrapeops_submit_job`. The schema tells the extraction LLM and the code generator *what fields to pull from a page*. Each field has metadata: `type`, `required`, `priority_level`, `refactoring_priority`, `null_value`, plus nested `items`/`properties` for arrays/objects.

This skill has two usage modes:

1. **Standalone** — user asks "create a schema for X". Skill collects inputs, emits `schema.json`, and shows it.
2. **Programmatic** — another skill invokes this one passing `target_page_type`, `user_description`, `output_path`. Skill builds the schema silently and writes to the path.

---

## Inputs

| Slot | Required | Notes |
|------|----------|-------|
| `target_page_type` | Yes | One of the known presets. Drives the starting template. See list below. |
| `user_description` | Yes | Free-form text describing what to extract. E.g. *"only product URLs and pagination"*, *"product details with reviews and specs"*. |
| `output_path` | Yes (programmatic) | File path to write the schema to. When invoked standalone, ask the user or default to `./schema.json`. |

### Known presets (`target_page_type`)

- `product_crawler` — slim schema for a **listing/search/category** page. Extracts `products[].url` + `pagination.nextPageUrl`. Use this for crawlers.
- `product` — full schema for a **product detail page**. Extracts name, price, brand, images, reviews, specifications, features, availability, etc.

Preset files live in `presets/` relative to this SKILL.md (sibling directory).

---

## Step 1 — Resolve inputs

- If args were passed programmatically (via Skill tool), use them directly.
- If invoked standalone and something is missing:
  - `target_page_type`: ask via `AskUserQuestion` with options from "Known presets" above.
  - `user_description`: ask `"Describe what you want to extract (e.g. product URLs + pagination; or name, price, reviews, images)"`.
  - `output_path`: ask or default to `./schema.json`.

---

## Step 2 — Load the preset

Read the preset JSON from `<skill-dir>/presets/<target_page_type>.json`. Use the **Read** tool. The preset is already in the exact Go format — this is the starting point.

If the preset doesn't exist for the given `target_page_type`, stop and report: *"No preset available for '<X>'. Supported presets: product_crawler, product."*

---

## Step 3 — Customize based on `user_description`

Apply the user's intent to the preset. Examples:

- If `user_description` says *"only URLs and pagination"* (or similar minimal intent) and the preset is `product_crawler` → keep as-is, maybe drop `products[].name` (optional anyway).
- If `user_description` says *"also want stock and rating"* and the preset is `product` → ensure `availability` and `rating` are present.
- If `user_description` mentions fields **not in the preset** (e.g. *"gift-wrapping option"*), add them with sensible defaults:
  ```json
  "giftWrapAvailable": {
    "description": "Whether the product supports gift wrapping at checkout",
    "type": "boolean",
    "required": false,
    "priority_level": "low",
    "null_value": false
  }
  ```
- If `user_description` says to **remove** some fields (*"no reviews"*), delete them from the preset.

Don't over-engineer. The LLM will figure out sensible additions; only add fields the user explicitly asked for or that the preset clearly lacks for the stated use case.

### Shape every field correctly

Every top-level property must have:
- `description` (human-readable; the extraction LLM reads this)
- `type`: `"string"`, `"number"`, `"boolean"`, `"object"`, or `"array"` (note: some existing schemas use `"list"` as a synonym for `"array"` — prefer `"array"` for new fields)
- `required`: `true` or `false`
- `priority_level`: `"critical"` | `"high"` | `"medium"` | `"low"` (affects which fields the Go backend's validation + refactoring loop prioritizes)
- `refactoring_priority`: `true` (add for anything important — the backend uses this to re-run the fix loop if the field is missing from output)
- `null_value`: type-appropriate default (`""` for string, `0` for number, `false` for boolean, `[]` for array, `null` or `{}` for object)

For arrays: include `items: { type, properties }`.
For objects: include `properties: { ... }`.

---

## Step 4 — Validate

Quick self-checks before writing:
1. Every top-level key has a `type`.
2. `required` is present on every field (bool).
3. Arrays have `items`; objects have `properties`.
4. For `product_crawler`: `products[].url` must be `required: true` and `priority_level: "critical"`.
5. For `product`: at least `name` and `url` must be `required: true, priority_level: "critical"`.

If any check fails, fix in place. Never emit an invalid schema.

---

## Step 5 — Write and report

Write the customized schema to `output_path` using the **Write** tool. Then:

- **Programmatic mode** (args came in): emit a one-line text response: `Schema written to <output_path> (<N> top-level fields).` Nothing else.
- **Standalone mode**: show the path, the field count, and a short summary table:
  ```
  ✓ Schema written: ./schema.json (7 top-level fields)

  Fields: products[url, productId, name], pagination[currentPage, nextPageUrl, hasNextPage], searchMetadata
  ```

---

## Notes

- The schema you emit will be sent as `schema_json` in a `scrapeops_submit_job` call (by the caller). The Go backend uploads it to Digital Ocean Spaces and treats it as a "dynamic schema" — bypassing the built-in `dataSchema/*.json` files.
- Don't embed example **values** in the schema — this is a schema, not sample data. Only field definitions.
- Keep schemas reasonably sized. A product detail schema with ~15–25 top-level fields is normal. If you find yourself adding 40+ fields, the user probably asked for too much — ask them to prioritize.
- Don't ask permission to write the schema in programmatic mode — just do it and report.
