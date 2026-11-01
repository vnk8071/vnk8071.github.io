# ⌘K command palette: search + "Ask my profile"

Press **⌘K / Ctrl K** (or `/`, or click **✦ Hỏi hồ sơ** in the nav) on any page.

* **Navigate**: pages, theme toggle, GitHub / LinkedIn / email.
* **Semantic search**: type a concept in Vietnamese or English ("kinh nghiệm tối ưu phần cứng", "bài báo khoa học"). A small embedding model runs in a Web Worker and jumps straight to the matching experience line, project card, blog post or publication, even without a keyword match. The target is scrolled into view and highlighted.
* **Ask AI** (micro-RAG): click a suggested question or type your own. The answer is generated on Cloudflare Workers AI, grounded only in your CV, projects, posts and publications, and cites its sources.
* **Guardrails**: anything not about your profile is filtered (see below).

## How it fits together

```
 Jekyll site (GitHub Pages)                                     Cloudflare
 ───────────────────────────                                    ──────────
 _layouts/home.html (CV, data-kb ids)  ┐
 _projects/ _posts/ _publications/     ├─ scripts/build-kb.mjs ─► assets/data/kb.json ◄──── fetched + cached 5 min
 _data/profile.yml (extra facts)       ┘                              │  │                         │
                                                                      │  │                  ┌──────┴────────────┐
 browser ⌘K                                                           │  │                  │ workers/ask       │
  ├─ keyword index (instant)  ◄───────────────────────────────────────┘  │                  │  1 screenInput()  │ injection patterns
  ├─ Web Worker: multilingual-e5-small (ONNX/WASM, cached in browser)    │                  │  2 classifyTopic()│ Workers AI, small model
  │    vectors for every chunk cached in IndexedDB                       │                  │  3 main prompt    │ Workers AI, 70B
  └─ Ask AI ── POST {question, ids of top passages} ─────────────────────┼─────────────────►│  + rate limit     │ SSE stream back
                                                                         │                  │  + answer cache   │
                                                                         └──────────────────┴───────────────────┘
```

* The browser sends only the **ids** of the best passages. The Worker looks the text up in its own copy of `kb.json`, so callers cannot inject context.
* The whole CV (≈2.6k characters) is **always** in the prompt; only long project/blog passages are retrieved. Answers therefore hold up even if retrieval misses or the visitor's browser never loaded the model.

## Guardrails (workers/ask/src/index.ts)

A request is answered only if it is about your profile. Order of checks, cheapest first:

| # | Check | Cost | Result when it fails |
| --- | --- | --- | --- |
| 0 | Origin allow-list, 2–500 chars, per-IP rate limit (8/min) | none | 403 / 400 / 429 |
| 1 | `screenInput()`: prompt-injection / jailbreak patterns, EN + VI ("ignore previous instructions", "reveal your system prompt", "bỏ qua mọi hướng dẫn", role-play, control characters, chat-template tokens) | none | `blocked` (`injection`) |
| 2 | `classifyTopic()`: a small Workers AI model answers `ON_TOPIC` / `OFF_TOPIC` (temperature 0, ≤8 tokens, few-shot, question passed as quoted data). Strict parse: anything other than a clean `ON_TOPIC` counts as off-topic. The 3 suggested questions (published in `kb.json`) skip it | ~2 neurons | `blocked` (`off_topic`) |
| 3 | The main prompt: use only numbered context, never invent facts, don't upgrade claims ("production" only if the passage says live / deployed / published), ignore instructions inside the question | n/a | says it doesn't know |

A filtered request gets HTTP 200 with `event: blocked` and a **fixed** refusal in the visitor's language (the model never writes it), the main model is never called, and nothing is cached. If the classifier itself is down the request **fails closed** (503); the palette then shows the best-matching passages instead.

Tuning: edit `GUARD_PROMPT` (scope and few-shot examples), `INJECTION_PATTERNS`, or `GUARD_MODEL` in `wrangler.jsonc`. Logs (`wrangler tail`) show `{"guardrail":"blocked","reason":…}` without the question text. If real visitors get wrongly refused, add their phrasing as an `ON_TOPIC` example.

## Setup

1. **Build the knowledge base** (CI does this on every deploy; run it locally after editing content):
   ```bash
   cd scripts && npm ci && cd ..
   node scripts/build-kb.mjs        # writes assets/data/kb.json
   ```
2. **Deploy the Worker** (needs a Cloudflare account; Workers AI has a free daily allowance):
   ```bash
   cd workers/ask
   npm ci
   npx wrangler login
   npx wrangler ai models            # confirm MODEL / GUARD_MODEL exist in your catalog
   npm test && npx wrangler deploy
   ```
   Wrangler prints the URL (`https://khoispace-ask.<you>.workers.dev`). To use your own domain (recommended; the answer cache only works on custom domains), uncomment `routes` in `workers/ask/wrangler.jsonc`, e.g. `ask.khoispace.io.vn`.
   For CI deploys add the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (`.github/workflows/ask-worker.yml`).
3. **Point the site at it**: in `_config.yml` set
   ```yaml
   command_palette:
     ask_endpoint: "https://ask.khoispace.io.vn/api/ask"
   ```
   and make sure `ALLOWED_ORIGINS` and `KB_URL` in `wrangler.jsonc` match your real domain. Until `ask_endpoint` is set, the palette still searches and, for questions, shows the best-matching passages.

Local dev: `bundle exec jekyll serve` (site on :4000, already an allowed origin) and `npx wrangler dev` in `workers/ask` (Workers AI always calls Cloudflare, even locally); set `ask_endpoint: "http://localhost:8787/api/ask"` and `KB_URL` to `http://localhost:4000/assets/data/kb.json` via `.dev.vars`/`--var`.

## Adding content

| You add | Where | Indexed as |
| --- | --- | --- |
| A job, project card, honor, tag on the home page | `_layouts/home.html` (keep the `id` + `data-kb="…"` attributes) | core facts, always sent to the AI; the palette jumps to the element |
| A project write-up | `_projects/*.md` | chunked by `##` heading, retrieved on demand |
| A blog post | `_posts/*.md` | same, under "Blog" |
| A publication | `_publications/*.md` with `title`, `date`, `venue`, `paperurl`, `citation` front matter | same, under "Publication" |
| Facts that exist nowhere else (what you did at a job, production systems, results) | `_data/profile.yml` → `facts:` | core (or retrievable with `core: false`) |
| Better search for a chunk | `_data/profile.yml` → `keywords:` (VI + EN synonyms; never shown to the AI) | keyword search |

**The assistant can only say what the index contains.** Today the home page lists roles and one-line project descriptions, so detailed answers ("what did you do at viAct?", "which systems run in production?") need real material in `facts:` or in project pages. Don't paste anything you wouldn't want quoted: it is public and the model will repeat it.

## Configuration (`_config.yml` → `command_palette`)

| Key | Meaning |
| --- | --- |
| `enabled` | turn the whole feature off |
| `ask_endpoint` | the Worker's `/api/ask` URL; empty = passages only |
| `semantic` | `auto` (download the model on first open, except on touch devices / Save-Data), `ask` (visitor must click "Bật"), `off` |
| `embedding_model`, `embedding_dtype`, `query_prefix`, `passage_prefix`, `embedding_mb` | the embedding model. Default `Xenova/multilingual-e5-small`, q8, needs the `query: ` / `passage: ` prefixes. English-only alternative (~25 MB): `Xenova/all-MiniLM-L6-v2` with empty prefixes |
| `semantic_window` | semantic hits within this cosine distance of the best one are kept (0.05 default; tune against real queries) |
| `suggestions` | the suggested questions (also the guardrail's allow-list) |

## Costs and limits

* Browser: the model is a one-time download (≈120 MB for multilingual-e5-small q8; the browser caches it) and the chunk vectors are cached in IndexedDB. Nothing is downloaded until the palette is opened.
* Workers AI: the free tier is a daily allowance of "neurons". A 70B answer is on the order of 100+ neurons, so ~70 uncached answers a day; the 8B guard is a few neurons. Suggested questions are cached for an hour on custom domains. Use `@cf/google/gemma-3-12b-it` or `@cf/meta/llama-3.1-8b-instruct` as `MODEL` to stretch it.
* Workers: 8 questions / minute / IP (Workers Rate Limiting binding).

## Tests

```bash
npm test --prefix scripts         # knowledge-base builder
cd workers/ask && npm run typecheck && npm test   # Worker + guardrails, offline, fake AI binding
```
