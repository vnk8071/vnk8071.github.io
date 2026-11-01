/* Chatbot window, bottom right: ask the profile (micro-RAG on Cloudflare Workers AI).
 *
 * - Launcher = robot chatbot icon; opens a chat window (full screen on phones).
 * - Each question is sent with the ids of the best-matching passages (window.cmdk.retrieve, from palette.js);
 *   the Worker (workers/ask) answers only from the knowledge base and filters everything off-topic.
 * - The conversation is kept in sessionStorage so it survives page navigation (e.g. after clicking a source).
 * - ⌘K calls window.chatbot.ask(question) to hand a question over.
 */
(() => {
  "use strict";

  const cfgEl = document.getElementById("cmdk-config");
  if (!cfgEl) return;
  const cfg = JSON.parse(cfgEl.textContent);
  if (!cfg.chatbot) return;

  // ---- strings (edit here to translate) -------------------------------------------------------------
  const T = {
    launch: "Chat với trợ lý hồ sơ",
    launchLabel: "Hỏi trợ lý",
    title: "Trợ lý hồ sơ",
    subtitle: "Hỏi về Khoi Vo Nguyen · AI",
    welcome: "Xin chào! Mình là trợ lý AI của Khoi. Bạn có thể hỏi về kinh nghiệm, dự án, kỹ năng, học vấn, đóng góp mã nguồn mở, công bố và bài viết của Khoi.",
    tryAsking: "Thử hỏi:",
    placeholder: "Hỏi về hồ sơ của Khoi…",
    send: "Gửi",
    stop: "Dừng",
    reset: "Cuộc trò chuyện mới",
    close: "Đóng khung chat",
    note: "AI có thể nhầm lẫn. Mỗi câu hỏi được trả lời độc lập, chỉ về hồ sơ của Khoi.",
    sources: "Nguồn",
    thinking: "Đang tìm trong hồ sơ",
    stepSearch: "Đang tìm trong hồ sơ…",
    stepSearched: (n, titles) => `Tìm thấy ${n} đoạn liên quan: ${titles}`,
    stepSearchedNone: "Đã đối chiếu với CV của Khoi",
    stepConnect: "Đang hỏi trợ lý…",
    stepGuard: "Đang kiểm tra câu hỏi…",
    stepGuardDone: "Câu hỏi phù hợp",
    stepContext: (n) => `Đã đọc ${n} đoạn ngữ cảnh`,
    stepThinking: "Đang suy nghĩ…",
    stepThinkingLong: "Đang suy nghĩ… câu hỏi này cần thêm chút thời gian",
    sec: (n) => `${n} giây`,
    stopped: "(đã dừng)",
    noBackend: "Chưa kết nối trợ lý AI, nên đây là các đoạn liên quan nhất tìm được trong hồ sơ:",
    failed: "Trợ lý AI đang bận hoặc không phản hồi. Đây là các đoạn liên quan nhất tìm được trong hồ sơ:",
    detail: "Chi tiết kỹ thuật",
    limited: "Bạn hỏi hơi nhanh, thử lại sau ít phút nhé.",
  };

  const KEY = "khoi-chat-v1";
  const MAX_MSGS = 40;
  const SUGGESTIONS = cfg.suggestions || [];

  const ICON = {
    bot: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 6V3.4"/><circle cx="12" cy="2.6" r="1" fill="currentColor" stroke="none"/><rect x="4" y="6" width="16" height="12.5" rx="4.2"/><circle cx="9" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.35" fill="currentColor" stroke="none"/><path d="M9.6 15.4h4.8"/><path d="M2 11v3M22 11v3"/><path d="M8.5 18.5l-1.4 2.6 3.7-2.2"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    reset: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  };

  // ---- helpers ---------------------------------------------------------------------------------------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const href = (u) => esc((cfg.baseurl || "") + u);

  function load() {
    try { const v = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (v && Array.isArray(v.msgs)) return v; } catch { /* ignore */ }
    return { open: false, msgs: [] };
  }
  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify({ open: S.open, msgs: S.msgs.slice(-MAX_MSGS) })); } catch { /* ignore */ }
  }

  // ---- state / DOM -----------------------------------------------------------------------------------------
  const saved = load();
  const S = { open: false, msgs: saved.msgs, busy: false, abort: null };
  let ui = null;

  function build() {
    document.documentElement.classList.add("has-chatbot");
    const launcher = el("button", "cb-launcher",
      `<span class="cb-ico">${ICON.bot}</span><span class="cb-launch-label">${esc(T.launchLabel)}</span>`);
    launcher.type = "button";
    launcher.setAttribute("aria-label", T.launch);
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", "cb-win");

    const win = el("section", "cb-win");
    win.id = "cb-win";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", T.title);
    win.hidden = true;
    win.innerHTML =
      `<header class="cb-head"><span class="cb-av cb-av-lg">${ICON.bot}</span>` +
      `<div class="cb-ttl"><strong>${esc(T.title)}</strong><span>${esc(T.subtitle)}</span></div>` +
      `<button type="button" class="cb-icon-btn cb-reset" aria-label="${esc(T.reset)}" title="${esc(T.reset)}">${ICON.reset}</button>` +
      `<button type="button" class="cb-icon-btn cb-close" aria-label="${esc(T.close)}" title="${esc(T.close)}">${ICON.close}</button></header>` +
      `<div class="cb-log" role="log" aria-live="polite" aria-relevant="additions text" tabindex="0"></div>` +
      `<form class="cb-form" autocomplete="off"><textarea rows="1" maxlength="500" enterkeyhint="send" placeholder="${esc(T.placeholder)}" aria-label="${esc(T.placeholder)}"></textarea>` +
      `<button type="submit" class="cb-send" aria-label="${esc(T.send)}">${ICON.send}</button></form>` +
      `<p class="cb-foot">${esc(T.note)}</p>`;

    document.body.append(launcher, win);
    ui = {
      launcher, win,
      log: win.querySelector(".cb-log"),
      form: win.querySelector(".cb-form"),
      input: win.querySelector("textarea"),
      send: win.querySelector(".cb-send"),
    };

    launcher.addEventListener("click", () => open());
    win.querySelector(".cb-close").addEventListener("click", () => close());
    win.querySelector(".cb-reset").addEventListener("click", reset);
    ui.form.addEventListener("submit", (e) => { e.preventDefault(); if (S.busy) stop(); else submit(); });
    ui.input.addEventListener("input", autosize);
    ui.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!S.busy) submit(); }
    });
    win.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    ui.log.addEventListener("click", onLogClick);
  }

  function autosize() {
    ui.input.style.height = "auto";
    ui.input.style.height = Math.min(ui.input.scrollHeight, 120) + "px";
  }

  function setBusy(b) {
    S.busy = b;
    ui.send.innerHTML = b ? ICON.stop : ICON.send;
    ui.send.setAttribute("aria-label", b ? T.stop : T.send);
    ui.send.classList.toggle("is-stop", b);
    ui.log.setAttribute("aria-busy", String(b));
  }

  // ---- open / close ------------------------------------------------------------------------------------------
  function open({ focus = true } = {}) {
    if (!ui) build();
    if (S.open) { if (focus) ui.input.focus(); return; }
    S.open = true;
    ui.win.hidden = false;
    ui.launcher.hidden = true;
    ui.launcher.setAttribute("aria-expanded", "true");
    render();
    if (focus) ui.input.focus({ preventScroll: true });
    save();
  }

  function close() {
    if (!ui || !S.open) return;
    S.open = false;
    ui.win.hidden = true;
    ui.launcher.hidden = false;
    ui.launcher.setAttribute("aria-expanded", "false");
    ui.launcher.focus({ preventScroll: true });
    save();
  }

  function reset() {
    stop();
    S.msgs = [];
    render();
    save();
    ui.input.focus();
  }

  // ---- rendering ------------------------------------------------------------------------------------------------
  function renderMd(text, sources) {
    const cite = (s) => s.replace(/\[(\d{1,2})\]/g, (m, n) => {
      const src = sources && sources[+n - 1];
      return src ? `<a class="cb-cite" data-go="${esc(src.url)}" href="${href(src.url)}" title="${esc(src.title)}">${n}</a>` : "";
    });
    const inline = (s) => cite(esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>"));
    let html = "";
    let list = null;
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const line of String(text).replace(/\r/g, "").split("\n")) {
      const li = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
      if (li) {
        const kind = /\d/.test(li[1]) ? "ol" : "ul";
        if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
        html += `<li>${inline(li[2])}</li>`;
      } else if (line.trim()) { closeList(); html += `<p>${inline(line.trim())}</p>`; }
      else closeList();
    }
    closeList();
    return html;
  }

  function sourcesHtml(sources, text) {
    const cited = [...new Set([...String(text).matchAll(/\[(\d{1,2})\]/g)].map((m) => +m[1]))]
      .filter((n) => sources && sources[n - 1]).sort((a, b) => a - b);
    if (!cited.length) return "";
    return `<div class="cb-sources"><span class="cb-sources-label">${esc(T.sources)}</span>` +
      cited.map((n) => `<a class="cb-src" data-go="${esc(sources[n - 1].url)}" href="${href(sources[n - 1].url)}"><b>${n}</b>${esc(sources[n - 1].title)}</a>`).join("") + `</div>`;
  }

  function passagesHtml(hits) {
    if (!hits || !hits.length) return "";
    return `<ul class="cb-passages">` + hits.map((h) =>
      `<li><a class="cb-src" data-go="${esc(h.url)}" href="${href(h.url)}"><b>${esc(h.label)}</b>${esc(h.title)}</a><span>${esc(h.text)}</span></li>`).join("") + `</ul>`;
  }

  function bubbleHtml(m) {
    if (m.k === "blocked") return `<p class="cb-note">${esc(m.t)}</p>`;
    if (m.k === "fallback") {
      const d = m.d ? `<p class="cb-detail" title="${esc(T.detail)}">${esc(m.d)}</p>` : "";
      return `<p class="cb-note">${esc(m.t)}</p>${d}${passagesHtml(m.hits)}`;
    }
    return renderMd(m.t, m.src) + sourcesHtml(m.src, m.t);
  }

  // Live progress while the assistant works: each step is {id, text, done}. The elapsed time proves it is alive.
  function stepsHtml(steps, startedAt) {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    return `<ul class="cb-steps" role="status">` + steps.map((st) => {
      const mark = st.done ? `<span class="cb-tick" aria-hidden="true">✓</span>` : `<i class="cb-spin" aria-hidden="true"></i>`;
      const clock = !st.done && st.clock && sec >= 2 ? `<span class="cb-elapsed" aria-hidden="true"> · ${esc(T.sec(sec))}</span>` : "";
      return `<li class="${st.done ? "done" : "active"}">${mark}<span>${esc(st.text)}</span>${clock}</li>`;
    }).join("") + `</ul>`;
  }

  function msgNode(m) {
    if (m.r === "u") return el("div", "cb-msg cb-user", `<div class="cb-bubble">${esc(m.t)}</div>`);
    const n = el("div", "cb-msg cb-bot", `<span class="cb-av">${ICON.bot}</span><div class="cb-bubble"></div>`);
    n.querySelector(".cb-bubble").innerHTML = m.pending ? `<span class="cb-typing" role="status" aria-label="${esc(T.thinking)}"><i></i><i></i><i></i></span>` : bubbleHtml(m);
    return n;
  }

  function render() {
    ui.log.textContent = "";
    const welcome = el("div", "cb-msg cb-bot",
      `<span class="cb-av">${ICON.bot}</span><div class="cb-bubble"><p>${esc(T.welcome)}</p></div>`);
    ui.log.appendChild(welcome);
    if (!S.msgs.length && SUGGESTIONS.length) {
      const chips = el("div", "cb-chips", `<span class="cb-chips-label">${esc(T.tryAsking)}</span>`);
      SUGGESTIONS.forEach((q) => { const b = el("button", "cb-chip", esc(q)); b.type = "button"; b.dataset.q = q; chips.appendChild(b); });
      ui.log.appendChild(chips);
    }
    S.msgs.forEach((m) => ui.log.appendChild(msgNode(m)));
    scrollEnd(true);
  }

  function scrollEnd(force) {
    const l = ui.log;
    if (force || l.scrollHeight - l.scrollTop - l.clientHeight < 140) l.scrollTop = l.scrollHeight;
  }

  function onLogClick(e) {
    const chip = e.target.closest(".cb-chip");
    if (chip) { ask(chip.dataset.q); return; }
    const a = e.target.closest("a[data-go]");
    if (a && window.cmdk) {
      e.preventDefault();
      if (matchMedia("(max-width: 620px)").matches) close(); // the window covers the page on phones
      window.cmdk.go(a.dataset.go);
    }
  }

  // ---- asking ------------------------------------------------------------------------------------------------------
  function submit() {
    const q = ui.input.value.trim();
    if (!q) return;
    ui.input.value = "";
    autosize();
    ask(q);
  }

  function stop() { S.abort?.abort(); }

  async function ask(question) {
    question = String(question).trim().slice(0, 500);
    if (!question) return;
    if (!ui || !S.open) open({ focus: false });
    if (S.busy) stop();

    S.msgs.push({ r: "u", t: question });
    const bot = { r: "b", t: "", pending: true };
    S.msgs.push(bot);
    ui.log.querySelector(".cb-chips")?.remove();
    ui.log.appendChild(msgNode({ r: "u", t: question }));
    const node = msgNode(bot);
    ui.log.appendChild(node);
    const bubble = node.querySelector(".cb-bubble");
    scrollEnd(true);
    setBusy(true);

    // live progress: shown from the first millisecond, replaced by the answer as soon as it starts streaming
    const startedAt = Date.now();
    const steps = [{ id: "search", text: T.stepSearch, done: false }];
    const setStep = (id, text, done, extra = {}) => {
      const cur = steps.find((x) => x.id === id);
      if (cur) Object.assign(cur, { text, done }, extra); else steps.push({ id, text, done, ...extra });
    };
    const renderSteps = () => { if (bot.pending) { bubble.innerHTML = stepsHtml(steps, startedAt); scrollEnd(false); } };
    const ticker = setInterval(() => {
      const th = steps.find((x) => x.id === "thinking");
      if (th && !th.done && Date.now() - th.since > 15000) th.text = T.stepThinkingLong;
      renderSteps();
    }, 1000);
    renderSteps();

    // 1. retrieve the best non-core passages (the Worker adds the whole CV by itself)
    let hits = [];
    try { hits = window.cmdk?.retrieve ? await window.cmdk.retrieve(question) : []; } catch { /* answer without retrieval */ }
    const ids = hits.map((h) => h.chunk.id);
    const pages = [...new Set(hits.map((h) => h.chunk.title.split(" — ")[0].replace(/\s*\(\d+\)$/, "")))].slice(0, 3); // page names, de-duplicated
    setStep("search", hits.length ? T.stepSearched(hits.length, pages.join(", ")) : T.stepSearchedNone, true);
    setStep("connect", T.stepConnect, false, { clock: true });
    renderSteps();
    const passages = hits.slice(0, 4).map(({ chunk }) => ({ label: chunk.label, title: chunk.title, url: chunk.url, text: chunk.text.slice(0, 200) }));

    const finish = (patch) => {
      clearInterval(ticker);
      delete bot.pending;
      Object.assign(bot, patch);
      bubble.innerHTML = bubbleHtml(bot);
      setBusy(false);
      S.abort = null;
      scrollEnd(true);
      save();
    };

    if (!cfg.ask) return finish({ k: "fallback", t: T.noBackend, hits: passages });

    // 2. generate: stream the grounded answer from the Cloudflare Worker
    const ctl = (S.abort = new AbortController());
    let sources = [];
    let text = "";
    let refusal = null;
    let raf = 0;
    const paint = () => { raf = 0; if (bot.pending) clearInterval(ticker); delete bot.pending; bubble.innerHTML = renderMd(text, sources); scrollEnd(false); };
    try {
      const res = await fetch(cfg.ask, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, ids }),
        signal: ctl.signal,
      });
      if (res.status === 429) return finish({ k: "blocked", t: T.limited });
      if (!res.ok || !res.body) {
        const info = await res.json().catch(() => ({}));
        const e = new Error(`HTTP ${res.status}${info.code ? " · " + info.code : ""}`);
        e.detail = e.message;
        throw e;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let event = "message";
          const data = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).trim());
          }
          if (!data.length) continue;
          let payload;
          try { payload = JSON.parse(data.join("\n")); } catch { continue; }
          if (event === "sources") sources = payload;
          else if (event === "blocked") refusal = payload.message || "";
          else if (event === "status") {
            // the Worker reports what it is doing: guard -> context -> thinking -> writing
            const i = steps.findIndex((x) => x.id === "connect");
            if (i >= 0) steps.splice(i, 1);
            if (payload.step === "guard") setStep("guard", T.stepGuard, false, { clock: true });
            else if (payload.step === "context") {
              setStep("guard", T.stepGuardDone, true);
              setStep("context", T.stepContext(payload.count || 0), true);
            } else if (payload.step === "thinking") setStep("thinking", T.stepThinking, false, { clock: true, since: Date.now() });
            renderSteps();
          } else if (event === "error") {
            const e = new Error(payload.message || "ask error");
            e.detail = `HTTP ${payload.status || "?"} · ${payload.code || "error"}` +
              (payload.attempts ? " · " + payload.attempts.map((a) => `${a.model}: ${a.error}`).join(" | ") : "") + (payload.detail ? " · " + payload.detail : "");
            throw e;
          }
          else if (event === "message" && payload.t) { text += payload.t; if (!raf) raf = requestAnimationFrame(paint); }
        }
      }
      if (raf) cancelAnimationFrame(raf);
      if (refusal !== null) return finish({ k: "blocked", t: refusal }); // off-topic / injection: fixed refusal only
      if (!text.trim()) throw new Error("empty answer");
      finish({ t: text, src: sources });
    } catch (err) {
      if (raf) cancelAnimationFrame(raf);
      if (ctl.signal.aborted) return finish({ t: (text.trim() ? text + "\n\n" : "") + T.stopped, src: sources });
      if (text.trim()) return finish({ t: text, src: sources });
      // no HTTP answer at all = network failure, or the Worker rejected this origin (CORS hides that response)
      const detail = err && err.detail ? err.detail : `không nhận được phản hồi (mạng hoặc CORS) · origin ${location.origin}`;
      console.warn("[chat] ask failed:", detail, err);
      finish({ k: "fallback", t: T.failed, d: detail, hits: passages });
    }
  }

  // ---- boot ---------------------------------------------------------------------------------------------------------------
  function boot() {
    build();
    if (saved.open) open({ focus: false });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.chatbot = { open: () => open(), close, ask };
})();
