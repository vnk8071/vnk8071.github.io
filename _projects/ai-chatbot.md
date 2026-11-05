---
title: 'E2E AI Chatbot: RAG from data to a deployable service'
collection: projects
date: 2023-05-05
card_title: E2E-AI-Chatbot
tagline: 'An end-to-end AI chatbot: retrieval-augmented generation wired from data to a deployable service.'
summary: Ingestion, embeddings, retrieval and a serving layer in one repository.
role: Author
stack: Python, RAG
result: Runs locally and deploys as a small service; the source is on GitHub.
repo: https://github.com/vnk8071/E2E-AI-Chatbot
description: E2E-AI-Chatbot is an end-to-end chatbot that wires retrieval-augmented generation from data ingestion and embeddings to a deployable serving layer.
cover_alt: Chat interface of the Company Brain Assistant, a Cloudflare sub-project of the E2E-AI-Chatbot repository
featured: false
cover: /assets/projects/ai-chatbot.webp
image: /assets/projects/ai-chatbot-og.jpg
image_alt: Chat interface of the Company Brain Assistant, a Cloudflare sub-project of the E2E-AI-Chatbot repository
last_modified_at: 2026-11-05
---
# E2E-AI-Chatbot 🤖

[**Pipeline**](#pipeline) | [**Installation**](#installation-requirements) | [**User Interface**](#user-interface-app) | [**Model**](#model) | [**Database**](#database) | [**Search**](#search) | [**Contact**](#contact)


[![Flake8 lint](https://github.com/vnk8071/E2E-AI-Chatbot/actions/workflows/lint.yml/badge.svg)](https://github.com/vnk8071/E2E-AI-Chatbot/actions/workflows/lint.yml)
[![Stargazers][stars-shield]][stars-url]
[![MIT License][license-shield]][license-url]
[![LinkedIn][linkedin-shield]][linkedin-url]

## Pipeline
### Current:
<img src="https://user-images.githubusercontent.com/78080480/241518928-57c61fef-f4fb-4c17-a095-4748d79c3b87.png" alt="Current RAG chatbot pipeline diagram" loading="lazy">

### Next stage:
- [x] FastAPI & Gradio backend
- [x] Dockerize packages
- [x] Add UI ingest upload file
- [ ] Add login page
- [ ] Add docs
- [ ] Nginx for http and https
- [ ] K8s
- [ ] CI/CD cloud (AWS/Azure)

## Installation Requirements
- Minimum CPU 8GiB RAM
- Uncomment line 8 packages = [{include = "**"}] to use all internal packages (Passing Flake8)
- Install packages and download GPT4All model by
1. Run locally
```bash
chmod u+x ./setup.sh
bash ./setup.sh
```
- Build MongoDB, Mongo Express, Logstash, Elasticsearch and Kibana
```
docker compose -f docker-compose-service.yml up
poetry run python app.py --host 0.0.0.0 --port 8071
```
2. Run docker
```
docker compose up
```
## User Interface App
```
poetry run python app.py --host 0.0.0.0 --port 8071
```
Run on: http://localhost:8071

1. Chatbot:
<img src="https://user-images.githubusercontent.com/78080480/241147184-0c3bea3e-e19f-4532-863d-d5ddd112dea6.png" alt="Chatbot web interface answering a question" loading="lazy">

2. Ingest PDF:
<img src="https://user-images.githubusercontent.com/78080480/241676731-aabdcdfe-fda6-475c-8306-b57e5f4e4b54.png" alt="Ingest PDF page of the chatbot interface" loading="lazy">

<p align="right">(<a href="#e2e-ai-chatbot-">back to top</a>)</p>

## Model
1. GPT4ALL: Current best commercially licensable model based on GPT-J and trained by Nomic AI on the latest curated GPT4All dataset.

## Database
1. MongoDB
Run on: http://localhost:27017
```
poetry run python src/ingest_database.py --mongodb-host "mongodb://localhost:27017/" --data-path "static/pdf/"
```
### Mongo Compass (Windows)
<img src="https://user-images.githubusercontent.com/78080480/240465436-6cd732a7-bfd7-41ea-8da5-f7d9e36908fc.png" alt="MongoDB Compass showing the ingested collection" loading="lazy">

### Mongo Express
Run on: http://localhost:8081
<img src="https://user-images.githubusercontent.com/78080480/241128094-d9b4469b-9a1e-4b7f-a0fd-1037a1bdeda5.png" alt="Mongo Express browsing the chatbot database" loading="lazy">

## Data Migration
Run on: http://localhost:9600

<img src="https://user-images.githubusercontent.com/78080480/241519101-e22b955d-b072-4362-acb3-fe7ad8e7a746.png" alt="Data migration service dashboard" loading="lazy">

## Search
1. Elasticsearch & Kibana
```
poetry run python src/ingest_search.py --mongodb-host "mongodb://localhost:27017/" --es-host "http://localhost:9200/" --index_name "document"
```
Elasticsearch run on: http://localhost:9200

Kibana run on: http://localhost:5601
<img src="https://user-images.githubusercontent.com/78080480/240532984-f66cc3c3-a20b-4d93-a421-8553cec5dc46.png" alt="Kibana dashboard on top of Elasticsearch" loading="lazy">

## Contact
- KhoiVN - [@linkedin-khoivn8071](https://www.linkedin.com/in/khoivn8071) - nguyenkhoi8071@gmail.com
- Project Link: [Github-E2E-AI-Chatbot](https://github.com/vnk8071/E2E-AI-Chatbot)
- Website: [khoispace.io.vn](https://khoispace.io.vn)
## Impressive
- From Langchain Framework: https://github.com/hwchase17/langchain
- From GPT4All: https://github.com/nomic-ai/gpt4all
<p align="right">(<a href="#e2e-ai-chatbot-">back to top</a>)</p>

[stars-shield]: https://img.shields.io/github/stars/vnk8071/E2E-AI-Chatbot.svg?style=badge
[stars-url]: https://github.com/vnk8071/E2E-AI-Chatbot/stargazers
[license-shield]: https://img.shields.io/github/license/vnk8071/E2E-AI-Chatbot.svg?style=badge
[license-url]: https://github.com/vnk8071/E2e-AI-Chatbot/blob/master/LICENSE.txt
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=badge&logo=linkedin&colorB=555
[linkedin-url]: https://linkedin.com/in/khoivn8071