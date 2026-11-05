# vnk8071.github.io

Personal portfolio for **Khoi Vo Nguyen — AI Engineer**.
Live: <https://khoispace.io.vn/>

The design is the **Olivia** portfolio template (Webflow, by UI Bucket, free licence for personal use),
rebuilt as plain static HTML/CSS/JS so it can be hosted on GitHub Pages. Template credit stays with
UI Bucket; the code is not redistributed as a template.

There is no Jekyll build and no site generator: `public/` is the site.

## Local preview

```bash
python3 -m http.server -d public 8000
```

Webflow's own runtime (jQuery, page-specific interaction bundles, GSAP) loads from the Webflow CDN.
The stylesheet and BDO Grotesk fonts are self-hosted in `public/assets/`. If the runtime never arrives
(CDN blocked, offline, content blocker), a small fallback removes Webflow's "hide until animated"
classes after 2.5 s so the page is still readable.

## Deploy

Push to `master` → `.github/workflows/pages.yml` rebuilds the knowledge base, runs the SEO checks and
uploads `public/` as the Pages artefact.

- Pages source: **GitHub Actions**
- Custom domain: `khoispace.io.vn` (CNAME → `vnk8071.github.io`), HTTPS enforced
- Repository is private, the Pages site is public

## Structure

```
public/index.html                        home: hero, about, projects, expertise, FAQ, CTA
public/about/                            bio, stats, experience, honours, open source, skills
public/projects/                         work index, plus three project detail pages
public/goodjobs/                         project detail (custom permalink)
public/kilomet/                          project detail (custom permalink)
public/unified-ai-runtime/               project detail (custom permalink)
public/website-kit/                      project detail (custom permalink)
public/machine-learning-learning-path/   project detail (custom permalink)
public/contact/                          email + socials + FAQ
public/privacy/                          analytics and consent disclosure
public/404.html
public/assets/site.css                   Webflow stylesheet + local overrides at the end
public/assets/css/                       Olivia overrides, palette and chat styles
public/assets/js/                        ⌘K palette, chat window, Web Worker and cmdk-config.js
public/assets/data/kb.json               knowledge base for search + chatbot
public/assets/fonts/                     BDO Grotesk (self-hosted)
public/assets/hero.webp                  blue-duotone hero photo
public/assets/about.webp                 Qualcomm portrait
public/assets/footer-gradient-blue.webp  footer glow (black → blue, with 500/800/1080w variants)
public/assets/projects/                  project covers + 1200x630 OG images
public/assets/analytics.js               consent-gated GA4 loader

content/profile.yml                      extra chatbot facts and search aliases
content/navigation.yml                   palette navigation links
scripts/build-kb.mjs                     builds public/assets/data/kb.json from the rendered pages
scripts/seo-check.mjs                    SEO guardrails (also runs in CI)
workers/ask/                             Cloudflare Worker behind "Ask my profile"
```

## Editing

- Content is plain HTML; there is no CMS and no data layer. Project cards on the home page and the work
  index are static markup, one block per project.
- The template's overrides (brand wordmark, consent banner, FAQ/CTA text, hidden Webflow badge) are at
  the end of `public/assets/site.css`.
- The blue palette lives at the top of `public/assets/css/olivia-extra.css` (`--accent`, `--accent-dim`,
  `--glow` and the near-black navy `--black`). The hero and footer are local blue-duotone assets, so
  changing the accent does not recolour the photos; regenerate those two files if the hue should move.
- Keep each page's `data-wf-page` / `data-wf-site` attributes and its page-specific `webflow.*.js`
  bundle: they select the Webflow interactions that animate that page. The home bundle differs from
  the work/detail bundle and from About/Contact; do not copy a script block between pages.
- Analytics is off until a visitor accepts. The measurement ID sits on the `analytics.js` script tag in
  every page (`data-ga-id`); empty it to disable.
- When adding pages, update `public/sitemap.xml` and `public/robots.txt`, and add the page to both
  navigation files if the palette should find it.
- After editing page content, rebuild the knowledge base and run the checks:

```bash
npm ci --prefix scripts
node scripts/build-kb.mjs          # writes public/assets/data/kb.json
node scripts/seo-check.mjs public  # errors fail; warnings are reported
cd scripts && npm test             # knowledge-base builder + SEO check tests
```

## ⌘K command palette (search + "Ask my profile")

A chatbot window (robot icon, bottom right) answers questions about the profile on Cloudflare Workers AI,
**only** about the profile (guardrails filter everything else). ⌘K / Ctrl K opens in-browser semantic
search over the CV, projects and notes.

Setup, architecture, guardrails and tuning: [docs/command-palette.md](docs/command-palette.md).
