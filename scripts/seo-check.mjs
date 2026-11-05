#!/usr/bin/env node
// SEO guardrails for the static site. Checks follow the claude-seo checklists
// (technical, page, schema, sitemap, images): metadata, canonicals, headings, Open Graph, JSON-LD, images,
// internal links + anchors, sitemap coverage, robots.
//
//   node scripts/seo-check.mjs public [--base https://khoispace.io.vn]
//
// Exit code 1 when there is at least one ERROR; warnings are reported but never fail.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, extname, relative } from "node:path";
import { parse } from "node-html-parser";

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "public");
const baseIdx = args.indexOf("--base");
const BASE = (baseIdx >= 0 ? args[baseIdx + 1] : "https://khoispace.io.vn").replace(/\/$/, "");

export function auditSite(siteDir, base = BASE) {
  const errors = [];
  const warnings = [];
  const E = (page, msg) => errors.push(`${page}: ${msg}`);
  const W = (page, msg) => warnings.push(`${page}: ${msg}`);

  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? (f === "assets" ? [] : walk(p)) : extname(f) === ".html" ? [p] : [];
  });
  const urlOf = (file) => "/" + relative(siteDir, file).replace(/index\.html$/, "").replace(/\\/g, "/");
  const fileOfUrl = (u) => {
    const clean = decodeURIComponent(u.split("#")[0].split("?")[0]);
    for (const c of [clean, clean.replace(/\/$/, "") + "/index.html", clean + ".html", clean + "/index.html"]) {
      const p = join(siteDir, c);
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
    return null;
  };

  const pages = new Map(); // url -> { root, noindex, redirect }
  for (const f of walk(siteDir)) {
    const html = readFileSync(f, "utf8");
    const root = parse(html);
    const robots = root.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
    const redirect = /http-equiv=["']refresh["']/i.test(html);
    pages.set(urlOf(f), { file: f, root, html, noindex: /noindex/i.test(robots), redirect });
  }

  const titles = new Map();
  const descs = new Map();
  const wordCount = (root) => {
    const body = parse(root.toString()).querySelector("body");
    body?.querySelectorAll("script,style,svg,noscript").forEach((n) => n.remove());
    return (body?.text ?? "").split(/\s+/).filter(Boolean).length;
  };

  for (const [url, p] of pages) {
    if (p.redirect) continue;
    const { root } = p;
    const meta = (sel, attr = "content") => root.querySelector(sel)?.getAttribute(attr)?.trim() ?? "";

    // ---- metadata
    const title = root.querySelector("title")?.text.trim() ?? "";
    const desc = meta('meta[name="description"]');
    if (!title) E(url, "missing <title>");
    else {
      if (title.length > 60) W(url, `title is ${title.length} chars (aim for <= 60)`);
      if (title.length < 20) W(url, `title is only ${title.length} chars`);
      if (!p.noindex) titles.set(title, [...(titles.get(title) ?? []), url]);
    }
    if (!desc) E(url, "missing meta description");
    else {
      if (desc.length > 160 || desc.length < 100) W(url, `description is ${desc.length} chars (aim for 120-160)`);
      if (!p.noindex) descs.set(desc, [...(descs.get(desc) ?? []), url]);
    }
    if (!root.querySelector("html")?.getAttribute("lang")) E(url, "missing <html lang>");
    if (!root.querySelector('meta[name="viewport"]')) E(url, "missing viewport meta");

    // ---- indexing
    const canonical = meta('link[rel="canonical"]', "href");
    if (!p.noindex) {
      if (!canonical) E(url, "missing canonical");
      else if (canonical !== base + url) E(url, `canonical is ${canonical}, expected ${base + url}`);
    } else if (url !== "/404.html") {
      W(url, "page is noindex");
    }
    if (url === "/404.html" && !p.noindex) E(url, "404 page must be noindex");

    // ---- open graph / twitter
    if (!p.noindex) {
      for (const prop of ["og:title", "og:description", "og:image", "og:url", "og:type"]) {
        if (!meta(`meta[property="${prop}"]`)) E(url, `missing ${prop}`);
      }
      for (const name of ["twitter:card", "twitter:title", "twitter:image"]) {
        if (!meta(`meta[name="${name}"]`)) E(url, `missing ${name}`);
      }
      if (meta('meta[property="og:url"]') && meta('meta[property="og:url"]') !== canonical) E(url, "og:url differs from canonical");
      const og = meta('meta[property="og:image"]');
      if (og) {
        if (!og.startsWith("https://")) E(url, `og:image must be an absolute https URL (${og})`);
        else if (og.startsWith(base) && !fileOfUrl(og.slice(base.length))) E(url, `og:image file not found (${og})`);
      }
    }

    // ---- headings
    const heads = root.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading][aria-level]")
      .map((h) => ({ lvl: h.getAttribute("aria-level") ? +h.getAttribute("aria-level") : +h.tagName[1], text: h.text.replace(/\s+/g, " ").trim() }));
    const h1s = heads.filter((h) => h.lvl === 1);
    if (!p.noindex && h1s.length !== 1) E(url, `expected exactly one H1, found ${h1s.length}`);
    for (let i = 1; i < heads.length; i++) if (heads[i].lvl - heads[i - 1].lvl > 1 && !p.noindex) { W(url, `heading level skips from h${heads[i - 1].lvl} to h${heads[i].lvl} ("${heads[i].text.slice(0, 40)}")`); break; }

    // ---- structured data
    for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.text); } catch (e) { E(url, `JSON-LD does not parse: ${e.message}`); continue; }
      if (!data["@context"]) E(url, "JSON-LD without @context");
      const walkLd = (v, key = "") => {
        if (Array.isArray(v)) return v.forEach((x) => walkLd(x, key));
        if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => walkLd(x, k));
        if (typeof v === "string") {
          if (/^(undefined|NaN|null)$/i.test(v.trim()) || v.includes("{{")) E(url, `JSON-LD has a placeholder value for ${key}: "${v}"`);
          if (["url", "image", "@id", "item", "codeRepository", "sameAs"].includes(key) && v.startsWith("/")) E(url, `JSON-LD ${key} must be absolute: ${v}`);
        }
      };
      walkLd(data);
      const types = JSON.stringify(data).match(/"@type":"([A-Za-z]+)"/g) ?? [];
      if (types.some((t) => /HowTo|FAQPage/.test(t))) W(url, "HowTo/FAQPage schema no longer gives rich results");
    }

    // ---- images
    root.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      if (img.getAttribute("alt") === undefined) E(url, `image without alt attribute: ${src.slice(0, 70)}`);
      if (!img.getAttribute("width") || !img.getAttribute("height") || /^auto$/i.test(img.getAttribute("width") ?? "")) {
        if (!/^https?:\/\//.test(src) || src.startsWith(base)) W(url, `local image without width/height (CLS): ${src.slice(0, 60)}`);
      }
      if (src.startsWith("/") && !/\.(svg)$/.test(src)) {
        const f = fileOfUrl(src.split("?")[0]);
        if (!f) E(url, `image file not found: ${src}`);
        else if (statSync(f).size > 250 * 1024) W(url, `image over 250 KB (${Math.round(statSync(f).size / 1024)} KB): ${src}`);
      }
    });

    // ---- links
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href").trim();
      if (/^(mailto:|tel:|javascript:)/i.test(href) || href === "#" ) return;
      if (a.getAttribute("target") === "_blank" && !/noopener/.test(a.getAttribute("rel") ?? "")) W(url, `target=_blank without rel=noopener: ${href.slice(0, 60)}`);
      if (/^http:\/\//i.test(href) && !href.startsWith("http://localhost")) W(url, `insecure http link: ${href.slice(0, 70)}`);
      let target = null;
      if (href.startsWith("#")) target = { url, hash: href.slice(1) };
      else if (href.startsWith("/")) target = { url: href.split("#")[0], hash: href.split("#")[1] };
      else if (href.startsWith(base)) { const r = href.slice(base.length); target = { url: r.split("#")[0] || "/", hash: r.split("#")[1] }; }
      if (!target) return;
      const tf = target.url === url ? p.file : fileOfUrl(target.url);
      if (!tf) { E(url, `broken internal link: ${href}`); return; }
      if (target.hash && !/^(privacy)$/.test(target.hash)) {
        const html = target.url === url ? p.html : readFileSync(tf, "utf8");
        if (!new RegExp(`\\bid=["']${target.hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(html)) E(url, `broken anchor: ${href}`);
      }
    });

    // ---- mixed content
    root.querySelectorAll("[src],link[href]").forEach((n) => {
      const v = n.getAttribute("src") ?? n.getAttribute("href") ?? "";
      if (/^http:\/\//i.test(v) && n.tagName !== "A") E(url, `mixed content: ${v.slice(0, 70)}`);
    });

    if (!p.noindex && wordCount(root) < 150) W(url, `thin page: ${wordCount(root)} words`);
  }

  for (const [t, us] of titles) if (us.length > 1) E(us[0], `duplicate title shared with ${us.slice(1).join(", ")}: "${t.slice(0, 50)}"`);
  for (const [d, us] of descs) if (us.length > 1) E(us[0], `duplicate description shared with ${us.slice(1).join(", ")}`);

  // ---- sitemap + robots
  const smPath = join(siteDir, "sitemap.xml");
  if (!existsSync(smPath)) E("/sitemap.xml", "missing");
  else {
    const xml = readFileSync(smPath, "utf8");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const inSitemap = new Set();
    for (const loc of locs) {
      if (!loc.startsWith(base)) { E("/sitemap.xml", `URL on another host: ${loc}`); continue; }
      const path = loc.slice(base.length) || "/";
      inSitemap.add(path);
      const pg = pages.get(path);
      if (!pg && !fileOfUrl(path)) E("/sitemap.xml", `lists a URL that does not exist: ${loc}`);
      else if (pg?.noindex) E("/sitemap.xml", `lists a noindex page: ${loc}`);
      else if (pg?.redirect) E("/sitemap.xml", `lists a redirect: ${loc}`);
    }
    for (const m of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
      const t = Date.parse(m[1]);
      if (Number.isNaN(t)) E("/sitemap.xml", `invalid lastmod: ${m[1]}`);
      else if (t > Date.now() + 864e5) E("/sitemap.xml", `lastmod in the future: ${m[1]}`);
    }
    for (const [url, p] of pages) {
      if (p.noindex || p.redirect) continue;
      if (!inSitemap.has(url)) E(url, "indexable page missing from sitemap.xml");
    }
  }
  const rb = join(siteDir, "robots.txt");
  if (!existsSync(rb)) E("/robots.txt", "missing");
  else {
    const r = readFileSync(rb, "utf8");
    if (!/^Sitemap:\s*https:\/\//im.test(r)) E("/robots.txt", "no Sitemap line");
    if (/^Disallow:\s*\/\s*$/im.test(r)) E("/robots.txt", "disallows the whole site");
  }

  return { errors, warnings, pages: pages.size };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (!existsSync(dir)) { console.error(`no such directory: ${dir}`); process.exit(2); }
  const { errors, warnings, pages } = auditSite(dir);
  console.log(`SEO check: ${pages} HTML files in ${dir}`);
  for (const w of warnings) console.log("  warn  " + w);
  for (const e of errors) console.log("  ERROR " + e);
  console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
