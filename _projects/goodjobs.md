---
title: 'goodjobs.io.vn: job aggregator across 21 sources'
collection: projects
permalink: /goodjobs/
date: 2026-08-30
card_title: goodjobs.io.vn
tagline: 'A self-hosted job aggregator across 21 sources: one query, real-time results and recommendations that understand the role.'
summary: 21 sources searched at once, with real-time SSE streaming, LLM intent detection and vector recommendations.
role: Design, backend, frontend
stack: FastAPI, TypeScript, Redis
result: The site runs at goodjobs.io.vn; the source is on GitHub.
live: https://goodjobs.io.vn
repo: https://github.com/vnk8071/goodjobs
description: goodjobs.io.vn is a self-hosted job aggregator that searches 21 job sources at once with real-time streaming, LLM intent detection and vector recommendations.
cover_alt: 'Good Jobs: find your next job in Vietnam and beyond, one search across LinkedIn, ITviec, TopCV, VietnamWorks, CareerViet and RemoteOK'
featured: true
cover: /assets/projects/goodjobs.webp
image: /assets/projects/goodjobs-og.jpg
image_alt: 'Good Jobs: find your next job in Vietnam and beyond, one search across LinkedIn, ITviec, TopCV, VietnamWorks, CareerViet and RemoteOK'
last_modified_at: 2026-11-05
---
# GoodJobs 🧭

[**Live**](https://goodjobs.io.vn) | [**Repo**](https://github.com/vnk8071/goodjobs)

A self-hosted job aggregator that scrapes listings from 21 sources across
Vietnam and global markets (US, UK, Singapore) and streams the results back in
real time. Search by job title or paste a CV — results are deduplicated, cached,
and ranked with vector similarity.

## Highlights
- Real-time SSE streaming of job results — "21 sources, one query"
- LLM-powered intent detection and city normalization
- Vector-based related-job recommendations
- Auto-extracted tech skill tags
- Self-warming cache (~30 keyword pairs every 2 hours)
- Fair concurrency control with semaphore queuing

## Tech stack
- **Backend:** FastAPI (Python), Redis caching, embeddings for vector search
- **Frontend:** TypeScript
- **Scraping:** Playwright / Chromium
- **Infra:** Docker Compose

## Contact
- Gmail: [nguyenkhoi8071@gmail.com](mailto:nguyenkhoi8071@gmail.com)
- Website: [khoispace.io.vn](https://khoispace.io.vn/)
- GitHub: [github.com/vnk8071](https://github.com/vnk8071)
