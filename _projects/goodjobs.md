---
title: "GoodJobs — Job Aggregator"
collection: projects
permalink: /goodjobs/
excerpt: "18 job boards, one query — real-time streaming with LLM intent detection<br/><br/>Live at <a href='https://goodjobs.io.vn'>goodjobs.io.vn</a>"
date: 2026-08-30
---

# GoodJobs 🧭

[**Live**](https://goodjobs.io.vn) | [**Repo**](https://github.com/vnk8071/goodjobs)

A self-hosted job aggregator that scrapes listings from 18 job boards across
Vietnam and global markets (US, UK, Singapore) and streams the results back in
real time. Search by job title or paste a CV — results are deduplicated, cached,
and ranked with vector similarity.

## Highlights
- Real-time SSE streaming of job results — "18 sources, one query"
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
