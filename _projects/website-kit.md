---
title: "Website Kit — PoC starter kit"
collection: projects
permalink: /website-kit/
excerpt: "Four independent modules — Cloudflare, GitHub Pages, WordPress and Apps Script — and one command that scaffolds a proof-of-concept website into a fresh repo"
date: 2026-11-01
---

# Website Kit 🧰

[**Repo**](https://github.com/vnk8071/website-kit)

A starter kit for spinning up a proof-of-concept website with minimal setup. It has four
modules; each is fully independent, so you use one or any combination and nothing in one
module imports, links to or requires another.

```
scripts/new-poc.sh github-pages/astro my-poc     # static site
scripts/new-poc.sh cloudflare         my-poc     # edge / infra / Workers
scripts/new-poc.sh wordpress          my-poc     # CMS
scripts/new-poc.sh apps-script        my-poc     # Google Sheets / Gmail automation
```

The script copies **one** module into a fresh directory, installs its CI templates as
`.github/workflows/` and makes the first commit. The result has no connection back to the kit.

## Modules
- **Cloudflare** — Terraform for DNS, zone security, Pages, Workers resources (KV, D1, R2), WAF, Tunnel, Access, Turnstile and Email Routing, each behind an `enable_*` flag; nine runnable Worker examples (REST API over D1 + KV + R2, cron to queue, Turnstile contact form, Workers AI, Durable Objects, an email-server mailbox and more); a Pages site with Functions; CI templates.
- **GitHub Pages** — six deployable templates (plain HTML, Jekyll, Hugo, Astro, Vite + React, MkDocs). Each folder is a complete repo with its own workflow.
- **WordPress** — a Docker stack (WordPress, MariaDB, Mailpit), a one-command WP-CLI bootstrap, a block theme, a core plugin, a hardening mu-plugin, deploy workflows and a static export.
- **Apps Script** — four `clasp` projects: a Sheets-backed JSON API, a contact-form backend, a web app UI and a scheduled email digest, with a test harness that runs against fakes of the Google services.

## Highlights
- Pick-the-platform guidance: which module fits which kind of site, what each costs on free tiers, and how they combine (for example a GitHub Pages site on a Cloudflare-managed domain, or a static front end with a Worker API)
- Agent skills in `.claude/skills/` that recommend a platform, scaffold a PoC and design its UI
- A CI workflow that validates every module independently
- Each module's README ends with an explicit "what has and has not been verified" section
- Used as the reference for the Cloudflare Worker behind the chatbot on this site

## Tech stack
- **Infrastructure:** Terraform (Cloudflare provider), Wrangler
- **Edge:** Cloudflare Workers, Pages Functions, D1, KV, R2, Queues, Durable Objects, Workers AI
- **Sites:** Jekyll, Hugo, Astro, Vite + React, MkDocs, WordPress (PHP, Docker)
- **Automation:** Google Apps Script (`clasp`), GitHub Actions
