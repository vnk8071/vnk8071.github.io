# vnk8071.github.io

## Setup Ruby
https://mac.install.guide/ruby/13.html

## Run locally
```
bundle add webrick
bundle install
bundle exec jekyll serve
```

## Platform
```x86_64-darwin-19```

## Site architecture (Olivia / Webflow template)

The design is the "Olivia" Webflow template, rebuilt as static HTML and driven by Jekyll data:

- `_data/cv.yml` is the single source of truth for the home and about pages (roles, honours, skills, links). `_data/olivia.yml` holds Webflow page ids; `_data/navigation.yml` the menu.
- `_layouts/olivia.html` is the base layout (SEO tags in `_includes/olivia/seo.html`); `_projects/*.md` render through `_layouts/project.html`, the list through `projects.html`.
- Images for each project live in `assets/projects/` (WebP + 1200x630 OG JPG).
- The Webflow runtime loads from its CDN. If it does not load within 2.5 s, `html.wf-fallback` shows the content without animations.
- The footer credits "Made with Webflow".

```
node scripts/seo-check.mjs _site    # SEO guardrails on the built site (also runs in CI; errors fail the deploy)
cd scripts && npm test              # knowledge-base builder + SEO check tests
```

## ⌘K command palette (search + "Ask my profile")

A chatbot window (robot icon, bottom right) answers questions about the profile on Cloudflare Workers AI, **only** about the profile (guardrails filter everything else). ⌘K / Ctrl K opens in-browser semantic search over the CV, projects, posts and publications.

```
node scripts/build-kb.mjs        # rebuild assets/data/kb.json after editing content
cd workers/ask && npm test       # Worker + guardrail tests
```

Setup, architecture, guardrails and tuning: [docs/command-palette.md](docs/command-palette.md).
