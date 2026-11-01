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

Press ⌘K / Ctrl K on the site: in-browser semantic search over the CV, projects, posts and publications, plus an AI assistant on Cloudflare Workers AI that answers **only** questions about the profile (guardrails filter everything else).

```
node scripts/build-kb.mjs        # rebuild assets/data/kb.json after editing content
cd workers/ask && npm test       # Worker + guardrail tests
```

Setup, architecture, guardrails and tuning: [docs/command-palette.md](docs/command-palette.md).
