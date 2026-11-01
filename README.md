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

## ⌘K command palette (search + "Ask my profile")

A chatbot window (robot icon, bottom right) answers questions about the profile on Cloudflare Workers AI, **only** about the profile (guardrails filter everything else). ⌘K / Ctrl K opens in-browser semantic search over the CV, projects, posts and publications.

```
node scripts/build-kb.mjs        # rebuild assets/data/kb.json after editing content
cd workers/ask && npm test       # Worker + guardrail tests
```

Setup, architecture, guardrails and tuning: [docs/command-palette.md](docs/command-palette.md).
