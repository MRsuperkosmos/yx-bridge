// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// YX Bridge — background service worker (Manifest V3).
// Держит WebSocket к локальному MCP-серверу (ws://127.0.0.1:17555) и выполняет
// команды: список вкладок, чтение страницы, DOM-манипуляции через chrome.scripting,
// произвольный JS и низкоуровневые действия через chrome.debugger (CDP).

const WS_URL = "ws://127.0.0.1:17555";
const PROTOCOL = 1;

let ws = null;
let reconnectDelay = 1000;
let keepalive = null;
let paused = false; // kill-switch: block agent commands but keep the connection
let status = { connected: false, lastError: null, since: null, handled: 0 };
chrome.storage.local.get("yxPaused").then((r) => { paused = !!r.yxPaused; setStatus({}); }).catch(() => {});

// ---------------------------------------------------------------- utils
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Local calendar day (YYYY-MM-DD). Stats use local time so the per-day and per-hour
// buckets line up with the clock the user actually sees.
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Record which time zone the stats were collected in (the user's own device zone),
// so the data is self-describing and the page/agent can label it correctly.
function tzStamp(s) { try { s.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { s.tz = null; } s.tzOffsetMin = -new Date().getTimezoneOffset(); return s; }

// Draw the toolbar icon: white bulb on orange, with a status dot in the corner —
// green = connected, red = not connected, yellow = paused by the user.
function paintIcon() {
  const dot = paused ? "#F5C518" : status.connected ? "#2ECC71" : "#E5484D";
  const imageData = {};
  for (const S of [16, 32, 48]) {
    try {
      const g = new OffscreenCanvas(S, S).getContext("2d");
      const k = S / 128;
      const rr = (x, y, w, h, r) => {
        const X = x * k, Y = y * k, Wd = w * k, H = h * k, R = r * k;
        g.beginPath();
        if (g.roundRect) g.roundRect(X, Y, Wd, H, R);
        else { g.moveTo(X + R, Y); g.arcTo(X + Wd, Y, X + Wd, Y + H, R); g.arcTo(X + Wd, Y + H, X, Y + H, R); g.arcTo(X, Y + H, X, Y, R); g.arcTo(X, Y, X + Wd, Y, R); g.closePath(); }
      };
      rr(0, 0, 128, 128, 26); g.fillStyle = "#F97316"; g.fill();          // orange background
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(64 * k, 50 * k, 32 * k, 0, 7); g.fill();        // bulb glass
      rr(55, 78, 18, 24, 6); g.fill();                                      // screw base
      g.fillStyle = "#F97316"; for (const ty of [86, 92, 98]) g.fillRect(55 * k, ty * k, 18 * k, 2.6 * k); // threads
      g.beginPath(); g.arc(98 * k, 98 * k, 24 * k, 0, 7); g.fillStyle = "#F97316"; g.fill(); // ring
      g.beginPath(); g.arc(98 * k, 98 * k, 19 * k, 0, 7); g.fillStyle = dot; g.fill();       // status dot
      imageData[S] = g.getImageData(0, 0, S, S);
    } catch {}
  }
  try { if (Object.keys(imageData).length) chrome.action.setIcon({ imageData }).catch(() => {}); } catch {}
}

function setStatus(patch) {
  status = { ...status, ...patch };
  try { chrome.action.setBadgeText({ text: "" }); } catch {}
  paintIcon();
}

// Рабочее окно: если задано, вкладки без явного tabId берутся из него и новые
// вкладки открываются в нём, чтобы не мешать окну, где работает пользователь.
let workWindowId = null;
async function getWorkWindow() {
  if (workWindowId == null) return null;
  try { return await chrome.windows.get(workWindowId); } catch { workWindowId = null; return null; }
}
chrome.storage.session.get("workWindowId").then((r) => { if (r && r.workWindowId) workWindowId = r.workWindowId; }).catch(() => {});

async function resolveTab(tabId) {
  if (tabId != null) return chrome.tabs.get(tabId);
  const ww = await getWorkWindow();
  if (ww) {
    const [wt] = await chrome.tabs.query({ active: true, windowId: ww.id });
    if (wt) return wt;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) return tab;
  const [any] = await chrome.tabs.query({ active: true });
  if (!any) throw new Error("no active tab");
  return any;
}

function tabInfo(t) {
  return {
    id: t.id,
    windowId: t.windowId,
    index: t.index,
    active: t.active,
    url: t.url || t.pendingUrl,
    title: t.title,
    status: t.status,
    pinned: t.pinned,
    audible: t.audible,
  };
}

function isInjectable(url) {
  return /^(https?|file|ftp):/i.test(url || "");
}

// Shared helpers referenced by many page functions. exec injects these onto the
// page's isolated-world global object once per tab, so bare `_clean`, `_findByAny`,
// `pageChoose`, `pagePatterns`, `pageSchemaExtract` resolve inside injected funcs.
function _installPageHelpers() {
  const g = window;
  g._clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  g._findByAny = (sel) => sel ? (document.querySelector(sel) || document.querySelector(`[name="${sel}"]`) || document.getElementById(sel)) : null;
  g.pageChoose = function (groupSelector, labelText, exact) {
    const scope = groupSelector ? document.querySelector(groupSelector) : document;
    if (!scope) return { ok: false, error: "group not found" };
    const inputs = Array.from(scope.querySelectorAll('input[type=radio], input[type=checkbox]'));
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
    const want = norm(labelText);
    const labelOf = (inp) => { if (inp.id) { const l = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`); if (l) return l.innerText; } const l = inp.closest("label"); if (l) return l.innerText; const n = inp.nextElementSibling; return n ? n.innerText : inp.value; };
    let target = inputs.find((i) => exact ? norm(labelOf(i)) === want : norm(labelOf(i)).includes(want));
    if (!target) return { ok: false, error: "option not found", options: inputs.map((i) => norm(labelOf(i))) };
    const lbl = target.closest("label") || (target.id && document.querySelector(`label[for="${CSS.escape(target.id)}"]`)) || target;
    lbl.scrollIntoView({ block: "center" }); lbl.click();
    if (!target.checked) { target.checked = true; target.dispatchEvent(new Event("input", { bubbles: true })); target.dispatchEvent(new Event("change", { bubbles: true })); }
    return { ok: true, chosen: labelOf(target).replace(/\s+/g, " ").trim(), value: target.value, checked: target.checked };
  };
  g.pagePatterns = function (kind, limit) {
    const text = (document.body && document.body.innerText) || "";
    const html = document.documentElement.outerHTML;
    const uniq = (a) => [...new Set(a)].slice(0, limit);
    const RE = { emails: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, phones: /(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{2,4}\)[\s.\-]?)?\d{2,4}[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}/g, urls: /https?:\/\/[^\s"'<>)]+/g, dates: /\b(?:\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4}|\d{4}[.\/\-]\d{1,2}[.\/\-]\d{1,2})\b/g, prices: /(?:[$€£¥₽]|USD|EUR|RUB|руб\.?|₴)\s?\d[\d\s.,]*\d|\d[\d\s.,]*\d\s?(?:[$€£¥₽]|руб\.?|₽)/g, hashtags: /#[A-Za-zА-Яа-я0-9_]+/g, mentions: /@[A-Za-z0-9_.]+/g, numbers: /\b\d[\d\s.,]{2,}\b/g, ips: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g };
    const src = kind === "urls" ? html : text;
    const m = (src.match(RE[kind]) || []).map((s) => s.trim()).filter((s) => s.length > (kind === "numbers" ? 2 : 3));
    return { kind, count: [...new Set(m)].length, matches: uniq(m) };
  };
  g.pageSchemaExtract = function (type) {
    const jsonld = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { const j = JSON.parse(s.textContent); const items = Array.isArray(j) ? j : (j["@graph"] || [j]); for (const it of items) { if (!type || (it["@type"] && String(it["@type"]).toLowerCase().includes(type.toLowerCase()))) jsonld.push(it); } } catch {} }
    const microdata = [];
    for (const el of document.querySelectorAll("[itemscope]")) { const it = { "@type": el.getAttribute("itemtype") }; for (const p of el.querySelectorAll("[itemprop]")) it[p.getAttribute("itemprop")] = window._clean(p.getAttribute("content") || p.getAttribute("datetime") || p.href || p.src || p.innerText).slice(0, 300); if (!type || (it["@type"] || "").toLowerCase().includes(type.toLowerCase())) microdata.push(it); }
    return { jsonld, microdata, count: jsonld.length + microdata.length };
  };
  return true;
}
const _helpersInjected = new Set();
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === "loading") _helpersInjected.delete(id); });

// Выполнить функцию в контексте страницы (isolated world расширения).
async function exec(tabId, func, args = [], world = "ISOLATED") {
  const tab = await resolveTab(tabId);
  if (!isInjectable(tab.url)) throw new Error(`cannot inject into ${tab.url}`);
  if (!_helpersInjected.has(tab.id)) {
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: _installPageHelpers, world }); _helpersInjected.add(tab.id); } catch {}
  }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func,
    args,
    world,
  });
  if (res && res.error) throw new Error(res.error.message || String(res.error));
  return res ? res.result : undefined;
}

async function waitLoad(tabId, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return tabInfo(t);
    await sleep(150);
  }
  throw new Error("timeout waiting for load");
}

// ---------------------------------------------------------------- debugger (CDP)
const attached = new Map(); // tabId -> { logs: [] }

async function attach(tabId) {
  const tab = await resolveTab(tabId);
  if (attached.has(tab.id)) return tab.id;
  await chrome.debugger.attach({ tabId: tab.id }, "1.3");
  attached.set(tab.id, { logs: [] });
  try {
    await chrome.debugger.sendCommand({ tabId: tab.id }, "Runtime.enable");
  } catch {}
  return tab.id;
}

async function detach(tabId) {
  if (!attached.has(tabId)) return false;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
  attached.delete(tabId);
  return true;
}

async function cdp(tabId, method, params = {}) {
  const id = await attach(tabId);
  return chrome.debugger.sendCommand({ tabId: id }, method, params);
}

// Вкладка в перекрытом/несфокусированном окне считается скрытой: плееры и ленивые
// загрузки замирают. Эмулируем фокус и видимость через CDP (окно на передний план
// не выдёргиваем, чтобы не мешать пользователю).
const VISIBILITY_OVERRIDE = `(() => {
  if (window.__cbVisOverride) return "already";
  window.__cbVisOverride = true;
  const def = (o, k, v) => { try { Object.defineProperty(o, k, { get: () => v, configurable: true }); } catch {} };
  def(document, "hidden", false);
  def(document, "visibilityState", "visible");
  def(document, "webkitHidden", false);
  def(document, "webkitVisibilityState", "visible");
  try { document.hasFocus = () => true; } catch {}
  const stop = (e) => { e.stopImmediatePropagation(); };
  for (const ev of ["visibilitychange", "webkitvisibilitychange"]) document.addEventListener(ev, stop, true);
  for (const ev of ["blur", "pagehide", "freeze"]) window.addEventListener(ev, stop, true);
  return "installed";
})()`;
async function keepVisible(tabId) {
  const id = await attach(tabId);
  try { await cdp(id, "Emulation.setFocusEmulationEnabled", { enabled: true }); } catch {}
  try { await cdp(id, "Page.enable"); await cdp(id, "Page.setWebLifecycleState", { state: "active" }); } catch {}
  let r = null;
  try { r = (await cdp(id, "Runtime.evaluate", { expression: VISIBILITY_OVERRIDE, returnByValue: true })).result.value; } catch {}
  return { tabId: id, override: r };
}

chrome.debugger.onDetach.addListener((src) => {
  if (src.tabId != null) attached.delete(src.tabId);
});

chrome.debugger.onEvent.addListener((src, method, params) => {
  const st = attached.get(src.tabId);
  if (!st) return;
  // ---- network log (after network_start) ----
  if (st.net) {
    if (method === "Network.requestWillBeSent") {
      st.net.push({ id: params.requestId, ts: params.timestamp, url: params.request.url, method: params.request.method, type: params.type, initiator: params.initiator && params.initiator.type, postData: params.request.postData ? String(params.request.postData).slice(0, 2000) : undefined });
    } else if (method === "Network.responseReceived") {
      const r = st.net.find((x) => x.id === params.requestId);
      if (r) Object.assign(r, { status: params.response.status, mime: params.response.mimeType, fromCache: params.response.fromDiskCache || params.response.fromServiceWorker || false, remoteIP: params.response.remoteIPAddress });
    } else if (method === "Network.loadingFailed") {
      const r = st.net.find((x) => x.id === params.requestId);
      if (r) r.error = params.errorText;
    } else if (method === "Network.loadingFinished") {
      const r = st.net.find((x) => x.id === params.requestId);
      if (r) r.bytes = params.encodedDataLength;
    }
    if (st.net.length > 2000) st.net.splice(0, st.net.length - 2000);
  }
  // ---- websocket frames (after websocket_frames) ----
  if (st.ws) {
    if (method === "Network.webSocketFrameSent") st.ws.push({ dir: "sent", ts: Date.now(), opcode: params.response && params.response.opcode, data: (params.response && String(params.response.payloadData || "")).slice(0, 2000) });
    else if (method === "Network.webSocketFrameReceived") st.ws.push({ dir: "recv", ts: Date.now(), opcode: params.response && params.response.opcode, data: (params.response && String(params.response.payloadData || "")).slice(0, 2000) });
    else if (method === "Network.webSocketCreated") st.ws.push({ dir: "open", ts: Date.now(), url: params.url });
    if (st.ws.length > 1000) st.ws.splice(0, st.ws.length - 1000);
  }
  // ---- auto-handle JS dialogs (after dialogs mode) ----
  if (method === "Page.javascriptDialogOpening" && st.dialogMode) {
    st.dialogs = st.dialogs || [];
    st.dialogs.push({ ts: Date.now(), type: params.type, message: params.message });
    chrome.debugger.sendCommand({ tabId: src.tabId }, "Page.handleJavaScriptDialog", { accept: st.dialogMode === "accept", promptText: st.dialogPrompt || "" }).catch(() => {});
  }
  if (method === "Runtime.consoleAPICalled") {
    st.logs.push({
      ts: Date.now(),
      type: params.type,
      args: (params.args || []).map((a) => (a.value !== undefined ? a.value : a.description || a.type)),
    });
  } else if (method === "Runtime.exceptionThrown") {
    const d = params.exceptionDetails || {};
    st.logs.push({ ts: Date.now(), type: "exception", args: [d.text, d.exception && d.exception.description] });
  }
  if (st.logs.length > 500) st.logs.splice(0, st.logs.length - 500);
});

chrome.tabs.onRemoved.addListener((tabId) => attached.delete(tabId));

// ---------------------------------------------------------------- page-side helpers
// Эти функции сериализуются и выполняются внутри страницы — без замыканий!

function pageGetInfo(maxChars) {
  const text = (document.body && document.body.innerText) || "";
  const h = document.documentElement;
  return {
    url: location.href,
    title: document.title,
    lang: h.lang || null,
    // Яндекс при автопереводе выставляет lang=ru и стирает translate/notranslate.
    translated: h.lang === "ru" && h.getAttribute("translate") !== "no" && !h.classList.contains("notranslate") ? "maybe" : "no",
    length: text.length,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}

// Оригинал страницы в обход автоперевода: повторный запрос HTML с куками страницы.
// Подходит для серверного рендеринга; текст, дорисованный JS, сюда не попадёт.
async function pageGetOriginal(maxChars) {
  const res = await fetch(location.href, { credentials: "include", cache: "force-cache" });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.querySelectorAll("script, style, noscript, template")) el.remove();
  const blocks = new Set(["P", "DIV", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "SECTION", "ARTICLE", "HEADER", "FOOTER", "TD", "TH", "PRE", "BLOCKQUOTE", "UL", "OL", "NAV", "MAIN"]);
  let out = "";
  const walk = (n) => {
    if (n.nodeType === 3) out += n.nodeValue;
    else if (n.nodeType === 1) {
      const block = blocks.has(n.tagName);
      if (block) out += "\n";
      for (const c of n.childNodes) walk(c);
      if (block) out += "\n";
    }
  };
  walk(doc.body || doc.documentElement);
  const text = out.replace(/[ \t\r\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  return {
    url: location.href,
    title: doc.title,
    lang: doc.documentElement.lang || null,
    source: "refetched-html",
    status: res.status,
    length: text.length,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}

function pageSelect(selector, value, byText) {
  const el = document.querySelector(selector);
  if (!el || el.tagName !== "SELECT") return { ok: false, error: "select not found" };
  const opts = Array.from(el.options);
  const opt = byText ? opts.find((o) => o.text.trim() === value) || opts.find((o) => o.text.trim().includes(value)) : opts.find((o) => o.value === value);
  if (!opt) return { ok: false, error: "option not found", options: opts.map((o) => ({ value: o.value, text: o.text.trim() })).slice(0, 50) };
  el.value = opt.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: opt.value, text: opt.text.trim() };
}

function pageGetHtml(selector, outer, maxChars) {
  const el = selector ? document.querySelector(selector) : document.documentElement;
  if (!el) return { found: false };
  const html = outer ? el.outerHTML : el.innerHTML;
  return { found: true, length: html.length, html: html.slice(0, maxChars), truncated: html.length > maxChars };
}

function pageQuery(selector, limit, attrs, textMax) {
  const list = Array.from(document.querySelectorAll(selector));
  const out = list.slice(0, limit).map((el, i) => {
    const r = el.getBoundingClientRect();
    const item = {
      index: i,
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      class: el.className && typeof el.className === "string" ? el.className : undefined,
      text: (el.innerText || el.textContent || "").trim().slice(0, textMax),
      href: el.href || undefined,
      src: el.src || undefined,
      value: el.value !== undefined && el.tagName !== "OPTION" ? String(el.value).slice(0, textMax) : undefined,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      visible: r.width > 0 && r.height > 0,
    };
    if (attrs && attrs.length) {
      item.attrs = {};
      for (const a of attrs) item.attrs[a] = el.getAttribute(a);
    }
    return item;
  });
  return { total: list.length, items: out };
}

function pageClick(selector, index) {
  const els = document.querySelectorAll(selector);
  const el = els[index || 0];
  if (!el) return { ok: false, error: "not found", total: els.length };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.click();
  return { ok: true, tag: el.tagName.toLowerCase(), text: (el.innerText || "").trim().slice(0, 120) };
}

function pageType(selector, text, clear, submit) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: "not found" };
  el.focus();
  const isCE = el.isContentEditable;
  if (isCE) {
    if (clear) el.textContent = "";
    document.execCommand("insertText", false, text);
  } else {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    const cur = clear ? "" : el.value || "";
    if (desc && desc.set) desc.set.call(el, cur + text);
    else el.value = cur + text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (submit) {
    const k = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", k));
    el.dispatchEvent(new KeyboardEvent("keypress", k));
    el.dispatchEvent(new KeyboardEvent("keyup", k));
    if (el.form && typeof el.form.requestSubmit === "function") {
      try {
        el.form.requestSubmit();
      } catch {}
    }
  }
  return { ok: true, value: isCE ? el.textContent.slice(0, 200) : String(el.value).slice(0, 200) };
}

function pageSetHtml(selector, html, mode) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: "not found" };
  if (mode === "append") el.insertAdjacentHTML("beforeend", html);
  else if (mode === "prepend") el.insertAdjacentHTML("afterbegin", html);
  else if (mode === "outer") el.outerHTML = html;
  else if (mode === "text") el.textContent = html;
  else el.innerHTML = html;
  return { ok: true };
}

function pageSetAttr(selector, name, value, all) {
  const els = all ? document.querySelectorAll(selector) : [document.querySelector(selector)].filter(Boolean);
  for (const el of els) {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }
  return { ok: true, count: els.length };
}

function pageSetStyle(selector, styles, all) {
  const els = all ? document.querySelectorAll(selector) : [document.querySelector(selector)].filter(Boolean);
  for (const el of els) Object.assign(el.style, styles);
  return { ok: true, count: els.length };
}

function pageRemove(selector, all) {
  const els = all ? document.querySelectorAll(selector) : [document.querySelector(selector)].filter(Boolean);
  for (const el of els) el.remove();
  return { ok: true, count: els.length };
}

function pageScroll(selector, x, y) {
  if (selector) {
    const el = document.querySelector(selector);
    if (!el) return { ok: false, error: "not found" };
    el.scrollIntoView({ block: "center" });
  } else window.scrollBy(x || 0, y || 0);
  return { ok: true, scrollX: window.scrollX, scrollY: window.scrollY, height: document.documentElement.scrollHeight };
}

function pageLinks(limit) {
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    if (!href || seen.has(href) || href.startsWith("javascript:")) continue;
    seen.add(href);
    out.push({ href, text: (a.innerText || a.textContent || "").trim().slice(0, 120) });
    if (out.length >= limit) break;
  }
  return { total: seen.size, links: out };
}

function pageForms() {
  return Array.from(document.forms).map((f, i) => ({
    index: i,
    id: f.id || undefined,
    name: f.name || undefined,
    action: f.action,
    method: f.method,
    fields: Array.from(f.elements)
      .filter((e) => e.name || e.id)
      .map((e) => ({ tag: e.tagName.toLowerCase(), type: e.type, name: e.name || undefined, id: e.id || undefined, value: e.type === "password" ? "***" : String(e.value || "").slice(0, 100) })),
  }));
}

function pageFindText(needle, limit, context, caseSensitive) {
  const body = (document.body && document.body.innerText) || "";
  const hay = caseSensitive ? body : body.toLowerCase();
  const q = caseSensitive ? needle : needle.toLowerCase();
  const out = [];
  let i = 0;
  while (out.length < limit) {
    const at = hay.indexOf(q, i);
    if (at < 0) break;
    out.push({ at, snippet: body.slice(Math.max(0, at - context), at + q.length + context).replace(/\s+/g, " ") });
    i = at + q.length;
  }
  let total = 0;
  for (let j = hay.indexOf(q); j >= 0; j = hay.indexOf(q, j + q.length)) total++;
  return { total, matches: out };
}

function pageTables(limit, maxRows) {
  return Array.from(document.querySelectorAll("table"))
    .slice(0, limit)
    .map((t, index) => {
      const rows = Array.from(t.rows).slice(0, maxRows).map((r) => Array.from(r.cells).map((c) => (c.innerText || "").trim()));
      const headers = rows.length && t.tHead ? rows[0] : null;
      return { index, id: t.id || undefined, caption: t.caption ? t.caption.innerText.trim() : undefined, rows: t.rows.length, headers, data: headers ? rows.slice(1) : rows };
    });
}

function pageFillForm(fields, submitSelector) {
  const setValue = (el, value) => {
    const tag = el.tagName;
    if (tag === "SELECT") {
      const opts = Array.from(el.options);
      const o = opts.find((x) => x.value === value) || opts.find((x) => x.text.trim() === value) || opts.find((x) => x.text.trim().includes(value));
      if (!o) return "option not found";
      el.value = o.value;
    } else if (el.type === "checkbox" || el.type === "radio") {
      el.checked = value === true || value === "true" || value === "1" || value === "on";
    } else if (el.isContentEditable) {
      el.focus();
      el.textContent = "";
      document.execCommand("insertText", false, String(value));
    } else {
      el.focus();
      const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(el, String(value));
      else el.value = String(value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  };
  const report = {};
  for (const [sel, value] of Object.entries(fields)) {
    const el = document.querySelector(sel) || document.querySelector(`[name="${sel}"]`) || document.getElementById(sel);
    report[sel] = el ? setValue(el, value) : "not found";
  }
  let submitted = false;
  if (submitSelector) {
    const btn = document.querySelector(submitSelector);
    if (btn) {
      btn.click();
      submitted = true;
    } else {
      const first = document.querySelector(Object.keys(fields)[0]);
      if (first && first.form) {
        first.form.requestSubmit ? first.form.requestSubmit() : first.form.submit();
        submitted = true;
      }
    }
  }
  return { fields: report, submitted };
}

function pageExtract(spec, textMax) {
  const out = {};
  for (const [name, def] of Object.entries(spec)) {
    const d = typeof def === "string" ? { selector: def } : def;
    const read = (el) => {
      if (!el) return null;
      if (d.attr) return el.getAttribute(d.attr);
      if (d.html) return el.innerHTML.slice(0, textMax);
      return (el.innerText || el.textContent || "").trim().slice(0, textMax);
    };
    if (d.all) out[name] = Array.from(document.querySelectorAll(d.selector)).map(read);
    else out[name] = read(document.querySelector(d.selector));
  }
  return out;
}

function pageStorage(area, op, key, value) {
  const s = area === "session" ? sessionStorage : localStorage;
  if (op === "keys") return { keys: Object.keys(s) };
  if (op === "get") return key ? { key, value: s.getItem(key) } : { all: Object.fromEntries(Object.keys(s).map((k) => [k, String(s.getItem(k)).slice(0, 2000)])) };
  if (op === "set") { s.setItem(key, value); return { ok: true }; }
  if (op === "remove") { s.removeItem(key); return { ok: true }; }
  if (op === "clear") { s.clear(); return { ok: true }; }
  return { error: "unknown op" };
}

function pageMeta() {
  const q = (s) => document.querySelector(s);
  const metas = {};
  for (const m of document.querySelectorAll("meta[name], meta[property]")) metas[m.getAttribute("name") || m.getAttribute("property")] = m.getAttribute("content");
  const jsonld = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { jsonld.push(JSON.parse(s.textContent)); } catch {}
  }
  const icon = q('link[rel~="icon"]');
  return {
    url: location.href,
    title: document.title,
    canonical: q('link[rel="canonical"]') && q('link[rel="canonical"]').href,
    favicon: icon ? icon.href : new URL("/favicon.ico", location.href).href,
    lang: document.documentElement.lang || null,
    description: metas.description || metas["og:description"] || null,
    og: Object.fromEntries(Object.entries(metas).filter(([k]) => k.startsWith("og:") || k.startsWith("twitter:"))),
    metas,
    jsonld,
    headings: Array.from(document.querySelectorAll("h1, h2")).slice(0, 40).map((h) => ({ tag: h.tagName.toLowerCase(), text: (h.innerText || "").trim().slice(0, 200) })),
  };
}

function pageArticle(maxChars) {
  // Readability-lite: pick the element with the largest amount of paragraph text.
  const candidates = new Map();
  for (const p of document.querySelectorAll("p, pre, li, blockquote")) {
    const t = (p.innerText || "").trim();
    if (t.length < 40) continue;
    let node = p.parentElement;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
      candidates.set(node, (candidates.get(node) || 0) + t.length + (depth === 0 ? 20 : 0));
    }
  }
  let best = document.querySelector("article, main, [role=main]");
  let bestScore = best ? Infinity : 0;
  if (!best) for (const [node, score] of candidates) if (score > bestScore) { best = node; bestScore = score; }
  if (!best) best = document.body;
  const clone = best.cloneNode(true);
  for (const el of clone.querySelectorAll("script, style, nav, aside, footer, header, form, iframe, [role=navigation], [aria-hidden=true]")) el.remove();
  const text = (clone.innerText || clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  const h1 = document.querySelector("h1");
  return { title: (h1 && h1.innerText.trim()) || document.title, byline: (document.querySelector('[rel=author], .author, .byline, [itemprop=author]') || {}).innerText || null, length: text.length, text: text.slice(0, maxChars), truncated: text.length > maxChars, container: best.tagName.toLowerCase() + (best.id ? "#" + best.id : "") };
}

function pageHover(selector) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: "not found" };
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
  for (const t of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) el.dispatchEvent(t.startsWith("pointer") ? new PointerEvent(t, o) : new MouseEvent(t, o));
  return { ok: true };
}

function pagePressKey(selector, key, modifiers) {
  const el = selector ? document.querySelector(selector) : document.activeElement || document.body;
  if (!el) return { ok: false, error: "not found" };
  const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34, " ": 32 };
  const init = { key, code: codes[key] ? key : "Key" + key.toUpperCase(), keyCode: codes[key] || key.toUpperCase().charCodeAt(0), which: codes[key] || key.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true, ...modifiers };
  el.focus();
  const down = el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  return { ok: true, defaultPrevented: !down };
}

function pageHighlight(selector, color, all) {
  const els = all ? document.querySelectorAll(selector) : [document.querySelector(selector)].filter(Boolean);
  for (const el of els) {
    el.style.outline = `3px solid ${color}`;
    el.style.outlineOffset = "2px";
  }
  return { ok: true, count: els.length };
}

function pageScrollState() {
  return { y: window.scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight };
}

function pageRect(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, dpr: devicePixelRatio };
}

// ---- media ----
function pageMediaList(limit, includeBackgrounds, minSize) {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
  const bestSrcset = (ss) => {
    if (!ss) return null;
    let best = null, bw = 0;
    for (const part of ss.split(",")) {
      const [u, d] = part.trim().split(/\s+/);
      const w = d ? parseFloat(d) : 1;
      if (w > bw) { bw = w; best = u; }
    }
    return best;
  };
  const seen = new Set();
  const images = [];
  for (const img of document.querySelectorAll("img")) {
    const r = img.getBoundingClientRect();
    const src = abs(bestSrcset(img.srcset) || img.currentSrc || img.src || img.dataset.src || img.dataset.lazySrc || img.getAttribute("data-original") || "");
    if (!src || src.startsWith("data:") && src.length < 200) continue;
    const pic = img.closest("picture");
    let picBest = null;
    if (pic) for (const s of pic.querySelectorAll("source")) picBest = abs(bestSrcset(s.srcset)) || picBest;
    const url = picBest || src;
    if (seen.has(url)) continue;
    const w = img.naturalWidth || Math.round(r.width), h = img.naturalHeight || Math.round(r.height);
    if (w && h && w < minSize && h < minSize) continue;
    seen.add(url);
    images.push({ kind: "img", url, alt: (img.alt || "").slice(0, 200), width: w, height: h, displayed: { w: Math.round(r.width), h: Math.round(r.height) }, visible: r.width > 0 && r.height > 0, link: img.closest("a") ? abs(img.closest("a").href) : undefined });
    if (images.length >= limit) break;
  }
  if (includeBackgrounds && images.length < limit) {
    for (const el of document.querySelectorAll("*")) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === "none") continue;
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (!m) continue;
      const url = abs(m[1]);
      if (!url || seen.has(url) || url.startsWith("data:")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < minSize && r.height < minSize) continue;
      seen.add(url);
      images.push({ kind: "background", url, width: Math.round(r.width), height: Math.round(r.height), visible: r.width > 0 && r.height > 0 });
      if (images.length >= limit) break;
    }
  }
  const videos = [];
  document.querySelectorAll("video").forEach((v, i) => {
    const r = v.getBoundingClientRect();
    const sources = Array.from(v.querySelectorAll("source")).map((s) => ({ url: abs(s.src), type: s.type || undefined }));
    const src = abs(v.currentSrc || v.src || "");
    videos.push({ kind: "video", index: i, url: src && !src.startsWith("blob:") ? src : null, blob: src && src.startsWith("blob:") ? true : undefined, sources: sources.filter((s) => s.url), poster: v.poster ? abs(v.poster) : undefined, duration: isFinite(v.duration) ? Math.round(v.duration) : null, currentTime: Math.round(v.currentTime), paused: v.paused, muted: v.muted, width: v.videoWidth || Math.round(r.width), height: v.videoHeight || Math.round(r.height), visible: r.width > 0 && r.height > 0, selector: v.id ? "#" + v.id : `video:nth-of-type(${i + 1})` });
  });
  const audios = Array.from(document.querySelectorAll("audio")).map((a, i) => ({ kind: "audio", index: i, url: abs(a.currentSrc || a.src || ""), sources: Array.from(a.querySelectorAll("source")).map((s) => abs(s.src)).filter(Boolean), duration: isFinite(a.duration) ? Math.round(a.duration) : null, paused: a.paused }));
  const embeds = Array.from(document.querySelectorAll("iframe")).map((f) => abs(f.src)).filter((u) => u && /youtube|youtu\.be|vimeo|rutube|vk\.com\/video|vkvideo|dzen|twitch|ok\.ru\/video|player/i.test(u)).map((url) => ({ kind: "embed", url }));
  const links = Array.from(document.querySelectorAll("a[href]")).map((a) => abs(a.href)).filter((u) => u && /\.(mp4|webm|mkv|mov|m3u8|mpd|mp3|ogg|wav|flac|gif|jpe?g|png|webp|avif|svg)(\?|$)/i.test(u));
  return { page: location.href, images, videos, audios, embeds, mediaLinks: [...new Set(links)].slice(0, 100), counts: { images: images.length, videos: videos.length, audios: audios.length, embeds: embeds.length } };
}

async function pageFetchImage(url, maxSide, quality) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return { ok: false, status: res.status };
  const blob = await res.blob();
  const type = blob.type || "image/jpeg";
  const toB64 = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(b); });
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch { return { ok: true, mime: type, bytes: blob.size, base64: await toB64(blob), note: "not decodable as raster (svg/animated?), raw bytes returned" }; }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  const out = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
  return { ok: true, mime: "image/jpeg", originalMime: type, originalBytes: blob.size, width: bitmap.width, height: bitmap.height, sent: { w, h, bytes: out.size }, base64: await toB64(out) };
}

function pageVideoControl(selector, action, value) {
  const v = selector ? document.querySelector(selector) : document.querySelector("video");
  if (!v) return { ok: false, error: "video not found" };
  let autoplayBlocked = false;
  if (action === "play") {
    v.preload = "auto";
    v.play().catch(() => { autoplayBlocked = true; v.muted = true; v.play().catch(() => {}); });
  } else if (action === "pause") v.pause();
  else if (action === "seek") v.currentTime = Number(value);
  else if (action === "mute") v.muted = true;
  else if (action === "unmute") v.muted = false;
  else if (action === "speed") v.playbackRate = Number(value);
  else if (action === "volume") v.volume = Number(value);
  else if (action === "fullscreen") v.requestFullscreen && v.requestFullscreen().catch(() => {});
  return { ok: true, currentTime: v.currentTime, duration: v.duration, paused: v.paused, muted: v.muted, rate: v.playbackRate, volume: v.volume, src: v.currentSrc, width: v.videoWidth, height: v.videoHeight, readyState: v.readyState, autoplayBlocked: autoplayBlocked || undefined };
}

async function pageVideoFrames(selector, times, maxSide, quality) {
  const v = selector ? document.querySelector(selector) : document.querySelector("video");
  if (!v) return { ok: false, error: "video not found" };
  const wasPaused = v.paused, was = v.currentTime;
  const frames = [];
  const wait = (ev, ms) => new Promise((r) => { const t = setTimeout(r, ms); v.addEventListener(ev, () => { clearTimeout(t); r(); }, { once: true }); });
  const wasMuted = v.muted;
  if (v.readyState < 2) {
    // Заставить плеер загрузить данные: без жеста пользователя play() с звуком
    // запрещён политикой автовоспроизведения, поэтому глушим и запускаем.
    v.preload = "auto";
    v.muted = true;
    try { await Promise.race([v.play(), new Promise((r) => setTimeout(r, 3000))]); } catch {}
    await wait("loadeddata", 8000);
    v.pause();
  }
  if (v.readyState < 2) {
    v.currentTime = was;
    v.muted = wasMuted;
    return { ok: false, error: "video never loaded data (readyState " + v.readyState + "): blocked source, DRM, or network error", networkState: v.networkState, src: v.currentSrc, mediaError: v.error && v.error.code };
  }
  const dur = isFinite(v.duration) ? v.duration : 0;
  const list = times && times.length ? times : [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.max(0, dur * f));
  const scale = Math.min(1, maxSide / Math.max(v.videoWidth || 1, v.videoHeight || 1));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round((v.videoWidth || 320) * scale));
  c.height = Math.max(1, Math.round((v.videoHeight || 180) * scale));
  const ctx = c.getContext("2d");
  v.pause();
  for (const t of list) {
    v.currentTime = Math.min(t, dur || t);
    await wait("seeked", 4000);
    await new Promise((r) => setTimeout(r, 120));
    try {
      ctx.drawImage(v, 0, 0, c.width, c.height);
      frames.push({ time: Math.round(v.currentTime * 10) / 10, base64: c.toDataURL("image/jpeg", quality).split(",")[1] });
    } catch (e) {
      frames.push({ time: t, error: "canvas tainted (cross-origin video without CORS): " + e.message });
    }
  }
  v.currentTime = was;
  v.muted = wasMuted;
  if (!wasPaused) v.play().catch(() => {});
  return { ok: true, duration: dur, readyState: v.readyState, width: c.width, height: c.height, frames };
}

// ---- students: quizzes, choosing answers, formulas ----
function pageQuizExtract(limit) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const questions = [];
  // radio/checkbox groups
  const groups = {};
  for (const inp of document.querySelectorAll('input[type=radio], input[type=checkbox]')) {
    const key = inp.name || (inp.closest('[role=radiogroup],fieldset,.question,li,form') ? "grp" + questions.length : "g" + Math.random());
    (groups[key] = groups[key] || []).push(inp);
  }
  const labelFor = (inp) => {
    if (inp.id) { const l = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`); if (l) return clean(l.innerText); }
    const l = inp.closest("label"); if (l) return clean(l.innerText);
    const n = inp.nextElementSibling; if (n) return clean(n.innerText);
    return clean(inp.value);
  };
  const questionText = (el) => {
    let node = el.closest('.question, [class*=question], [class*=Question], li, fieldset, [data-testid*=question]');
    if (node) { const legend = node.querySelector('legend, .question-text, [class*=text], p, h3, h4'); if (legend) return clean(legend.innerText).slice(0, 400); return clean(node.innerText).slice(0, 400); }
    return null;
  };
  for (const [name, inputs] of Object.entries(groups)) {
    if (questions.length >= limit) break;
    questions.push({
      type: inputs[0].type,
      name: inputs[0].name || null,
      question: questionText(inputs[0]),
      options: inputs.map((i, idx) => ({ index: idx, label: labelFor(i), value: i.value, checked: i.checked, selector: i.id ? "#" + CSS.escape(i.id) : `input[name="${i.name}"][value="${i.value}"]` })),
    });
  }
  // text/number inputs and textareas that look like answers
  for (const inp of document.querySelectorAll('input[type=text], input[type=number], input:not([type]), textarea')) {
    if (questions.length >= limit) break;
    if (inp.closest('[type=search], nav, header, footer')) continue;
    questions.push({ type: "text", name: inp.name || inp.id || null, question: questionText(inp), current: clean(inp.value), selector: inp.id ? "#" + CSS.escape(inp.id) : (inp.name ? `[name="${inp.name}"]` : null) });
  }
  // <select> questions
  for (const sel of document.querySelectorAll("select")) {
    if (questions.length >= limit) break;
    questions.push({ type: "select", name: sel.name || sel.id || null, question: questionText(sel), options: Array.from(sel.options).map((o) => ({ label: clean(o.text), value: o.value, selected: o.selected })), selector: sel.id ? "#" + CSS.escape(sel.id) : (sel.name ? `[name="${sel.name}"]` : null) });
  }
  return { count: questions.length, questions };
}

function pageChoose(groupSelector, labelText, exact) {
  const scope = groupSelector ? document.querySelector(groupSelector) : document;
  if (!scope) return { ok: false, error: "group not found" };
  const inputs = Array.from(scope.querySelectorAll('input[type=radio], input[type=checkbox]'));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const want = norm(labelText);
  const labelOf = (inp) => {
    if (inp.id) { const l = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`); if (l) return l.innerText; }
    const l = inp.closest("label"); if (l) return l.innerText;
    const n = inp.nextElementSibling; return n ? n.innerText : inp.value;
  };
  let target = inputs.find((i) => exact ? norm(labelOf(i)) === want : norm(labelOf(i)).includes(want));
  if (!target) return { ok: false, error: "option not found", options: inputs.map((i) => norm(labelOf(i))) };
  const lbl = target.closest("label") || (target.id && document.querySelector(`label[for="${CSS.escape(target.id)}"]`)) || target;
  lbl.scrollIntoView({ block: "center" });
  lbl.click();
  if (!target.checked) { target.checked = true; target.dispatchEvent(new Event("input", { bubbles: true })); target.dispatchEvent(new Event("change", { bubbles: true })); }
  return { ok: true, chosen: labelOf(target).replace(/\s+/g, " ").trim(), value: target.value, checked: target.checked };
}

function pageMathExtract() {
  const out = { mathml: [], latex: [], text: [] };
  for (const m of document.querySelectorAll("math")) out.mathml.push(m.outerHTML.slice(0, 4000));
  // MathJax / KaTeX store source in annotations or data attributes
  for (const a of document.querySelectorAll('annotation[encoding*="tex"], annotation[encoding*="TeX"]')) out.latex.push(a.textContent.trim());
  for (const s of document.querySelectorAll("script[type^='math/tex']")) out.latex.push(s.textContent.trim());
  for (const k of document.querySelectorAll(".katex-mathml annotation, mjx-container")) { const t = (k.textContent || "").trim(); if (t) out.text.push(t.slice(0, 500)); }
  // raw $...$ / \(...\) in body text
  const body = (document.body && document.body.innerText) || "";
  const raw = body.match(/\$\$?[^$]{2,200}\$\$?|\\\([^)]{2,200}\\\)|\\\[[^\]]{2,200}\\\]/g);
  if (raw) out.latex.push(...raw.slice(0, 50));
  out.latex = [...new Set(out.latex)];
  return out;
}

// ---- testers: fetch, iframes, storage dump, security ----
async function pageFetch(url, method, headers, body, maxChars) {
  const res = await fetch(url, { method: method || "GET", headers: headers || {}, body: body || undefined, credentials: "include" });
  const h = {}; res.headers.forEach((v, k) => (h[k] = v));
  const text = await res.text();
  return { ok: res.ok, status: res.status, statusText: res.statusText, url: res.url, redirected: res.redirected, headers: h, length: text.length, body: text.slice(0, maxChars), truncated: text.length > maxChars };
}

function pageIframes() {
  return Array.from(document.querySelectorAll("iframe, frame")).map((f, i) => {
    let origin = null; try { origin = new URL(f.src, location.href).origin; } catch {}
    let sameOrigin = false; try { sameOrigin = !!f.contentDocument; } catch {}
    return { index: i, src: f.src || null, name: f.name || f.id || null, origin, sameOrigin, sandbox: f.getAttribute("sandbox"), width: f.clientWidth, height: f.clientHeight, title: f.title || null };
  });
}

function pageStorageDump() {
  const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = String(s.getItem(k)).slice(0, 4000); } return o; };
  return { origin: location.origin, cookiesJS: document.cookie, localStorage: dump(localStorage), sessionStorage: dump(sessionStorage) };
}

async function pageSecurityScan() {
  const metaCSP = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const scripts = Array.from(document.scripts);
  const ext = scripts.filter((s) => s.src);
  const origins = {};
  for (const s of ext) { try { origins[new URL(s.src).origin] = (origins[new URL(s.src).origin] || 0) + 1; } catch {} }
  const forms = Array.from(document.forms).map((f) => ({
    action: f.action, method: (f.method || "get").toUpperCase(),
    hasPassword: !!f.querySelector('input[type=password]'),
    hasFileUpload: !!f.querySelector('input[type=file]'),
    csrfTokenField: !!f.querySelector('input[type=hidden][name*=csrf i], input[type=hidden][name*=token i], input[type=hidden][name*=_token]'),
    httpsAction: /^https:/i.test(f.action) || f.action.startsWith("/") || f.action.startsWith(location.origin),
  }));
  const mixed = Array.from(document.querySelectorAll('[src], [href]')).map((e) => e.src || e.href).filter((u) => location.protocol === "https:" && /^http:\/\//i.test(u || "")).slice(0, 50);
  let respHeaders = {};
  try { const r = await fetch(location.href, { method: "GET", credentials: "include" }); r.headers.forEach((v, k) => (respHeaders[k] = v)); } catch {}
  const secHeaders = {};
  for (const k of ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy"]) secHeaders[k] = respHeaders[k] || null;
  return {
    url: location.href, protocol: location.protocol,
    csp: { header: secHeaders["content-security-policy"], meta: metaCSP ? metaCSP.content : null },
    securityHeaders: secHeaders,
    scripts: { total: scripts.length, external: ext.length, inline: scripts.length - ext.length, externalOrigins: origins },
    forms, mixedContent: mixed,
    passwordFieldsOutsideHttps: location.protocol !== "https:" && !!document.querySelector('input[type=password]'),
    cookiesVisibleToJS: document.cookie ? document.cookie.split(";").length : 0,
  };
}

function pageOutline() {
  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) => ({ level: +h.tagName[1], text: (h.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200), id: h.id || null }));
  const landmarks = Array.from(document.querySelectorAll("header,nav,main,aside,footer,section[aria-label],[role=main],[role=navigation],[role=search]")).map((e) => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute("role"), label: e.getAttribute("aria-label") || null }));
  const counts = { images: document.images.length, links: document.links.length, forms: document.forms.length, iframes: document.querySelectorAll("iframe").length, videos: document.querySelectorAll("video").length, tables: document.querySelectorAll("table").length, buttons: document.querySelectorAll("button, [role=button]").length };
  return { title: document.title, url: location.href, headings, landmarks, counts };
}

function pageCollectCode() {
  const inlineScripts = Array.from(document.querySelectorAll("script:not([src])")).map((s) => s.textContent).filter((t) => t && t.trim());
  const extScripts = Array.from(document.querySelectorAll("script[src]")).map((s) => s.src);
  const inlineStyles = Array.from(document.querySelectorAll("style")).map((s) => s.textContent);
  const extStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.href);
  return { html: document.documentElement.outerHTML, inlineScripts, extScripts, inlineStyles, extStyles };
}

// ================================================================ STUDENTS batch
const _clean = (s) => (s || "").replace(/\s+/g, " ").trim();
function _findByAny(sel) { return sel ? (document.querySelector(sel) || document.querySelector(`[name="${sel}"]`) || document.getElementById(sel)) : null; }

function pageQuizAnswerAll(answers) {
  const report = [];
  for (const a of answers) {
    try {
      if (a.label != null) { const r = pageChoose(a.group || null, a.label, !!a.exact); report.push({ q: a.group || a.label, ...r }); continue; }
      const el = _findByAny(a.selector || a.name);
      if (!el) { report.push({ q: a.selector || a.name, ok: false, error: "not found" }); continue; }
      if (el.tagName === "SELECT") { const o = Array.from(el.options).find((x) => x.value === a.value || _clean(x.text) === _clean(a.value) || _clean(x.text).includes(_clean(a.value))); if (o) { el.value = o.value; el.dispatchEvent(new Event("change", { bubbles: true })); report.push({ q: a.selector, ok: true, value: o.value }); } else report.push({ q: a.selector, ok: false, error: "option not found" }); }
      else if (el.type === "checkbox" || el.type === "radio") { el.checked = a.value === false ? false : true; el.dispatchEvent(new Event("change", { bubbles: true })); report.push({ q: a.selector, ok: true, checked: el.checked }); }
      else { el.focus(); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const d = Object.getOwnPropertyDescriptor(proto, "value"); if (d && d.set) d.set.call(el, a.value); else el.value = a.value; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); report.push({ q: a.selector, ok: true, value: String(a.value).slice(0, 60) }); }
    } catch (e) { report.push({ q: a.selector || a.name, ok: false, error: e.message }); }
  }
  return { applied: report.filter((r) => r.ok).length, total: answers.length, report };
}

function pageClickByText(patterns, role) {
  const norm = (s) => _clean(s).toLowerCase();
  const cands = Array.from(document.querySelectorAll(role === "link" ? "a" : "button, input[type=submit], input[type=button], a, [role=button], [role=menuitem], [role=tab]"));
  const pats = patterns.map((p) => norm(p));
  for (const el of cands) {
    const t = norm(el.innerText || el.value || el.getAttribute("aria-label") || el.title);
    if (pats.some((p) => t === p || t.includes(p))) { el.scrollIntoView({ block: "center" }); el.click(); return { ok: true, text: _clean(el.innerText || el.value), tag: el.tagName.toLowerCase() }; }
  }
  return { ok: false, error: "no button matched", tried: patterns };
}

function pageFlashcards(limit) {
  const cards = [];
  const pairSelectors = [[".term", ".definition"], ["[class*=term]", "[class*=definition]"], ["dt", "dd"], ["[class*=front]", "[class*=back]"], ["[class*=question]", "[class*=answer]"]];
  for (const [fs, bs] of pairSelectors) {
    const fronts = document.querySelectorAll(fs), backs = document.querySelectorAll(bs);
    if (fronts.length && fronts.length === backs.length) { for (let i = 0; i < Math.min(fronts.length, limit); i++) cards.push({ front: _clean(fronts[i].innerText), back: _clean(backs[i].innerText) }); if (cards.length) return { source: fs + "/" + bs, count: cards.length, cards }; }
  }
  return { count: 0, cards: [] };
}

function pageEssayWrite(selector, text, append) {
  const el = _findByAny(selector) || document.querySelector("textarea, [contenteditable=true]");
  if (!el) return { ok: false, error: "no text field" };
  el.focus();
  if (el.isContentEditable) { if (!append) el.textContent = ""; document.execCommand("insertText", false, text); }
  else { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const d = Object.getOwnPropertyDescriptor(proto, "value"); const cur = append ? el.value : ""; if (d && d.set) d.set.call(el, cur + text); else el.value = cur + text; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
  const val = el.isContentEditable ? el.textContent : el.value;
  return { ok: true, words: (val.match(/\S+/g) || []).length, chars: val.length };
}

function pageWordCount(selector) {
  const el = _findByAny(selector) || document.querySelector("textarea, [contenteditable=true]");
  const txt = el ? (el.isContentEditable ? el.textContent : el.value) : ((document.body && document.body.innerText) || "");
  const words = (txt.match(/\S+/g) || []).length;
  return { words, chars: txt.length, sentences: (txt.match(/[.!?]+/g) || []).length, paragraphs: txt.split(/\n\s*\n/).filter((p) => p.trim()).length };
}

function pageFillBlanks(values) {
  const inputs = Array.from(document.querySelectorAll('input[type=text], input:not([type]), input[type=number], textarea')).filter((e) => !e.closest("nav,header,footer") && e.offsetParent !== null);
  let n = 0;
  for (let i = 0; i < Math.min(values.length, inputs.length); i++) { const el = inputs[i]; el.focus(); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const d = Object.getOwnPropertyDescriptor(proto, "value"); if (d && d.set) d.set.call(el, values[i]); else el.value = values[i]; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); n++; }
  return { filled: n, fields: inputs.length };
}

function pageSetRange(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, error: "not found" };
  const proto = HTMLInputElement.prototype; const d = Object.getOwnPropertyDescriptor(proto, "value"); if (d && d.set) d.set.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: el.value, min: el.min, max: el.max };
}

function pageDragDrop(fromSel, toSel) {
  const from = document.querySelector(fromSel), to = document.querySelector(toSel);
  if (!from || !to) return { ok: false, error: "from/to not found" };
  const dt = new DataTransfer();
  const rectF = from.getBoundingClientRect(), rectT = to.getBoundingClientRect();
  const opt = (el, r) => ({ bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
  from.dispatchEvent(new DragEvent("dragstart", opt(from, rectF)));
  to.dispatchEvent(new DragEvent("dragenter", opt(to, rectT)));
  to.dispatchEvent(new DragEvent("dragover", opt(to, rectT)));
  to.dispatchEvent(new DragEvent("drop", opt(to, rectT)));
  from.dispatchEvent(new DragEvent("dragend", opt(to, rectT)));
  return { ok: true };
}

function pageReorder(containerSel, order) {
  const c = document.querySelector(containerSel);
  if (!c) return { ok: false, error: "container not found" };
  const items = Array.from(c.children);
  for (const idx of order) { if (items[idx]) c.appendChild(items[idx]); }
  return { ok: true, count: order.length };
}

function pageCodeEditorGet(selector) {
  // Monaco
  if (window.monaco && window.monaco.editor) { const eds = window.monaco.editor.getEditors ? window.monaco.editor.getEditors() : []; if (eds.length) return { editor: "monaco", value: eds[0].getValue() }; }
  // CodeMirror 5/6
  const cm5 = document.querySelector(".CodeMirror"); if (cm5 && cm5.CodeMirror) return { editor: "codemirror5", value: cm5.CodeMirror.getValue() };
  const cm6 = document.querySelector(".cm-content"); if (cm6) return { editor: "codemirror6", value: cm6.innerText };
  // Ace
  if (window.ace) { const el = document.querySelector(".ace_editor"); if (el && window.ace.edit) { try { return { editor: "ace", value: window.ace.edit(el).getValue() }; } catch {} } }
  const ta = _findByAny(selector) || document.querySelector("textarea");
  if (ta) return { editor: "textarea", value: ta.value };
  return { editor: null, value: null };
}

function pageCodeEditorSet(selector, code) {
  if (window.monaco && window.monaco.editor) { const eds = window.monaco.editor.getEditors ? window.monaco.editor.getEditors() : []; if (eds.length) { eds[0].setValue(code); return { ok: true, editor: "monaco" }; } }
  const cm5 = document.querySelector(".CodeMirror"); if (cm5 && cm5.CodeMirror) { cm5.CodeMirror.setValue(code); return { ok: true, editor: "codemirror5" }; }
  if (window.ace) { const el = document.querySelector(".ace_editor"); if (el && window.ace.edit) { try { window.ace.edit(el).setValue(code); return { ok: true, editor: "ace" }; } catch {} } }
  const ta = _findByAny(selector) || document.querySelector("textarea");
  if (ta) { ta.focus(); const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value"); d.set.call(ta, code); ta.dispatchEvent(new Event("input", { bubbles: true })); return { ok: true, editor: "textarea" }; }
  return { ok: false, error: "no code editor found" };
}

function pageReadTimer() {
  const re = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/;
  for (const el of document.querySelectorAll('[class*=timer i], [class*=countdown i], [id*=timer i], time, [class*=clock i]')) { const m = (el.innerText || "").match(re); if (m) return { found: true, text: _clean(el.innerText), selector: el.id ? "#" + el.id : el.className }; }
  const bm = ((document.body && document.body.innerText) || "").match(re);
  return bm ? { found: true, text: bm[0], source: "body" } : { found: false };
}

function pageProgress() {
  const out = [];
  for (const p of document.querySelectorAll("progress")) out.push({ type: "progress", value: p.value, max: p.max, percent: p.max ? Math.round((p.value / p.max) * 100) : null });
  for (const el of document.querySelectorAll('[role=progressbar]')) out.push({ type: "aria", now: el.getAttribute("aria-valuenow"), max: el.getAttribute("aria-valuemax"), text: _clean(el.getAttribute("aria-valuetext") || el.innerText) });
  return { bars: out };
}

function pageCaptions() {
  const out = [];
  for (const v of document.querySelectorAll("video")) {
    for (const track of v.textTracks || []) { const cues = []; for (const c of track.cues || []) cues.push({ start: Math.round(c.startTime), text: c.text }); if (cues.length) out.push({ label: track.label, lang: track.language, kind: track.kind, cues: cues.slice(0, 1000) }); }
    const tracks = Array.from(v.querySelectorAll("track")).map((t) => ({ src: t.src, label: t.label, lang: t.srclang, kind: t.kind }));
    if (tracks.length) out.push({ trackElements: tracks });
  }
  return { videos: document.querySelectorAll("video").length, captions: out };
}

function pageDefinitions() {
  const defs = [];
  for (const dl of document.querySelectorAll("dl")) { const dts = dl.querySelectorAll("dt"), dds = dl.querySelectorAll("dd"); for (let i = 0; i < Math.min(dts.length, dds.length); i++) defs.push({ term: _clean(dts[i].innerText), definition: _clean(dds[i].innerText) }); }
  return { count: defs.length, definitions: defs };
}

function pageRequiredFields() {
  const req = Array.from(document.querySelectorAll("[required], [aria-required=true]")).map((el) => ({ tag: el.tagName.toLowerCase(), type: el.type, name: el.name || el.id, empty: !el.value, valid: el.checkValidity ? el.checkValidity() : null, label: (el.labels && el.labels[0] && _clean(el.labels[0].innerText)) || null }));
  return { required: req.length, empty: req.filter((r) => r.empty).length, fields: req };
}

function pageFormValidate(selector) {
  const forms = selector ? [document.querySelector(selector)].filter(Boolean) : Array.from(document.forms);
  return forms.map((f, i) => ({ index: i, valid: f.checkValidity(), invalid: Array.from(f.elements).filter((e) => e.checkValidity && !e.checkValidity()).map((e) => ({ name: e.name || e.id, type: e.type, message: e.validationMessage })) }));
}

function pageAnswerKeyScan() {
  // Look for correct answers accidentally exposed in DOM (data-* attrs, JS vars) — for self-checking.
  const hits = [];
  for (const el of document.querySelectorAll("*")) {
    for (const at of el.attributes || []) { if (/answer|correct|solution|iscorrect/i.test(at.name) && at.value && at.value.length < 200) { hits.push({ selector: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""), attr: at.name, value: at.value }); if (hits.length >= 100) break; } }
    if (hits.length >= 100) break;
  }
  return { found: hits.length, hits };
}

// ================================================================ TESTERS batch
function pageTechDetect() {
  const w = window, found = [];
  const checks = { jQuery: () => w.jQuery && w.jQuery.fn && w.jQuery.fn.jquery, React: () => (w.React && w.React.version) || (document.querySelector("[data-reactroot],#root [data-reactid]") && "detected"), Vue: () => (w.Vue && w.Vue.version) || (document.querySelector("[data-v-app],#app.__vue__") && "detected"), Angular: () => (w.ng && "detected") || (w.getAllAngularRootElements && "detected"), Svelte: () => document.querySelector("[class*=svelte-]") && "detected", Next: () => (w.__NEXT_DATA__ && "detected"), Nuxt: () => (w.__NUXT__ && "detected"), Bootstrap: () => (w.bootstrap && "detected") || (document.querySelector('[class*="col-md-"],.navbar') && "css"), Tailwind: () => document.querySelector('[class*="flex "],[class~="px-4"]') && "css", Lodash: () => w._ && w._.VERSION, GSAP: () => w.gsap && "detected", ThreeJS: () => w.THREE && (w.THREE.REVISION || "detected"), Wordpress: () => document.querySelector('meta[name=generator][content*=WordPress]') && "detected", Shopify: () => w.Shopify && "detected", GoogleAnalytics: () => (w.gtag || w.ga || w.dataLayer) && "detected", Cloudflare: () => document.querySelector('script[src*=cloudflare]') && "detected", jsDelivr: () => document.querySelector('script[src*=jsdelivr]') && "detected" };
  for (const [name, fn] of Object.entries(checks)) { try { const v = fn(); if (v) found.push({ name, version: typeof v === "string" ? v : true }); } catch {} }
  const generator = document.querySelector("meta[name=generator]");
  return { technologies: found, generator: generator ? generator.content : null, poweredBy: null };
}

function pageGlobalsList() {
  const base = new Set(["window", "self", "document", "location", "top", "parent", "frames", "navigator", "localStorage", "sessionStorage", "console", "history", "screen"]);
  const globals = Object.keys(window).filter((k) => !base.has(k) && !/^(webkit|chrome|__)/i.test(k) && typeof window[k] !== "undefined").slice(0, 300);
  const byType = {};
  for (const k of globals) { const ty = typeof window[k]; (byType[ty] = byType[ty] || []).push(k); }
  return { count: globals.length, byType };
}

function pageComments(limit) {
  const out = [];
  const walk = (node) => { for (const n of node.childNodes) { if (n.nodeType === 8) { const t = n.nodeValue.trim(); if (t) out.push(t.slice(0, 300)); } else if (n.nodeType === 1 && n.tagName !== "SCRIPT") walk(n); if (out.length >= limit) return; } };
  walk(document.documentElement);
  return { count: out.length, comments: out };
}

function pageHiddenInputs() {
  const hidden = Array.from(document.querySelectorAll('input[type=hidden]')).map((i) => ({ name: i.name, value: String(i.value).slice(0, 200), form: i.form ? (i.form.id || i.form.name || i.form.action) : null }));
  return { count: hidden.length, inputs: hidden };
}

function pageInlineHandlers() {
  const out = [];
  for (const el of document.querySelectorAll("*")) { for (const at of el.attributes || []) { if (/^on/i.test(at.name)) { out.push({ selector: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""), event: at.name, code: at.value.slice(0, 200) }); if (out.length >= 200) break; } } if (out.length >= 200) break; }
  return { count: out.length, handlers: out, note: "inline event handlers are potential XSS/DOM sinks — review" };
}

function pageCookieAudit() {
  const jsCookies = document.cookie ? document.cookie.split(";").map((c) => c.split("=")[0].trim()) : [];
  return { visibleToJS: jsCookies, jsAccessibleCount: jsCookies.length, note: "cookies visible to JS lack HttpOnly; check flags via browser_storage_dump" };
}

function pageSecretsScan() {
  const patterns = [
    { name: "AWS Access Key", re: /AKIA[0-9A-Z]{16}/g },
    { name: "Google API Key", re: /AIza[0-9A-Za-z\-_]{35}/g },
    { name: "JWT", re: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g },
    { name: "Slack Token", re: /xox[baprs]-[0-9A-Za-z\-]{10,}/g },
    { name: "Bearer token", re: /[Bb]earer\s+[A-Za-z0-9\-_.=]{20,}/g },
    { name: "Private key", re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
    { name: "Generic api_key", re: /['"]?(?:api[_-]?key|apikey|secret|token|password)['"]?\s*[:=]\s*['"][A-Za-z0-9\-_.]{12,}['"]/gi },
  ];
  const hay = [document.documentElement.outerHTML, JSON.stringify(localStorage), JSON.stringify(sessionStorage), document.cookie].join("\n");
  const hits = [];
  for (const p of patterns) { const m = hay.match(p.re); if (m) hits.push({ type: p.name, count: m.length, samples: [...new Set(m)].slice(0, 3).map((s) => s.slice(0, 40) + "…") }); }
  return { findings: hits.length, hits, note: "possible secrets exposed to the client — verify (authorized testing)" };
}

function pageLinksClassify() {
  const origin = location.origin;
  const groups = { internal: [], external: [], mailto: [], tel: [], anchor: [], js: [] };
  for (const a of document.querySelectorAll("a[href]")) { const h = a.href; if (h.startsWith("mailto:")) groups.mailto.push(h); else if (h.startsWith("tel:")) groups.tel.push(h); else if (h.startsWith("javascript:")) groups.js.push(h.slice(0, 80)); else if (h.includes("#") && h.split("#")[0] === location.href.split("#")[0]) groups.anchor.push(h); else if (h.startsWith(origin)) groups.internal.push(h); else if (/^https?:/.test(h)) groups.external.push(h); }
  const uniq = (x) => [...new Set(x)];
  return { internal: uniq(groups.internal).length, external: uniq(groups.external).length, mailto: uniq(groups.mailto), tel: uniq(groups.tel), anchors: groups.anchor.length, javascriptLinks: groups.js, externalUrls: uniq(groups.external).slice(0, 100), externalOrigins: uniq(groups.external.map((u) => { try { return new URL(u).origin; } catch { return u; } })) };
}

function pageParams() {
  const url = new URLSearchParams(location.search);
  const params = {}; for (const [k, v] of url) params[k] = v;
  const formParams = Array.from(document.querySelectorAll("input[name], select[name], textarea[name]")).map((e) => ({ name: e.name, type: e.type || e.tagName.toLowerCase(), form: e.form ? (e.form.action || e.form.id) : null }));
  return { urlParams: params, hash: location.hash, formParams };
}

function pagePerf() {
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const res = performance.getEntriesByType("resource");
  const byType = {}; let total = 0;
  for (const r of res) { const ty = r.initiatorType || "other"; byType[ty] = (byType[ty] || 0) + 1; total += r.transferSize || 0; }
  const largest = res.map((r) => ({ url: r.name.slice(0, 120), type: r.initiatorType, size: r.transferSize, ms: Math.round(r.duration) })).sort((a, b) => b.size - a.size).slice(0, 15);
  return { ttfbMs: nav.responseStart ? Math.round(nav.responseStart) : null, domContentLoadedMs: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null, loadMs: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null, protocol: nav.nextHopProtocol, resources: res.length, byType, transferBytes: total, largest };
}

function pageThirdParty() {
  const origin = location.origin;
  const res = performance.getEntriesByType("resource");
  const origins = {};
  for (const r of res) { try { const o = new URL(r.name).origin; if (o !== origin) origins[o] = (origins[o] || 0) + 1; } catch {} }
  const trackers = { "google-analytics.com": "Google Analytics", "googletagmanager.com": "Google Tag Manager", "doubleclick.net": "Google Ads", "facebook.net": "Facebook Pixel", "connect.facebook.net": "Facebook", "hotjar.com": "Hotjar", "mc.yandex.ru": "Yandex Metrica", "mail.ru": "Mail.ru", "vk.com": "VK", "amplitude.com": "Amplitude", "segment.com": "Segment", "sentry.io": "Sentry", "cloudflareinsights.com": "Cloudflare" };
  const detected = [];
  for (const o of Object.keys(origins)) for (const [dom, name] of Object.entries(trackers)) if (o.includes(dom)) detected.push({ origin: o, tracker: name, requests: origins[o] });
  return { thirdPartyOrigins: Object.entries(origins).map(([o, n]) => ({ origin: o, requests: n })).sort((a, b) => b.requests - a.requests), trackers: detected };
}

function pageSourceMaps() {
  const maps = [];
  for (const s of document.querySelectorAll("script[src]")) maps.push(s.src);
  const refs = Array.from(document.scripts).map((s) => s.textContent).join("\n").match(/sourceMappingURL=([^\s*]+)/g) || [];
  return { scriptUrls: maps.slice(0, 100), sourceMapRefs: refs.slice(0, 50), note: "check if .map files are publicly served (source disclosure)" };
}

function pageSriAudit() {
  const ext = Array.from(document.querySelectorAll('script[src], link[rel=stylesheet][href]'));
  const noSri = ext.filter((e) => { const u = e.src || e.href; try { return new URL(u).origin !== location.origin && !e.integrity; } catch { return false; } }).map((e) => e.src || e.href);
  return { externalResources: ext.length, withoutSRI: noSri.length, urls: noSri.slice(0, 50), note: "third-party resources without Subresource Integrity" };
}

function pageIframeAudit() {
  return Array.from(document.querySelectorAll("iframe")).map((f) => ({ src: f.src, sandbox: f.getAttribute("sandbox"), hasSandbox: f.hasAttribute("sandbox"), allow: f.getAttribute("allow"), crossOrigin: (() => { try { return new URL(f.src, location.href).origin !== location.origin; } catch { return null; } })() }));
}

function pageCookieConsent() {
  const sels = ['[class*=cookie i]', '[id*=cookie i]', '[class*=consent i]', '[id*=consent i]', '[class*=gdpr i]', '[aria-label*=cookie i]'];
  for (const s of sels) { const el = document.querySelector(s); if (el && el.offsetParent) return { present: true, selector: s, text: _clean(el.innerText).slice(0, 200) }; }
  return { present: false };
}

function pageHiddenElements(limit) {
  const out = [];
  for (const el of document.querySelectorAll("*")) { const st = getComputedStyle(el); if ((st.display === "none" || st.visibility === "hidden" || el.hidden) && (el.innerText || "").trim().length > 3 && el.children.length < 5) { out.push({ tag: el.tagName.toLowerCase(), id: el.id || null, text: _clean(el.innerText).slice(0, 120) }); if (out.length >= limit) break; } }
  return { count: out.length, elements: out };
}

// ================================================================ USER batch (extract / summarize / productivity)
function pagePatterns(kind, limit) {
  const text = (document.body && document.body.innerText) || "";
  const html = document.documentElement.outerHTML;
  const uniq = (a) => [...new Set(a)].slice(0, limit);
  const RE = {
    emails: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    phones: /(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{2,4}\)[\s.\-]?)?\d{2,4}[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}/g,
    urls: /https?:\/\/[^\s"'<>)]+/g,
    dates: /\b(?:\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4}|\d{4}[.\/\-]\d{1,2}[.\/\-]\d{1,2}|(?:\d{1,2}\s)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек)[a-zа-я]*\.?\s?\d{0,4})\b/gi,
    prices: /(?:[$€£¥₽]|USD|EUR|RUB|руб\.?|₴)\s?\d[\d\s.,]*\d|\d[\d\s.,]*\d\s?(?:[$€£¥₽]|руб\.?|₽)/g,
    hashtags: /#[A-Za-zА-Яа-я0-9_]+/g,
    mentions: /@[A-Za-z0-9_.]+/g,
    numbers: /\b\d[\d\s.,]{2,}\b/g,
    ips: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  };
  const src = kind === "urls" ? html : text;
  const m = (src.match(RE[kind]) || []).map((s) => s.trim()).filter((s) => s.length > (kind === "numbers" ? 2 : 3));
  return { kind, count: [...new Set(m)].length, matches: uniq(m) };
}

function pageSocialLinks() {
  const nets = { facebook: /facebook\.com/, twitter: /twitter\.com|x\.com/, instagram: /instagram\.com/, youtube: /youtube\.com|youtu\.be/, telegram: /t\.me|telegram/, vk: /vk\.com/, linkedin: /linkedin\.com/, tiktok: /tiktok\.com/, github: /github\.com/, discord: /discord\.(gg|com)/, whatsapp: /wa\.me|whatsapp/, ok: /ok\.ru/, dzen: /dzen\.ru/, pinterest: /pinterest/, reddit: /reddit\.com/ };
  const out = {};
  for (const a of document.querySelectorAll("a[href]")) { for (const [name, re] of Object.entries(nets)) { if (re.test(a.href) && !out[name]) out[name] = a.href; } }
  return { count: Object.keys(out).length, social: out };
}

function pageSummaryData() {
  const meta = (n) => { const el = document.querySelector(`meta[name="${n}"], meta[property="${n}"]`); return el ? el.content : null; };
  const paras = Array.from(document.querySelectorAll("article p, main p, p")).map((p) => _clean(p.innerText)).filter((t) => t.length > 60).slice(0, 8);
  return { title: document.title, url: location.href, description: meta("description") || meta("og:description"), author: meta("author") || meta("article:author"), published: meta("article:published_time") || meta("date"), headings: Array.from(document.querySelectorAll("h1,h2,h3")).slice(0, 30).map((h) => ({ level: +h.tagName[1], text: _clean(h.innerText).slice(0, 150) })), firstParagraphs: paras, keywords: (meta("keywords") || "").split(",").map((k) => k.trim()).filter(Boolean) };
}

function pageToc() {
  return { toc: Array.from(document.querySelectorAll("h1,h2,h3,h4")).map((h) => ({ level: +h.tagName[1], text: _clean(h.innerText).slice(0, 200), id: h.id || null, anchor: h.id ? "#" + h.id : null })) };
}

function pageSchemaExtract(type) {
  const jsonld = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { const j = JSON.parse(s.textContent); const items = Array.isArray(j) ? j : (j["@graph"] || [j]); for (const it of items) { if (!type || (it["@type"] && String(it["@type"]).toLowerCase().includes(type.toLowerCase()))) jsonld.push(it); } } catch {} }
  const microdata = [];
  for (const el of document.querySelectorAll("[itemscope]")) { if (el.closest("[itemscope] [itemscope]")) continue; const it = { "@type": el.getAttribute("itemtype") }; for (const p of el.querySelectorAll("[itemprop]")) { if (p.closest("[itemscope] [itemscope]") !== el.closest("[itemscope]")) {} it[p.getAttribute("itemprop")] = _clean(p.getAttribute("content") || p.getAttribute("datetime") || p.href || p.src || p.innerText).slice(0, 300); } if (!type || (it["@type"] || "").toLowerCase().includes(type.toLowerCase())) microdata.push(it); }
  return { jsonld, microdata, count: jsonld.length + microdata.length };
}

function pageLists() {
  return Array.from(document.querySelectorAll("ul,ol")).filter((l) => l.children.length >= 2 && !l.closest("nav,header,footer")).slice(0, 30).map((l, i) => ({ index: i, type: l.tagName.toLowerCase(), items: Array.from(l.children).map((li) => _clean(li.innerText)).filter(Boolean).slice(0, 100) }));
}

function pageQuotes() { return { quotes: Array.from(document.querySelectorAll("blockquote,q,[class*=quote i]")).map((q) => _clean(q.innerText)).filter((t) => t.length > 10).slice(0, 100) }; }
function pageCodeBlocks() { return { blocks: Array.from(document.querySelectorAll("pre,code")).filter((c) => c.tagName === "PRE" || !c.closest("pre")).map((c) => ({ lang: (c.className.match(/language-(\w+)/) || [])[1] || (c.getAttribute("class") || "").match(/\b(js|python|java|cpp|html|css|sql|bash|json)\b/i)?.[0] || null, code: c.innerText.slice(0, 5000) })).filter((b) => b.code.trim().length > 5).slice(0, 50) }; }
function pageCitations() { return { citations: Array.from(document.querySelectorAll("cite, .reference, .citation, [class*=ref i] li, ol.references li, #references li")).map((c) => _clean(c.innerText)).filter((t) => t.length > 10).slice(0, 200) }; }
function pageBreadcrumbs() { const bc = document.querySelector('[class*=breadcrumb i], nav[aria-label*=breadcrumb i], [itemtype*=BreadcrumbList]'); if (!bc) return { found: false }; return { found: true, items: Array.from(bc.querySelectorAll("a,li,span")).map((e) => _clean(e.innerText)).filter(Boolean) }; }
function pagePagination() { const links = {}; for (const a of document.querySelectorAll("a[rel=next],a[rel=prev],a[class*=next i],a[class*=prev i],[class*=pagination i] a")) { const rel = a.rel || (/(next|далее|›|»)/i.test(a.innerText) ? "next" : /(prev|назад|‹|«)/i.test(a.innerText) ? "prev" : null); if (rel === "next" && !links.next) links.next = a.href; if (rel === "prev" && !links.prev) links.prev = a.href; } return links; }
function pageRssFind() { return { feeds: Array.from(document.querySelectorAll('link[type="application/rss+xml"],link[type="application/atom+xml"]')).map((l) => ({ title: l.title, href: l.href })) }; }
function pageAuthor() { const meta = (n) => { const el = document.querySelector(`meta[name="${n}"],meta[property="${n}"]`); return el ? el.content : null; }; const el = document.querySelector('[rel=author],[itemprop=author],.author,.byline,[class*=author i]'); return { author: meta("author") || meta("article:author") || (el ? _clean(el.innerText).slice(0, 120) : null) }; }
function pagePublishDate() { const meta = (n) => { const el = document.querySelector(`meta[property="${n}"],meta[name="${n}"]`); return el ? el.content : null; }; const time = document.querySelector("time[datetime]"); return { published: meta("article:published_time") || meta("date") || meta("dc.date") || (time ? time.getAttribute("datetime") : null), modified: meta("article:modified_time") }; }
function pageMainImage() { const meta = (n) => { const el = document.querySelector(`meta[property="${n}"],meta[name="${n}"]`); return el ? el.content : null; }; let img = meta("og:image") || meta("twitter:image"); if (!img) { const biggest = Array.from(document.images).sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))[0]; img = biggest ? biggest.src : null; } return { mainImage: img }; }
function pageImageAlts() { return { images: Array.from(document.images).map((i) => ({ src: i.src, alt: i.alt || null, hasAlt: !!i.alt })).slice(0, 300), missingAlt: Array.from(document.images).filter((i) => !i.alt).length }; }
function pageFaq() { const out = []; for (const d of document.querySelectorAll("details")) { const s = d.querySelector("summary"); if (s) out.push({ q: _clean(s.innerText), a: _clean(d.innerText.replace(s.innerText, "")) }); } for (const el of document.querySelectorAll('[class*=faq i] [class*=question i]')) { const ans = el.nextElementSibling; if (ans) out.push({ q: _clean(el.innerText), a: _clean(ans.innerText) }); } return { count: out.length, faq: out.slice(0, 100) }; }
function pageParagraphs(min) { return { paragraphs: Array.from(document.querySelectorAll("article p, main p, p")).map((p) => _clean(p.innerText)).filter((t) => t.length >= (min || 40)).slice(0, 300) }; }
function pageHeadings() { return { headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) => ({ level: +h.tagName[1], text: _clean(h.innerText) })) }; }
function pageWordFreq(top, minLen) {
  const stop = new Set("the a an and or of to in on for with at by from is are was were be been being this that these those it its as but not no yes you your we our they their he she his her i me my и в во не на что он но а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас".split(/\s+/));
  const words = ((document.body && document.body.innerText) || "").toLowerCase().match(/[a-zа-яё]{3,}/gi) || [];
  const freq = {}; for (const w of words) { if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1; }
  const sorted = Object.entries(freq).filter(([w]) => w.length >= (minLen || 3)).sort((a, b) => b[1] - a[1]).slice(0, top || 40);
  return { totalWords: words.length, top: sorted.map(([word, count]) => ({ word, count })) };
}
function pageReadingTime() { const words = ((document.body && document.body.innerText) || "").match(/\S+/g) || []; return { words: words.length, minutesAt200wpm: Math.max(1, Math.round(words.length / 200)), minutesAt130wpm: Math.max(1, Math.round(words.length / 130)) }; }
function pageLangDetect() { const t = ((document.body && document.body.innerText) || "").slice(0, 3000); const cyr = (t.match(/[а-яё]/gi) || []).length; const lat = (t.match(/[a-z]/gi) || []).length; return { htmlLang: document.documentElement.lang || null, guess: cyr > lat ? "ru" : "en", cyrillicRatio: Math.round((cyr / (cyr + lat + 1)) * 100) }; }
function pageReaderView(maxChars) {
  let best = document.querySelector("article, main, [role=main]") || document.body;
  const clone = best.cloneNode(true);
  for (const el of clone.querySelectorAll("script,style,nav,aside,footer,header,form,iframe,noscript,[aria-hidden=true],.ad,[class*=ad-],[class*=banner],[class*=share],[class*=related],[class*=comment]")) el.remove();
  const parts = [];
  for (const el of clone.querySelectorAll("h1,h2,h3,p,li,blockquote,pre")) { const t = _clean(el.innerText); if (t.length > 2) parts.push((el.tagName[0] === "H" ? "\n## " : el.tagName === "LI" ? "- " : "") + t); }
  const text = parts.join("\n\n");
  return { title: (document.querySelector("h1") || {}).innerText || document.title, length: text.length, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}
function pageMarkdown(maxChars) {
  let root = document.querySelector("article, main, [role=main]") || document.body;
  const md = [];
  const walk = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { const t = n.nodeValue.replace(/\s+/g, " "); if (t.trim()) md.push(t); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (["script", "style", "nav", "footer", "header", "aside", "noscript"].includes(tag)) continue;
      if (/^h[1-6]$/.test(tag)) { md.push("\n\n" + "#".repeat(+tag[1]) + " " + _clean(n.innerText) + "\n"); continue; }
      if (tag === "p") { md.push("\n\n" + _clean(n.innerText) + "\n"); continue; }
      if (tag === "li") { md.push("\n- " + _clean(n.innerText)); continue; }
      if (tag === "a" && n.href) { md.push(`[${_clean(n.innerText)}](${n.href})`); continue; }
      if (tag === "img") { md.push(`![${n.alt || ""}](${n.src})`); continue; }
      if (tag === "pre") { md.push("\n\n```\n" + n.innerText + "\n```\n"); continue; }
      if (tag === "strong" || tag === "b") { md.push("**" + _clean(n.innerText) + "**"); continue; }
      if (tag === "blockquote") { md.push("\n> " + _clean(n.innerText) + "\n"); continue; }
      walk(n);
    }
  };
  walk(root);
  const text = md.join(" ").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
  return { markdown: text.slice(0, maxChars), length: text.length, truncated: text.length > maxChars };
}
function pageReviews() { const s = pageSchemaExtract("review"); const ratings = Array.from(document.querySelectorAll('[itemprop=ratingValue],[class*=rating i],[class*=stars i]')).map((e) => _clean(e.getAttribute("content") || e.innerText)).filter(Boolean).slice(0, 30); return { schemaReviews: s.jsonld.concat(s.microdata), ratingsOnPage: ratings }; }
function pageLoginDetect() { const pw = document.querySelector("input[type=password]"); const form = pw ? pw.closest("form") : null; return { hasLogin: !!pw, action: form ? form.action : null, method: form ? form.method : null, fields: form ? Array.from(form.querySelectorAll("input")).map((i) => ({ name: i.name, type: i.type })) : [] }; }
function pageNewsletterDetect() { for (const f of document.forms) { if (f.querySelector('input[type=email]') && /subscribe|newsletter|подпис|рассыл/i.test(f.innerText + f.className + f.action)) return { present: true, action: f.action }; } return { present: false }; }
function pageSearchOnPage(query) { const inp = document.querySelector('input[type=search], input[name*=search i], input[name=q], input[placeholder*=search i], input[placeholder*=поиск i]'); if (!inp) return { ok: false, error: "no search box" }; inp.focus(); const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"); d.set.call(inp, query); inp.dispatchEvent(new Event("input", { bubbles: true })); const form = inp.closest("form"); if (form) { form.requestSubmit ? form.requestSubmit() : form.submit(); return { ok: true, submitted: true }; } inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true })); return { ok: true, submitted: "enter" }; }
function pageEntities() { const t = (document.body && document.body.innerText) || ""; const caps = t.match(/\b[A-ZА-Я][a-zа-я]+(?:\s+[A-ZА-Я][a-zа-я]+){0,2}\b/g) || []; const freq = {}; for (const c of caps) if (c.length > 3) freq[c] = (freq[c] || 0) + 1; return { entities: Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([name, count]) => ({ name, count })) }; }
function pageDetectPaywall() { const signs = /paywall|subscribe to (read|continue)|подпис|только для подписчиков|premium|metered/i; const el = document.querySelector('[class*=paywall i],[id*=paywall i],[class*=subscribe-wall i]'); return { likelyPaywall: !!el || signs.test(document.body.innerText.slice(0, 5000)), selector: el ? (el.id || el.className) : null }; }
function pageInjectStyle(css, id) { let s = document.getElementById(id); if (!s) { s = document.createElement("style"); s.id = id; document.head.appendChild(s); } s.textContent = css; return { ok: true }; }
function pageRemoveClutter() { const sels = ['[class*=ad-]', '[class*=advert i]', '[id*=ad-]', '[class*=banner i]', '[class*=popup i]', '[class*=cookie i]', '[class*=newsletter i]', '[class*=modal i]', '[class*=overlay i]', '[class*=sticky i]', 'aside', '[class*=related i]', '[class*=recommend i]', 'iframe[src*=ads]']; let n = 0; for (const s of sels) for (const el of document.querySelectorAll(s)) { el.remove(); n++; } document.body.style.overflow = "auto"; return { removed: n }; }

// ================================================================ UTILITY batch
function pageGetSelection() { const s = window.getSelection(); return { text: s ? s.toString() : "", length: s ? s.toString().length : 0 }; }
function pageScrollToText(text) { const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) { if (n.nodeValue.includes(text)) { const el = n.parentElement; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { found: true, y: Math.round(r.y), context: _clean(el.innerText).slice(0, 200) }; } } return { found: false }; }
function pageMark(text, color) { let count = 0; const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement && !["SCRIPT", "STYLE", "MARK"].includes(n.parentElement.tagName) && n.nodeValue.toLowerCase().includes(text.toLowerCase()) ? 1 : 2 }); const nodes = []; let n; while ((n = tw.nextNode())) nodes.push(n); for (const node of nodes) { const idx = node.nodeValue.toLowerCase().indexOf(text.toLowerCase()); if (idx < 0) continue; const range = document.createRange(); range.setStart(node, idx); range.setEnd(node, idx + text.length); const mark = document.createElement("mark"); mark.style.background = color || "yellow"; mark.className = "yx-mark"; try { range.surroundContents(mark); count++; } catch {} } return { marked: count }; }
function pageUnmark() { let n = 0; for (const m of document.querySelectorAll("mark.yx-mark")) { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); n++; } return { removed: n }; }
function pageTableSearch(query) { const q = query.toLowerCase(); const hits = []; document.querySelectorAll("table").forEach((tb, ti) => { Array.from(tb.rows).forEach((r, ri) => { const cells = Array.from(r.cells).map((c) => _clean(c.innerText)); if (cells.join(" ").toLowerCase().includes(q)) hits.push({ table: ti, row: ri, cells }); }); }); return { matches: hits.length, rows: hits.slice(0, 100) }; }
function pageFontsUsed() { const fonts = new Set(); document.querySelectorAll("*").forEach((el, i) => { if (i > 3000) return; fonts.add(getComputedStyle(el).fontFamily); }); return { fonts: [...fonts].slice(0, 50) }; }
function pageColorsUsed() { const colors = {}; document.querySelectorAll("*").forEach((el, i) => { if (i > 3000) return; const c = getComputedStyle(el).color; const b = getComputedStyle(el).backgroundColor; colors[c] = (colors[c] || 0) + 1; if (b !== "rgba(0, 0, 0, 0)") colors[b] = (colors[b] || 0) + 1; }); return { colors: Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([color, count]) => ({ color, count })) }; }
function pageMetaAudit() { const m = (q) => { const el = document.querySelector(q); return el ? (el.content || el.href) : null; }; return { viewport: m("meta[name=viewport]"), robots: m("meta[name=robots]"), canonical: m("link[rel=canonical]"), charset: (document.querySelector("meta[charset]") || {}).getAttribute?.("charset"), description: m("meta[name=description]"), responsive: !!m("meta[name=viewport]") }; }
function pageLazyImages() { const imgs = Array.from(document.images); return { total: imgs.length, lazy: imgs.filter((i) => i.loading === "lazy" || i.dataset.src || i.dataset.lazySrc).length, eager: imgs.filter((i) => i.loading === "eager").length }; }
function pageValidationAudit() { const ids = {}; document.querySelectorAll("[id]").forEach((el) => { ids[el.id] = (ids[el.id] || 0) + 1; }); const dupIds = Object.entries(ids).filter(([, n]) => n > 1).map(([id, n]) => ({ id, count: n })); const emptyLinks = Array.from(document.querySelectorAll("a")).filter((a) => !_clean(a.innerText) && !a.querySelector("img") && !a.getAttribute("aria-label")).length; const levels = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) => +h.tagName[1]); const skips = []; for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) skips.push({ from: "h" + levels[i - 1], to: "h" + levels[i] }); const imgNoAlt = Array.from(document.images).filter((i) => !i.alt).length; return { duplicateIds: dupIds, emptyLinks, headingSkips: skips, imagesWithoutAlt: imgNoAlt, h1Count: levels.filter((l) => l === 1).length }; }
function pageLinksByType(type) { const origin = location.origin; const out = new Set(); for (const a of document.querySelectorAll("a[href]")) { const h = a.href; if (type === "external" && /^https?:/.test(h) && !h.startsWith(origin)) out.add(h); else if (type === "internal" && h.startsWith(origin)) out.add(h); else if (type === "pdf" && /\.pdf(\?|$)/i.test(h)) out.add(h); else if (type === "doc" && /\.(docx?|xlsx?|pptx?|odt|csv|txt|rtf)(\?|$)/i.test(h)) out.add(h); else if (type === "video" && /\.(mp4|webm|mkv|mov|avi|m3u8)(\?|$)/i.test(h)) out.add(h); else if (type === "audio" && /\.(mp3|wav|ogg|flac|m4a|aac)(\?|$)/i.test(h)) out.add(h); } return { type, count: out.size, urls: [...out].slice(0, 300) }; }
function pagePriceStats() { const p = pagePatterns("prices", 500); const nums = p.matches.map((s) => parseFloat(s.replace(/[^\d.,]/g, "").replace(/\s/g, "").replace(",", "."))).filter((n) => !isNaN(n) && n > 0); if (!nums.length) return { count: 0 }; nums.sort((a, b) => a - b); return { count: nums.length, min: nums[0], max: nums[nums.length - 1], median: nums[Math.floor(nums.length / 2)], avg: Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 100) / 100, samples: p.matches.slice(0, 10) }; }
function pageTextStats() { const t = (document.body && document.body.innerText) || ""; const words = t.match(/\S+/g) || []; const sentences = t.split(/[.!?]+/).filter((s) => s.trim().length > 3); const syll = words.reduce((n, w) => n + (w.match(/[aeiouyаеёиоуыэюя]/gi) || []).length, 0); const asl = words.length / (sentences.length || 1); const asw = syll / (words.length || 1); const flesch = Math.round(206.835 - 1.015 * asl - 84.6 * asw); return { words: words.length, sentences: sentences.length, avgWordsPerSentence: Math.round(asl * 10) / 10, avgSyllablesPerWord: Math.round(asw * 100) / 100, fleschReadingEase: flesch, level: flesch > 60 ? "easy" : flesch > 30 ? "medium" : "hard" }; }
function pageJsonScan() { const found = []; for (const s of document.querySelectorAll("script")) { const t = s.textContent || ""; if (s.type === "application/json" || s.type === "application/ld+json") { try { found.push({ type: s.type, keys: Object.keys(JSON.parse(t)).slice(0, 20) }); } catch {} } const m = t.match(/(?:window\.__[A-Z_]+__|__INITIAL_STATE__|__DATA__)\s*=\s*(\{)/); if (m) found.push({ type: "inline-state", varNear: m[0].slice(0, 40) }); } return { count: found.length, json: found.slice(0, 30) }; }
function pageElementInfo(selector) { const el = document.querySelector(selector); if (!el) return { found: false }; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { found: true, tag: el.tagName.toLowerCase(), id: el.id || null, class: el.className || null, text: _clean(el.innerText).slice(0, 300), value: el.value, visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden", rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, attrs: Object.fromEntries(Array.from(el.attributes).map((a) => [a.name, a.value.slice(0, 100)])), styles: { color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, display: cs.display } }; }
function pageAttrValues(selector, attr) { return { values: Array.from(document.querySelectorAll(selector)).map((e) => e.getAttribute(attr)).filter((v) => v != null).slice(0, 300) }; }
function pageCountSelector(selector) { const els = document.querySelectorAll(selector); return { selector, count: els.length, visible: Array.from(els).filter((e) => e.offsetParent !== null).length }; }
function pageSubmitForm(selector) { const f = selector ? document.querySelector(selector) : document.querySelector("form"); if (!f) return { ok: false, error: "no form" }; f.requestSubmit ? f.requestSubmit() : f.submit(); return { ok: true, action: f.action }; }
function pageResetForm(selector) { const f = selector ? document.querySelector(selector) : document.querySelector("form"); if (!f) return { ok: false, error: "no form" }; f.reset(); return { ok: true }; }
function pageCheckAll(selector, checked) { const boxes = document.querySelectorAll(selector || "input[type=checkbox]"); let n = 0; for (const b of boxes) { if (b.checked !== checked) { b.checked = checked; b.dispatchEvent(new Event("change", { bubbles: true })); n++; } } return { changed: n, total: boxes.length }; }
function pageFocusEl(selector) { const el = document.querySelector(selector); if (!el) return { ok: false, error: "not found" }; el.focus(); el.scrollIntoView({ block: "center" }); return { ok: true, active: document.activeElement === el }; }
function pageGetValue(selector) { const el = document.querySelector(selector); if (!el) return { found: false }; return { found: true, value: el.value !== undefined ? el.value : el.textContent, checked: el.checked }; }
function pageIsVisible(selector) { const el = document.querySelector(selector); if (!el) return { found: false }; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { found: true, visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0", inViewport: r.top < innerHeight && r.bottom > 0 }; }
function pageGetStyles(selector, props) { const el = document.querySelector(selector); if (!el) return { found: false }; const cs = getComputedStyle(el); const out = {}; for (const p of (props && props.length ? props : ["color", "backgroundColor", "fontSize", "fontFamily", "display", "position", "width", "height", "margin", "padding"])) out[p] = cs[p]; return { found: true, styles: out }; }
function pageDuplicateContent() { const paras = Array.from(document.querySelectorAll("p")).map((p) => _clean(p.innerText)).filter((t) => t.length > 40); const seen = {}, dups = []; for (const p of paras) { if (seen[p]) dups.push(p.slice(0, 100)); seen[p] = true; } return { paragraphs: paras.length, duplicates: [...new Set(dups)].slice(0, 30) }; }
function pageElementText(selector) { const el = document.querySelector(selector); return el ? { found: true, text: (el.innerText || el.textContent || "").trim() } : { found: false }; }
function pageGetAttribute(selector, attr) { const el = document.querySelector(selector); return el ? { found: true, value: el.getAttribute(attr) } : { found: false }; }
function pageAutoscroll(step, delayHint) { return { ok: true, note: "use browser_scroll or browser_scroll_bottom for iterative scrolling" }; }

function pageExists(selector, text) {
  if (selector) {
    const el = document.querySelector(selector);
    if (!el) return false;
    if (text) return (el.innerText || el.textContent || "").includes(text);
    return true;
  }
  return ((document.body && document.body.innerText) || "").includes(text);
}

// ---------------------------------------------------------------- command handlers
const handlers = {
  async ping() {
    return { pong: true, protocol: PROTOCOL, version: chrome.runtime.getManifest().version, attached: [...attached.keys()] };
  },

  async list_tabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.map(tabInfo);
  },

  async active_tab() {
    return tabInfo(await resolveTab());
  },

  async open_tab({ url, active = true, windowId }) {
    const ww = windowId || (await getWorkWindow())?.id;
    const t = await chrome.tabs.create({ url, active, ...(ww ? { windowId: ww } : {}) });
    return tabInfo(t);
  },

  // Рабочее окно для агента: mode = "least_tabs" (окно с наименьшим числом вкладок,
  // не текущее окно пользователя, если окон больше одного), "new" (создать окно),
  // число = конкретный windowId, "clear" — вернуть поведение по умолчанию, "status".
  async work_window({ mode = "status", url = "about:blank" }) {
    if (mode === "clear") {
      workWindowId = null;
      await chrome.storage.session.remove("workWindowId");
      return { workWindowId: null };
    }
    if (typeof mode === "number") workWindowId = mode;
    else if (mode === "new") {
      const w = await chrome.windows.create({ url, focused: false, state: "normal" });
      workWindowId = w.id;
    } else if (mode === "least_tabs") {
      const ws = (await chrome.windows.getAll({ populate: true })).filter((w) => w.type === "normal" && !w.incognito);
      const [focusedTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const others = ws.length > 1 ? ws.filter((w) => !focusedTab || w.id !== focusedTab.windowId) : ws;
      others.sort((a, b) => (a.tabs || []).length - (b.tabs || []).length);
      if (!others.length) {
        const w = await chrome.windows.create({ url, focused: false });
        workWindowId = w.id;
      } else workWindowId = others[0].id;
    }
    if (workWindowId != null) await chrome.storage.session.set({ workWindowId });
    const ww = await getWorkWindow();
    return ww ? { workWindowId: ww.id, tabs: (await chrome.tabs.query({ windowId: ww.id })).length, state: ww.state, focused: ww.focused } : { workWindowId: null };
  },

  async close_tab({ tabId }) {
    await chrome.tabs.remove(tabId);
    return { ok: true };
  },

  async activate_tab({ tabId, focusWindow = true }) {
    const t = await chrome.tabs.update(tabId, { active: true });
    if (focusWindow) {
      try {
        await chrome.windows.update(t.windowId, { focused: true });
      } catch {}
    }
    return tabInfo(t);
  },

  async navigate({ tabId, url, wait = true }) {
    const tab = await resolveTab(tabId);
    await chrome.tabs.update(tab.id, { url });
    await sleep(200);
    return wait ? waitLoad(tab.id) : tabInfo(await chrome.tabs.get(tab.id));
  },

  async reload({ tabId, bypassCache = false, wait = true }) {
    const tab = await resolveTab(tabId);
    await chrome.tabs.reload(tab.id, { bypassCache });
    await sleep(200);
    return wait ? waitLoad(tab.id) : { ok: true };
  },

  async go_back({ tabId }) {
    const tab = await resolveTab(tabId);
    await chrome.tabs.goBack(tab.id);
    await sleep(200);
    return waitLoad(tab.id);
  },

  async wait_load({ tabId, timeoutMs }) {
    const tab = await resolveTab(tabId);
    return waitLoad(tab.id, timeoutMs);
  },

  async get_page({ tabId, maxChars = 20000, original = false }) {
    return exec(tabId, original ? pageGetOriginal : pageGetInfo, [maxChars]);
  },

  async select({ tabId, selector, value, byText = false }) {
    return exec(tabId, pageSelect, [selector, value, byText]);
  },

  // Автоперевод Яндекс Браузера: off — регистрируем content script, который ставит
  // пометки notranslate на DOMContentLoaded (проверено: перевод не запускается);
  // on — снимаем регистрацию. reload — перезагрузить вкладку, чтобы применить сразу.
  async translation({ mode = "status", tabId, reload = true }) {
    const ID = "yx-no-translate", OLD_ID = "claude-no-translate"; // OLD_ID: installs registered before the rename
    const registeredIds = async () => (await chrome.scripting.getRegisteredContentScripts({ ids: [ID, OLD_ID] })).map((s) => s.id);
    const registered = async () => (await registeredIds()).length > 0;
    if (mode === "off" && !(await registered())) {
      await chrome.scripting.registerContentScripts([
        { id: ID, matches: ["<all_urls>"], js: ["notranslate.js"], runAt: "document_end", allFrames: true, persistAcrossSessions: true },
      ]);
    } else if (mode === "on" && (await registered())) {
      await chrome.scripting.unregisterContentScripts({ ids: await registeredIds() });
    }
    let tab = null;
    if (mode !== "status" && reload) {
      const t = await resolveTab(tabId);
      if (isInjectable(t.url)) {
        await chrome.tabs.reload(t.id);
        await sleep(300);
        tab = await waitLoad(t.id).catch(() => tabInfo(t));
      }
    }
    return { autoTranslate: (await registered()) ? "blocked" : "browser-default", reloaded: tab };
  },

  async pdf({ tabId, landscape = false, printBackground = true, scale = 1 }) {
    const r = await cdp(tabId, "Page.printToPDF", { landscape, printBackground, scale, preferCSSPageSize: true });
    return { base64: r.data, format: "pdf" };
  },

  async reload_extension() {
    setTimeout(() => chrome.runtime.reload(), 200);
    return { ok: true, note: "extension reloading; reconnects in a few seconds" };
  },

  async get_html({ tabId, selector = null, outer = true, maxChars = 30000 }) {
    return exec(tabId, pageGetHtml, [selector, outer, maxChars]);
  },

  async query({ tabId, selector, limit = 50, attrs = [], textMax = 200 }) {
    return exec(tabId, pageQuery, [selector, limit, attrs, textMax]);
  },

  async click({ tabId, selector, index = 0 }) {
    return exec(tabId, pageClick, [selector, index]);
  },

  async type({ tabId, selector, text, clear = false, submit = false }) {
    return exec(tabId, pageType, [selector, text, clear, submit]);
  },

  async set_html({ tabId, selector, html, mode = "inner" }) {
    return exec(tabId, pageSetHtml, [selector, html, mode]);
  },

  async set_attr({ tabId, selector, name, value = null, all = false }) {
    return exec(tabId, pageSetAttr, [selector, name, value, all]);
  },

  async set_style({ tabId, selector, styles, all = false }) {
    return exec(tabId, pageSetStyle, [selector, styles, all]);
  },

  async remove({ tabId, selector, all = false }) {
    return exec(tabId, pageRemove, [selector, all]);
  },

  async scroll({ tabId, selector = null, x = 0, y = 0 }) {
    return exec(tabId, pageScroll, [selector, x, y]);
  },

  async links({ tabId, limit = 200 }) {
    return exec(tabId, pageLinks, [limit]);
  },

  async forms({ tabId }) {
    return exec(tabId, pageForms, []);
  },

  async find_text({ tabId, text, limit = 20, context = 80, caseSensitive = false }) {
    return exec(tabId, pageFindText, [text, limit, context, caseSensitive]);
  },

  async tables({ tabId, limit = 10, maxRows = 200 }) {
    return exec(tabId, pageTables, [limit, maxRows]);
  },

  // Ждать появления селектора и/или текста на странице (после навигации, кликов, AJAX).
  async wait_for({ tabId, selector = null, text = null, timeoutMs = 15000, intervalMs = 250 }) {
    if (!selector && !text) throw new Error("selector or text required");
    const tab = await resolveTab(tabId);
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (await exec(tab.id, pageExists, [selector, text])) return { found: true, waitedMs: Date.now() - t0 };
      } catch {}
      await sleep(intervalMs);
    }
    return { found: false, waitedMs: Date.now() - t0 };
  },

  async inject_css({ tabId, css }) {
    const tab = await resolveTab(tabId);
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, css });
    return { ok: true };
  },

  // Произвольный JS через CDP Runtime.evaluate в контексте страницы (обходит CSP,
  // видит её глобалы). Изолированный мир не подходит: MV3 запрещает eval/new Function.
  async eval({ tabId, code, timeoutMs = 30000 }) {
    const res = await cdp(tabId, "Runtime.evaluate", {
      expression: `(async () => { ${code} })()`,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || "evaluation error");
    }
    return res.result ? res.result.value : undefined;
  },

  async screenshot({ tabId, format = "png", quality = 80, fullPage = false }) {
    const tab = await resolveTab(tabId);
    if (fullPage) {
      const metrics = await cdp(tab.id, "Page.getLayoutMetrics");
      const cs = metrics.cssContentSize || metrics.contentSize;
      const width = Math.ceil(cs.width);
      // Very tall pages exceed the max surface size ("Unable to capture screenshot").
      // Retry with a shrinking height cap until it succeeds.
      let lastErr;
      for (const cap of [Math.ceil(cs.height), 16000, 12000, 8000, 4000, 2000]) {
        const h = Math.min(Math.ceil(cs.height), cap);
        try {
          const shot = await cdp(tab.id, "Page.captureScreenshot", { format, quality: format === "jpeg" ? quality : undefined, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
          return { format, base64: shot.data, width, height: h, fullHeight: Math.ceil(cs.height), clipped: h < Math.ceil(cs.height) };
        } catch (e) { lastErr = e; }
      }
      throw new Error("fullPage screenshot failed even at reduced height: " + (lastErr && lastErr.message));
    }
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true });
    await sleep(120);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format, quality });
    const base64 = dataUrl.split(",")[1];
    return { format, base64 };
  },

  // ---- windows & tabs, extended ----
  async windows_list() {
    const ws = await chrome.windows.getAll({ populate: true });
    return ws.map((w) => ({ id: w.id, focused: w.focused, state: w.state, incognito: w.incognito, type: w.type, tabs: (w.tabs || []).map(tabInfo) }));
  },
  async window_new({ url, incognito = false, state = "normal", width, height }) {
    const w = await chrome.windows.create({ url, incognito, state, width, height });
    return { id: w.id, incognito: w.incognito, tabs: (w.tabs || []).map(tabInfo) };
  },
  async window_close({ windowId }) {
    await chrome.windows.remove(windowId);
    return { ok: true };
  },
  async window_focus({ windowId, state }) {
    const w = await chrome.windows.update(windowId, { focused: true, ...(state ? { state } : {}) });
    return { id: w.id, state: w.state };
  },
  async tab_update({ tabId, pinned, muted, url, active }) {
    const tab = await resolveTab(tabId);
    const t = await chrome.tabs.update(tab.id, { ...(pinned !== undefined ? { pinned } : {}), ...(muted !== undefined ? { muted } : {}), ...(url ? { url } : {}), ...(active !== undefined ? { active } : {}) });
    return tabInfo(t);
  },
  async tab_duplicate({ tabId }) {
    const tab = await resolveTab(tabId);
    return tabInfo(await chrome.tabs.duplicate(tab.id));
  },
  async find_tabs({ pattern }) {
    const re = new RegExp(pattern, "i");
    return (await chrome.tabs.query({})).filter((t) => re.test(t.url || "") || re.test(t.title || "")).map(tabInfo);
  },
  async open_urls({ urls, active = false, windowId }) {
    const ww = windowId || (await getWorkWindow())?.id;
    const out = [];
    for (const url of urls) out.push(tabInfo(await chrome.tabs.create({ url, active, ...(ww ? { windowId: ww } : {}) })));
    return out;
  },
  async close_tabs({ pattern, tabIds }) {
    let ids = tabIds || [];
    if (pattern) {
      const re = new RegExp(pattern, "i");
      ids = ids.concat((await chrome.tabs.query({})).filter((t) => re.test(t.url || "") || re.test(t.title || "")).map((t) => t.id));
    }
    ids = [...new Set(ids)];
    if (ids.length) await chrome.tabs.remove(ids);
    return { closed: ids.length, tabIds: ids };
  },
  async zoom({ tabId, factor }) {
    const tab = await resolveTab(tabId);
    if (factor) await chrome.tabs.setZoom(tab.id, factor);
    return { tabId: tab.id, zoom: await chrome.tabs.getZoom(tab.id) };
  },

  // ---- history / bookmarks / downloads / cookies / sessions ----
  async history_search({ text = "", maxResults = 50, daysBack = 30 }) {
    const items = await chrome.history.search({ text, maxResults, startTime: Date.now() - daysBack * 86400000 });
    return items.map((h) => ({ url: h.url, title: h.title, lastVisit: new Date(h.lastVisitTime).toISOString(), visits: h.visitCount }));
  },
  async history_delete_url({ url }) {
    await chrome.history.deleteUrl({ url });
    return { ok: true };
  },
  async bookmarks_search({ query = "", limit = 100 }) {
    const items = query ? await chrome.bookmarks.search(query) : (await chrome.bookmarks.getRecent(limit));
    return items.slice(0, limit).map((b) => ({ id: b.id, parentId: b.parentId, title: b.title, url: b.url, folder: !b.url }));
  },
  async bookmarks_tree() {
    const walk = (n) => ({ id: n.id, title: n.title, url: n.url, children: n.children ? n.children.map(walk) : undefined });
    return (await chrome.bookmarks.getTree()).map(walk);
  },
  async bookmark_add({ title, url, parentId }) {
    const b = await chrome.bookmarks.create({ title, url, parentId });
    return { id: b.id, title: b.title, url: b.url, parentId: b.parentId };
  },
  async bookmark_remove({ id }) {
    await chrome.bookmarks.remove(id);
    return { ok: true };
  },
  async download({ url, filename, saveAs = false, conflictAction = "uniquify" }) {
    const id = await chrome.downloads.download({ url, filename, saveAs, conflictAction });
    for (let i = 0; i < 100; i++) {
      await sleep(300);
      const [d] = await chrome.downloads.search({ id });
      if (!d) break;
      if (d.state === "complete" || d.state === "interrupted") return { id, state: d.state, filename: d.filename, bytes: d.bytesReceived, error: d.error };
    }
    const [d] = await chrome.downloads.search({ id });
    return { id, state: d ? d.state : "unknown", filename: d && d.filename, note: "still in progress; use downloads_list" };
  },
  async downloads_list({ limit = 20, state }) {
    const items = await chrome.downloads.search({ limit, orderBy: ["-startTime"], ...(state ? { state } : {}) });
    return items.map((d) => ({ id: d.id, url: d.url, filename: d.filename, state: d.state, bytes: d.bytesReceived, total: d.totalBytes, mime: d.mime, started: d.startTime, error: d.error }));
  },
  async cookies_get({ url, domain, name }) {
    const list = await chrome.cookies.getAll({ ...(url ? { url } : {}), ...(domain ? { domain } : {}), ...(name ? { name } : {}) });
    return list.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, session: c.session, expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : null }));
  },
  async cookie_set({ url, name, value, domain, path = "/", secure, httpOnly, expirationDays }) {
    const c = await chrome.cookies.set({ url, name, value, ...(domain ? { domain } : {}), path, ...(secure !== undefined ? { secure } : {}), ...(httpOnly !== undefined ? { httpOnly } : {}), ...(expirationDays ? { expirationDate: Date.now() / 1000 + expirationDays * 86400 } : {}) });
    return c ? { ok: true, name: c.name, domain: c.domain } : { ok: false };
  },
  async cookie_remove({ url, name }) {
    const r = await chrome.cookies.remove({ url, name });
    return { ok: !!r };
  },
  async clear_data({ origins, types = ["cache"], sinceDays }) {
    const options = { ...(origins && origins.length ? { origins } : {}), ...(sinceDays ? { since: Date.now() - sinceDays * 86400000 } : {}) };
    const map = { cache: "cache", cookies: "cookies", localStorage: "localStorage", indexedDB: "indexedDB", serviceWorkers: "serviceWorkers", cacheStorage: "cacheStorage", history: "history", downloads: "downloads", formData: "formData", passwords: "passwords" };
    const dataToRemove = {};
    for (const t of types) if (map[t]) dataToRemove[map[t]] = true;
    await chrome.browsingData.remove(options, dataToRemove);
    return { ok: true, removed: Object.keys(dataToRemove), origins: origins || "all" };
  },
  async recent_closed({ max = 10 }) {
    const s = await chrome.sessions.getRecentlyClosed({ maxResults: max });
    return s.map((x) => x.tab ? { kind: "tab", sessionId: x.tab.sessionId, url: x.tab.url, title: x.tab.title } : { kind: "window", sessionId: x.window.sessionId, tabs: (x.window.tabs || []).map((t) => ({ url: t.url, title: t.title })) });
  },
  async restore_session({ sessionId }) {
    const s = await chrome.sessions.restore(sessionId);
    return s.tab ? tabInfo(s.tab) : { windowId: s.window && s.window.id };
  },

  // ---- user-facing ----
  async notify({ title = "YX Bridge", message, iconUrl }) {
    const id = await chrome.notifications.create({ type: "basic", iconUrl: iconUrl || chrome.runtime.getURL("icon.png"), title, message });
    return { id };
  },
  async speak({ text, lang, rate = 1.0, stop = false }) {
    if (stop) { chrome.tts.stop(); return { ok: true, stopped: true }; }
    chrome.tts.speak(text, { ...(lang ? { lang } : {}), rate });
    return { ok: true };
  },
  async search({ text, disposition = "NEW_TAB" }) {
    await chrome.search.query({ text, disposition });
    return { ok: true };
  },

  // ---- page-level extras ----
  async fill_form({ tabId, fields, submitSelector = null }) {
    return exec(tabId, pageFillForm, [fields, submitSelector]);
  },
  async extract({ tabId, spec, textMax = 500 }) {
    return exec(tabId, pageExtract, [spec, textMax]);
  },
  async storage({ tabId, area = "local", op = "get", key = null, value = null }) {
    return exec(tabId, pageStorage, [area, op, key, value]);
  },
  async meta({ tabId }) {
    return exec(tabId, pageMeta, []);
  },
  async article({ tabId, maxChars = 30000 }) {
    return exec(tabId, pageArticle, [maxChars]);
  },
  async hover({ tabId, selector }) {
    return exec(tabId, pageHover, [selector]);
  },
  async press_key({ tabId, selector = null, key, ctrl = false, shift = false, alt = false, meta = false }) {
    return exec(tabId, pagePressKey, [selector, key, { ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta }]);
  },
  async highlight({ tabId, selector, color = "red", all = true }) {
    return exec(tabId, pageHighlight, [selector, color, all]);
  },
  async scroll_bottom({ tabId, maxSteps = 30, delayMs = 700 }) {
    const tab = await resolveTab(tabId);
    let last = -1, steps = 0;
    for (; steps < maxSteps; steps++) {
      await exec(tab.id, pageScroll, [null, 0, 100000]);
      await sleep(delayMs);
      const st = await exec(tab.id, pageScrollState, []);
      if (st.height === last) break;
      last = st.height;
    }
    return { steps, height: last };
  },
  async element_screenshot({ tabId, selector, format = "png" }) {
    const tab = await resolveTab(tabId);
    const r = await exec(tab.id, pageRect, [selector]);
    if (!r) throw new Error("element not found");
    await sleep(150);
    const shot = await cdp(tab.id, "Page.captureScreenshot", { format, clip: { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height), scale: 1 } });
    return { format, base64: shot.data, width: r.width, height: r.height };
  },

  // ---- media ----
  async media_list({ tabId, limit = 200, includeBackgrounds = false, minSize = 50 }) {
    return exec(tabId, pageMediaList, [limit, includeBackgrounds, minSize]);
  },
  // Картинки качаем из фонового воркера: host_permissions <all_urls> снимает CORS,
  // куки пользователя прикладываются. Если хост требует Referer и отдаёт 403 —
  // запасной путь через контекст страницы (работает для same-origin).
  async image_view({ tabId, url, maxSide = 1280, quality = 0.85 }) {
    const toB64 = async (blob) => {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(s);
    };
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const type = blob.type || "image/jpeg";
      let bitmap;
      try { bitmap = await createImageBitmap(blob); } catch {
        return { ok: true, mime: type, bytes: blob.size, base64: await toB64(blob), via: "background", note: "not decodable as raster (svg?), raw bytes returned" };
      }
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      const out = await c.convertToBlob({ type: "image/jpeg", quality });
      return { ok: true, mime: "image/jpeg", originalMime: type, originalBytes: blob.size, width: bitmap.width, height: bitmap.height, sent: { w, h, bytes: out.size }, base64: await toB64(out), via: "background" };
    } catch (e) {
      const r = await exec(tabId, pageFetchImage, [url, maxSide, quality]);
      if (!r) return { ok: false, error: "background fetch failed (" + e.message + ") and page fetch failed (CORS?)" };
      return { ...r, via: "page" };
    }
  },
  async media_download({ tabId, urls, folder }) {
    const tab = await resolveTab(tabId);
    let host = "site";
    try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch {}
    const dir = folder || `yx-bridge/${host}`;
    const out = [];
    for (const url of urls) {
      let name = "file";
      try { name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "file").replace(/[^\w.\-]+/g, "_").slice(0, 80); } catch {}
      if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += ".bin";
      try {
        const id = await chrome.downloads.download({ url, filename: `${dir}/${name}`, conflictAction: "uniquify", saveAs: false });
        let d = null;
        for (let i = 0; i < 100; i++) {
          await sleep(250);
          [d] = await chrome.downloads.search({ id });
          if (!d || d.state !== "in_progress") break;
        }
        out.push({ url, state: d ? d.state : "unknown", file: d && d.filename, bytes: d && d.bytesReceived, error: d && d.error });
      } catch (e) {
        out.push({ url, state: "failed", error: e.message });
      }
    }
    return { folder: dir, files: out };
  },
  async video_control({ tabId, selector = null, action = "info", value = null }) {
    const tab = await resolveTab(tabId);
    if (action === "play") {
      try {
        const w = await chrome.windows.get(tab.windowId);
        if (!w.focused || !tab.active) await keepVisible(tab.id);
      } catch {}
    }
    return exec(tab.id, pageVideoControl, [selector, action, value]);
  },
  async video_frames({ tabId, selector = null, times = [], maxSide = 960, quality = 0.8, keepVisible: kv = true }) {
    const tab = await resolveTab(tabId);
    let vis = null;
    if (kv) {
      try {
        const w = await chrome.windows.get(tab.windowId);
        if (!w.focused || !tab.active) vis = await keepVisible(tab.id);
      } catch {}
    }
    const r = await exec(tab.id, pageVideoFrames, [selector, times, maxSide, quality]);
    if (r && vis) r.visibilityEmulated = true;
    return r;
  },

  async keep_visible({ tabId }) {
    return keepVisible(tabId);
  },

  // ---- students ----
  async quiz_extract({ tabId, limit = 100 }) {
    return exec(tabId, pageQuizExtract, [limit]);
  },
  async choose({ tabId, groupSelector = null, label, exact = false }) {
    return exec(tabId, pageChoose, [groupSelector, label, exact]);
  },
  async math_extract({ tabId }) {
    return exec(tabId, pageMathExtract, []);
  },

  // ---- testers ----
  async fetch_url({ tabId, url, method = "GET", headers = {}, body = null, maxChars = 100000 }) {
    return exec(tabId, pageFetch, [url, method, headers, body, maxChars]);
  },
  async iframes({ tabId }) {
    return exec(tabId, pageIframes, []);
  },
  async storage_dump({ tabId }) {
    const tab = await resolveTab(tabId);
    const page = await exec(tab.id, pageStorageDump, []);
    let cookies = [];
    try { cookies = (await chrome.cookies.getAll({ url: tab.url })).map((c) => ({ name: c.name, value: c.value, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, session: c.session })); } catch {}
    return { ...page, cookies };
  },
  async security_scan({ tabId }) {
    return exec(tabId, pageSecurityScan, []);
  },
  async outline({ tabId }) {
    return exec(tabId, pageOutline, []);
  },
  async accessibility_tree({ tabId, maxNodes = 400 }) {
    const id = await attach(tabId);
    await cdp(id, "Accessibility.enable");
    const r = await cdp(id, "Accessibility.getFullAXTree", { max_depth: 30 });
    const nodes = (r.nodes || []).filter((n) => n.role && n.role.value !== "none" && n.role.value !== "generic").slice(0, maxNodes).map((n) => ({
      role: n.role.value,
      name: n.name && n.name.value,
      value: n.value && n.value.value,
      level: n.level && n.level.value,
      checked: n.properties && (n.properties.find((p) => p.name === "checked") || {}).value?.value,
    }));
    return { count: nodes.length, nodes };
  },
  async collect_code({ tabId }) {
    return exec(tabId, pageCollectCode, []);
  },

  // ---- students batch ----
  async quiz_answer_all({ tabId, answers }) { return exec(tabId, pageQuizAnswerAll, [answers]); },
  async quiz_submit({ tabId, patterns = ["submit", "отправить", "next", "далее", "проверить", "finish", "завершить", "готово"] }) { return exec(tabId, pageClickByText, [patterns, "button"]); },
  async quiz_next({ tabId, patterns = ["next", "далее", "следующий", "продолжить", "continue", "→", ">"] }) { return exec(tabId, pageClickByText, [patterns, "button"]); },
  async quiz_prev({ tabId, patterns = ["prev", "назад", "предыдущий", "back", "←", "<"] }) { return exec(tabId, pageClickByText, [patterns, "button"]); },
  async click_text({ tabId, patterns, role = "button" }) { return exec(tabId, pageClickByText, [patterns, role]); },
  async flashcards({ tabId, limit = 500 }) { return exec(tabId, pageFlashcards, [limit]); },
  async essay_write({ tabId, selector = null, text, append = false }) { return exec(tabId, pageEssayWrite, [selector, text, append]); },
  async word_count({ tabId, selector = null }) { return exec(tabId, pageWordCount, [selector]); },
  async fill_blanks({ tabId, values }) { return exec(tabId, pageFillBlanks, [values]); },
  async set_range({ tabId, selector, value }) { return exec(tabId, pageSetRange, [selector, value]); },
  async drag_drop({ tabId, from, to }) { return exec(tabId, pageDragDrop, [from, to]); },
  async reorder({ tabId, container, order }) { return exec(tabId, pageReorder, [container, order]); },
  async code_get({ tabId, selector = null }) { return exec(tabId, pageCodeEditorGet, [selector]); },
  async code_set({ tabId, selector = null, code }) { return exec(tabId, pageCodeEditorSet, [selector, code]); },
  async timer_read({ tabId }) { return exec(tabId, pageReadTimer, []); },
  async progress_read({ tabId }) { return exec(tabId, pageProgress, []); },
  async captions({ tabId }) { return exec(tabId, pageCaptions, []); },
  async definitions({ tabId }) { return exec(tabId, pageDefinitions, []); },
  async required_fields({ tabId }) { return exec(tabId, pageRequiredFields, []); },
  async form_validate({ tabId, selector = null }) { return exec(tabId, pageFormValidate, [selector]); },
  async answer_key_scan({ tabId }) { return exec(tabId, pageAnswerKeyScan, []); },

  // ---- testers batch (page-side) ----
  async tech_detect({ tabId }) { return exec(tabId, pageTechDetect, []); },
  async globals_list({ tabId }) { return exec(tabId, pageGlobalsList, []); },
  async comments_extract({ tabId, limit = 200 }) { return exec(tabId, pageComments, [limit]); },
  async hidden_inputs({ tabId }) { return exec(tabId, pageHiddenInputs, []); },
  async inline_handlers({ tabId }) { return exec(tabId, pageInlineHandlers, []); },
  async cookie_audit({ tabId }) { return exec(tabId, pageCookieAudit, []); },
  async secrets_scan({ tabId }) { return exec(tabId, pageSecretsScan, []); },
  async links_classify({ tabId }) { return exec(tabId, pageLinksClassify, []); },
  async params({ tabId }) { return exec(tabId, pageParams, []); },
  async perf({ tabId }) { return exec(tabId, pagePerf, []); },
  async third_party({ tabId }) { return exec(tabId, pageThirdParty, []); },
  async source_maps({ tabId }) { return exec(tabId, pageSourceMaps, []); },
  async sri_audit({ tabId }) { return exec(tabId, pageSriAudit, []); },
  async iframe_audit({ tabId }) { return exec(tabId, pageIframeAudit, []); },
  async cookie_consent({ tabId }) { return exec(tabId, pageCookieConsent, []); },
  async hidden_elements({ tabId, limit = 100 }) { return exec(tabId, pageHiddenElements, [limit]); },
  async console_errors({ tabId }) {
    const id = await attach(tabId);
    const st = attached.get(id);
    const errs = (st.logs || []).filter((l) => l.type === "error" || l.type === "exception");
    return { count: errs.length, errors: errs.slice(-100) };
  },
  async websocket_frames({ tabId, clear = false }) {
    const id = await attach(tabId);
    const st = attached.get(id);
    if (!st.ws) { st.ws = []; try { await cdp(id, "Network.enable"); } catch {} }
    const out = st.ws.slice(-200);
    if (clear) st.ws.length = 0;
    return { recording: true, count: st.ws.length, frames: out, note: "reload/interact to capture; frames appear here" };
  },

  // ---- user batch (extract / summarize / productivity) ----
  async patterns({ tabId, kind, limit = 200 }) { return exec(tabId, pagePatterns, [kind, limit]); },
  async social_links({ tabId }) { return exec(tabId, pageSocialLinks, []); },
  async summary_data({ tabId }) { return exec(tabId, pageSummaryData, []); },
  async toc({ tabId }) { return exec(tabId, pageToc, []); },
  async schema_extract({ tabId, type = null }) { return exec(tabId, pageSchemaExtract, [type]); },
  async lists_extract({ tabId }) { return exec(tabId, pageLists, []); },
  async quotes({ tabId }) { return exec(tabId, pageQuotes, []); },
  async code_blocks({ tabId }) { return exec(tabId, pageCodeBlocks, []); },
  async citations({ tabId }) { return exec(tabId, pageCitations, []); },
  async breadcrumbs({ tabId }) { return exec(tabId, pageBreadcrumbs, []); },
  async pagination({ tabId }) { return exec(tabId, pagePagination, []); },
  async rss_find({ tabId }) { return exec(tabId, pageRssFind, []); },
  async author({ tabId }) { return exec(tabId, pageAuthor, []); },
  async publish_date({ tabId }) { return exec(tabId, pagePublishDate, []); },
  async main_image({ tabId }) { return exec(tabId, pageMainImage, []); },
  async image_alts({ tabId }) { return exec(tabId, pageImageAlts, []); },
  async faq({ tabId }) { return exec(tabId, pageFaq, []); },
  async paragraphs({ tabId, min = 40 }) { return exec(tabId, pageParagraphs, [min]); },
  async headings({ tabId }) { return exec(tabId, pageHeadings, []); },
  async word_freq({ tabId, top = 40, minLen = 3 }) { return exec(tabId, pageWordFreq, [top, minLen]); },
  async reading_time({ tabId }) { return exec(tabId, pageReadingTime, []); },
  async lang_detect({ tabId }) { return exec(tabId, pageLangDetect, []); },
  async reader_view({ tabId, maxChars = 50000 }) { return exec(tabId, pageReaderView, [maxChars]); },
  async to_markdown({ tabId, maxChars = 100000 }) { return exec(tabId, pageMarkdown, [maxChars]); },
  async reviews({ tabId }) { return exec(tabId, pageReviews, []); },
  async login_detect({ tabId }) { return exec(tabId, pageLoginDetect, []); },
  async newsletter_detect({ tabId }) { return exec(tabId, pageNewsletterDetect, []); },
  async search_on_page({ tabId, query }) { return exec(tabId, pageSearchOnPage, [query]); },
  async entities({ tabId }) { return exec(tabId, pageEntities, []); },
  async detect_paywall({ tabId }) { return exec(tabId, pageDetectPaywall, []); },
  async remove_clutter({ tabId }) { return exec(tabId, pageRemoveClutter, []); },
  async dark_mode({ tabId, on = true }) { return exec(tabId, pageInjectStyle, [on ? "html{filter:invert(1) hue-rotate(180deg)!important;background:#111!important}img,video,picture,canvas,[style*=background-image]{filter:invert(1) hue-rotate(180deg)!important}" : "", "yx-dark"]); },
  async font_size({ tabId, percent = 120 }) { return exec(tabId, pageInjectStyle, [`html{font-size:${percent}%!important}`, "yx-font"]); },
  async focus_mode({ tabId }) { return exec(tabId, pageRemoveClutter, []); },

  // ---- utility batch ----
  async get_selection({ tabId }) { return exec(tabId, pageGetSelection, []); },
  async scroll_to_text({ tabId, text }) { return exec(tabId, pageScrollToText, [text]); },
  async mark_text({ tabId, text, color = "yellow" }) { return exec(tabId, pageMark, [text, color]); },
  async unmark({ tabId }) { return exec(tabId, pageUnmark, []); },
  async table_search({ tabId, query }) { return exec(tabId, pageTableSearch, [query]); },
  async fonts_used({ tabId }) { return exec(tabId, pageFontsUsed, []); },
  async colors_used({ tabId }) { return exec(tabId, pageColorsUsed, []); },
  async meta_audit({ tabId }) { return exec(tabId, pageMetaAudit, []); },
  async lazy_images({ tabId }) { return exec(tabId, pageLazyImages, []); },
  async validation_audit({ tabId }) { return exec(tabId, pageValidationAudit, []); },
  async links_by_type({ tabId, type }) { return exec(tabId, pageLinksByType, [type]); },
  async price_stats({ tabId }) { return exec(tabId, pagePriceStats, []); },
  async text_stats({ tabId }) { return exec(tabId, pageTextStats, []); },
  async json_scan({ tabId }) { return exec(tabId, pageJsonScan, []); },
  async element_info({ tabId, selector }) { return exec(tabId, pageElementInfo, [selector]); },
  async attr_values({ tabId, selector, attr }) { return exec(tabId, pageAttrValues, [selector, attr]); },
  async count_selector({ tabId, selector }) { return exec(tabId, pageCountSelector, [selector]); },
  async submit_form({ tabId, selector = null }) { return exec(tabId, pageSubmitForm, [selector]); },
  async reset_form({ tabId, selector = null }) { return exec(tabId, pageResetForm, [selector]); },
  async check_all({ tabId, selector = null, checked = true }) { return exec(tabId, pageCheckAll, [selector, checked]); },
  async focus_element({ tabId, selector }) { return exec(tabId, pageFocusEl, [selector]); },
  async get_value({ tabId, selector }) { return exec(tabId, pageGetValue, [selector]); },
  async is_visible({ tabId, selector }) { return exec(tabId, pageIsVisible, [selector]); },
  async get_styles({ tabId, selector, props = [] }) { return exec(tabId, pageGetStyles, [selector, props]); },
  async duplicate_content({ tabId }) { return exec(tabId, pageDuplicateContent, []); },
  async element_text({ tabId, selector }) { return exec(tabId, pageElementText, [selector]); },
  async get_attribute({ tabId, selector, attr }) { return exec(tabId, pageGetAttribute, [selector, attr]); },
  async wait_gone({ tabId, selector, timeoutMs = 15000 }) {
    const tab = await resolveTab(tabId);
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { const r = await exec(tab.id, pageExists, [selector, null]).catch(() => false); if (!r) return { gone: true, waitedMs: Date.now() - t0 }; await sleep(250); }
    return { gone: false, waitedMs: Date.now() - t0 };
  },
  async clipboard_write({ tabId, text }) {
    return exec(tabId, (t) => { const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} ta.remove(); return { ok }; }, [text]);
  },
  async clipboard_read({ tabId }) {
    const r = await cdp(tabId, "Runtime.evaluate", { expression: "navigator.clipboard.readText()", awaitPromise: true, returnByValue: true, userGesture: true }).catch((e) => ({ exceptionDetails: e }));
    return r.exceptionDetails ? { ok: false, error: "clipboard read blocked (needs permission/gesture)" } : { ok: true, text: r.result.value };
  },
  async stats_get({ from = null, to = null } = {}) { return statsGet({ from, to }); },
  async stats_reset() { await chrome.storage.local.remove("stats"); await chrome.storage.session.remove("statCheckpoint"); return { ok: true, reset: true }; },
  async stats_raw() { const s = await chrome.storage.local.get("stats"); return s.stats || { totalSeconds: 0, byDomain: {}, byDay: {}, since: null }; },
  async stats_import({ stats, merge = false }) {
    if (!stats || typeof stats !== "object") return { ok: false, error: "no stats object" };
    if (merge) {
      const cur = (await chrome.storage.local.get("stats")).stats || { totalSeconds: 0, byDomain: {}, byDay: {}, since: stats.since };
      cur.totalSeconds += stats.totalSeconds || 0;
      for (const [d, v] of Object.entries(stats.byDomain || {})) { const t = cur.byDomain[d] = cur.byDomain[d] || { seconds: 0, visits: 0, lastVisit: null }; t.seconds += v.seconds || 0; t.visits += v.visits || 0; t.lastVisit = v.lastVisit || t.lastVisit; }
      for (const [day, v] of Object.entries(stats.byDay || {})) { const dd = cur.byDay[day] = cur.byDay[day] || { seconds: 0, byDomain: {} }; dd.seconds += v.seconds || 0; for (const [h, sec] of Object.entries(v.byDomain || {})) dd.byDomain[h] = (dd.byDomain[h] || 0) + sec; }
      await chrome.storage.local.set({ stats: cur });
    } else await chrome.storage.local.set({ stats });
    return { ok: true, merged: merge };
  },
  // Store the connection password; the extension re-sends it on every (re)connect.
  async set_password({ token }) { if (token) await chrome.storage.local.set({ yxToken: token }); else await chrome.storage.local.remove("yxToken"); return { ok: true, hasPassword: !!token }; },

  // Fetch a resource's raw bytes from the background worker (CORS-free) for snapshots.
  async download_bytes({ url, maxBytes = 20000000 }) {
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return { ok: false, status: res.status };
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > maxBytes) return { ok: false, error: "too large", bytes: buf.length };
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { ok: true, mime: res.headers.get("content-type") || "application/octet-stream", bytes: buf.length, base64: btoa(s) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // ---- emulation / network (CDP) ----
  async set_viewport({ tabId, width = 0, height = 0, mobile = false, scale = 1 }) {
    const tab = await resolveTab(tabId);
    if (!width) {
      await cdp(tab.id, "Emulation.clearDeviceMetricsOverride");
      return { cleared: true };
    }
    await cdp(tab.id, "Emulation.setDeviceMetricsOverride", { width, height: height || Math.round(width * 1.8), deviceScaleFactor: scale, mobile });
    if (mobile) await cdp(tab.id, "Emulation.setTouchEmulationEnabled", { enabled: true });
    return { width, height: height || Math.round(width * 1.8), mobile };
  },
  async set_user_agent({ tabId, userAgent, acceptLanguage, platform }) {
    await cdp(tabId, "Emulation.setUserAgentOverride", { userAgent, ...(acceptLanguage ? { acceptLanguage } : {}), ...(platform ? { platform } : {}) });
    return { ok: true, note: "applies to subsequent requests; reload the tab" };
  },
  async geolocation({ tabId, latitude, longitude, accuracy = 50, clear = false }) {
    if (clear) { await cdp(tabId, "Emulation.clearGeolocationOverride"); return { cleared: true }; }
    await cdp(tabId, "Emulation.setGeolocationOverride", { latitude, longitude, accuracy });
    return { ok: true };
  },
  async network_start({ tabId }) {
    const id = await attach(tabId);
    attached.get(id).net = [];
    await cdp(id, "Network.enable");
    return { tabId: id, recording: true };
  },
  async network_log({ tabId, filter = null, limit = 200, clear = false }) {
    const id = await attach(tabId);
    const st = attached.get(id);
    if (!st.net) return { recording: false, hint: "call network_start first" };
    let items = st.net;
    if (filter) { const re = new RegExp(filter, "i"); items = items.filter((r) => re.test(r.url) || re.test(r.type || "")); }
    const out = items.slice(-limit).map(({ id: _id, ...r }) => r);
    if (clear) st.net.length = 0;
    return { recording: true, total: st.net.length, requests: out };
  },
  async network_stop({ tabId }) {
    const id = await attach(tabId);
    const st = attached.get(id);
    const n = st.net ? st.net.length : 0;
    st.net = null;
    try { await cdp(id, "Network.disable"); } catch {}
    return { tabId: id, recorded: n };
  },
  async response_body({ tabId, urlPattern }) {
    const id = await attach(tabId);
    const st = attached.get(id);
    if (!st.net) throw new Error("call network_start first, then reload/trigger the request");
    const re = new RegExp(urlPattern, "i");
    const r = [...st.net].reverse().find((x) => re.test(x.url) && x.status);
    if (!r) throw new Error("no finished request matches");
    const b = await cdp(id, "Network.getResponseBody", { requestId: r.id });
    return { url: r.url, status: r.status, mime: r.mime, base64Encoded: b.base64Encoded, body: b.base64Encoded ? b.body.slice(0, 200000) : b.body.slice(0, 200000), truncated: b.body.length > 200000 };
  },
  async block_urls({ tabId, patterns = [] }) {
    const id = await attach(tabId);
    await cdp(id, "Network.enable");
    await cdp(id, "Network.setBlockedURLs", { urls: patterns });
    return { tabId: id, blocked: patterns };
  },
  async dialogs({ tabId, mode = "accept", promptText = "" }) {
    const id = await attach(tabId);
    const st = attached.get(id);
    if (mode === "off") { st.dialogMode = null; return { tabId: id, mode: "off", seen: st.dialogs || [] }; }
    await cdp(id, "Page.enable");
    st.dialogMode = mode;
    st.dialogPrompt = promptText;
    return { tabId: id, mode, seen: st.dialogs || [] };
  },

  // ---- CDP ----
  async cdp({ tabId, method, params = {} }) {
    return cdp(tabId, method, params);
  },

  async cdp_attach({ tabId }) {
    return { tabId: await attach(tabId) };
  },

  async cdp_detach({ tabId }) {
    const tab = await resolveTab(tabId);
    return { detached: await detach(tab.id) };
  },

  async cdp_type({ tabId, text }) {
    await cdp(tabId, "Input.insertText", { text });
    return { ok: true };
  },

  async cdp_key({ tabId, key, modifiers = 0 }) {
    const map = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
    const code = map[key] || key.toUpperCase().charCodeAt(0);
    const base = { key, code: map[key] ? key : "Key" + key.toUpperCase(), windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", ...base, text: key.length === 1 ? key : undefined });
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
    return { ok: true };
  },

  async cdp_click_xy({ tabId, x, y, button = "left", clickCount = 1 }) {
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount });
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount });
    return { ok: true };
  },

  async cdp_wheel({ tabId, x = 200, y = 200, deltaY = 600, deltaX = 0 }) {
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY });
    return { ok: true };
  },

  async console_logs({ tabId, clear = false }) {
    const id = await attach(tabId);
    const st = attached.get(id);
    const logs = st.logs.slice();
    if (clear) st.logs.length = 0;
    return { tabId: id, count: logs.length, logs };
  },
};

// ---------------------------------------------------------------- websocket
async function handle(msg) {
  const fn = handlers[msg.cmd];
  if (!fn) throw new Error(`unknown command: ${msg.cmd}`);
  return fn(msg.args || {});
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    setStatus({ connected: false, lastError: String(e) });
    scheduleReconnect();
    return;
  }
  ws.onopen = async () => {
    reconnectDelay = 1000;
    setStatus({ connected: true, lastError: null, since: Date.now() });
    let token = null;
    try { token = (await chrome.storage.local.get("yxToken")).yxToken || null; } catch {}
    send({ type: "hello", protocol: PROTOCOL, ua: navigator.userAgent, version: chrome.runtime.getManifest().version, token });
    clearInterval(keepalive);
    keepalive = setInterval(() => send({ type: "ping", t: Date.now() }), 20000);
  };
  ws.onmessage = async (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "pong") return;
    if (msg.type === "auth") {
      if (msg.ok) setStatus({ connected: true, lastError: null, since: Date.now() });
      else setStatus({ connected: false, lastError: "err_wrong_password" });
      return;
    }
    if (!msg.id) return;
    // Kill-switch: while paused, refuse all agent commands (read/write/execute).
    // The connection stays open and ping/status still work so the UI shows state.
    if (paused && msg.cmd !== "ping") {
      send({ id: msg.id, ok: false, error: "ИИ-агент приостановлен пользователем в расширении (передача данных выключена)." });
      return;
    }
    try {
      const result = await handle(msg);
      status.handled++;
      send({ id: msg.id, ok: true, result });
    } catch (e) {
      send({ id: msg.id, ok: false, error: (e && e.message) || String(e) });
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    clearInterval(keepalive);
    setStatus({ connected: false });
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.6, 15000);
}

// ---------------------------------------------------------------- browsing stats
// Tracks active-tab time per domain, persisted in chrome.storage.local. Works
// whether or not the MCP server is connected; viewable from stats.html.
const STATS_MAX_GAP_MS = 5 * 60 * 1000; // don't count gaps > 5 min (sleep/idle)
function domainOf(url) { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : null; } catch { return null; } }
async function statsActiveDomain() {
  try {
    const w = await chrome.windows.getLastFocused({ populate: false });
    if (!w || !w.focused) return null;
    const [tab] = await chrome.tabs.query({ active: true, windowId: w.id });
    return tab ? domainOf(tab.url) : null;
  } catch { return null; }
}
async function statsFlush(newDomain, periodic = false) {
  const now = Date.now();
  const focusedDom = await statsActiveDomain(); // null when the browser window is not focused (minimized / covered by another app)
  // On a periodic tick we only credit time if the browser is currently focused —
  // so time spent while minimized or under a fullscreen app is never counted.
  const mayCredit = periodic ? focusedDom !== null : true;
  const sess = await chrome.storage.session.get("statCheckpoint").catch(() => ({}));
  const cp = sess.statCheckpoint;
  if (cp && cp.domain && mayCredit) {
    const elapsed = now - cp.ts;
    if (elapsed > 0 && elapsed < STATS_MAX_GAP_MS) {
      const secs = Math.round(elapsed / 1000);
      if (secs > 0) {
        const day = localDay();
        const store = await chrome.storage.local.get("stats");
        const s = store.stats || { totalSeconds: 0, byDomain: {}, byDay: {}, since: new Date().toISOString() };
        tzStamp(s);
        s.totalSeconds += secs;
        const d = (s.byDomain[cp.domain] = s.byDomain[cp.domain] || { seconds: 0, visits: 0, lastVisit: null });
        d.seconds += secs; d.lastVisit = new Date().toISOString();
        const dd = (s.byDay[day] = s.byDay[day] || { seconds: 0, byDomain: {}, byHour: {} });
        dd.seconds += secs; dd.byDomain[cp.domain] = (dd.byDomain[cp.domain] || 0) + secs;
        if (!dd.byHour) dd.byHour = {};
        const hr = new Date().getHours();
        dd.byHour[hr] = (dd.byHour[hr] || 0) + secs;
        // keep only last 60 days
        const days = Object.keys(s.byDay).sort(); while (days.length > 60) delete s.byDay[days.shift()];
        await chrome.storage.local.set({ stats: s });
      }
    }
  }
  const dom = newDomain !== undefined ? newDomain : focusedDom;
  if (dom && (!cp || cp.domain !== dom)) {
    const store = await chrome.storage.local.get("stats");
    const s = store.stats || { totalSeconds: 0, byDomain: {}, byDay: {}, since: new Date().toISOString() };
    const d = (s.byDomain[dom] = s.byDomain[dom] || { seconds: 0, visits: 0, lastVisit: null });
    tzStamp(s);
    d.visits += 1;
    await chrome.storage.local.set({ stats: s });
  }
  await chrome.storage.session.set({ statCheckpoint: { domain: dom, ts: now } });
}
chrome.tabs.onActivated.addListener(() => statsFlush());
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.status === "complete" && tab.active) statsFlush(); });
chrome.windows.onFocusChanged.addListener((wid) => statsFlush(wid === chrome.windows.WINDOW_ID_NONE ? null : undefined));
chrome.alarms.create("yx-stats-flush", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "yx-stats-flush") statsFlush(undefined, true); });

// Registrable ("main") domain: docs.github.com → github.com, m.youtube.com → youtube.com.
const STATS_MULTI_TLD = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au", "co.jp", "co.nz", "com.br", "com.tr", "co.in", "com.ua", "co.il", "com.cn", "com.mx", "com.sg", "com.hk", "com.ru"]);
function mainDomain(host) { const p = String(host).split("."); if (p.length <= 2) return host; const last2 = p.slice(-2).join("."); if (STATS_MULTI_TLD.has(last2)) return p.slice(-3).join("."); return last2; }
function fmtDHM(seconds) { const m = Math.round(seconds / 60); const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; const parts = []; if (d) parts.push(d + "д"); if (h) parts.push(h + "ч"); if (mm || !parts.length) parts.push(mm + "м"); return parts.join(" "); }

// Aggregate seconds by main domain over a date range (inclusive ISO yyyy-mm-dd).
function statsRange(s, fromDay, toDay) {
  const byMain = {};
  let total = 0;
  for (const [day, v] of Object.entries(s.byDay || {})) {
    if (fromDay && day < fromDay) continue;
    if (toDay && day > toDay) continue;
    for (const [host, sec] of Object.entries(v.byDomain || {})) { const md = mainDomain(host); byMain[md] = (byMain[md] || 0) + sec; total += sec; }
  }
  return { total, byMain };
}

async function statsGet(opts = {}) {
  const store = await chrome.storage.local.get("stats");
  const s = store.stats || { totalSeconds: 0, byDomain: {}, byDay: {}, since: null };
  const dayISO = (offset) => localDay(new Date(Date.now() - offset * 86400000));
  const today = dayISO(0);
  // fixed period totals (seconds), aggregated by main domain implicitly via byDay
  const periodSecs = (days) => { let t = 0; for (let i = 0; i < days; i++) { const d = s.byDay[dayISO(i)]; if (d) t += d.seconds; } return t; };
  const totals = { day: periodSecs(1), week: periodSecs(7), month: periodSecs(30), year: periodSecs(365) };
  // all-time visits by main domain
  const visitsByMain = {}, secsByMain = {};
  for (const [host, v] of Object.entries(s.byDomain)) { const md = mainDomain(host); visitsByMain[md] = (visitsByMain[md] || 0) + v.visits; secsByMain[md] = (secsByMain[md] || 0) + v.seconds; }
  const topByVisits = Object.entries(visitsByMain).map(([domain, visits]) => ({ domain, visits, minutes: Math.round((secsByMain[domain] || 0) / 60) })).sort((a, b) => b.visits - a.visits).slice(0, 30);
  // range breakdown (default: last 30 days)
  const from = opts.from || dayISO(29), to = opts.to || today;
  const range = statsRange(s, from, to);
  const topByTime = Object.entries(range.byMain).map(([domain, sec]) => ({ domain, minutes: Math.round(sec / 60), formatted: fmtDHM(sec) })).sort((a, b) => b.minutes - a.minutes).slice(0, 100);
  return {
    since: s.since,
    timezone: s.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    tzOffsetMinutes: typeof s.tzOffsetMin === "number" ? s.tzOffsetMin : -new Date().getTimezoneOffset(),
    totals: { day: { minutes: Math.round(totals.day / 60), formatted: fmtDHM(totals.day) }, week: { minutes: Math.round(totals.week / 60), formatted: fmtDHM(totals.week) }, month: { minutes: Math.round(totals.month / 60), formatted: fmtDHM(totals.month) }, year: { minutes: Math.round(totals.year / 60), formatted: fmtDHM(totals.year) } },
    range: { from, to, totalMinutes: Math.round(range.total / 60), totalFormatted: fmtDHM(range.total), sites: topByTime },
    topByVisits,
    domains: Object.keys(visitsByMain).length,
    byDay: Object.fromEntries(Object.entries(s.byDay).map(([d, v]) => [d, Math.round(v.seconds / 60)])),
  };
}

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.create("yx-bridge-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "yx-bridge-keepalive") connect();
});
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m && m.type === "status") {
    chrome.storage.local.get("yxToken").then((r) => {
      reply({ ...status, paused, hasPassword: !!r.yxToken, password: r.yxToken || null, url: WS_URL, version: chrome.runtime.getManifest().version, attached: [...attached.keys()] });
    }).catch(() => reply({ ...status, paused, url: WS_URL, version: chrome.runtime.getManifest().version, attached: [...attached.keys()] }));
    return true;
  } else if (m && m.type === "setPassword") {
    // Change/remove the connection password from the browser: store it and sync the server.
    const token = m.value ? String(m.value) : null;
    chrome.storage.local.set(token ? { yxToken: token } : {}).then(async () => {
      if (!token) await chrome.storage.local.remove("yxToken");
      send({ type: "set_token", token }); // update the server side over the live connection
      reply({ ok: true, hasPassword: !!token });
    }).catch((e) => reply({ ok: false, error: e.message }));
    return true;
  } else if (m && m.type === "pause") {
    paused = !!m.value;
    chrome.storage.local.set({ yxPaused: paused });
    setStatus({});
    reply({ ok: true, paused });
  } else if (m && m.type === "reconnect") {
    try {
      ws && ws.close();
    } catch {}
    ws = null;
    reconnectDelay = 500;
    connect();
    reply({ ok: true });
  }
  return true;
});

connect();
