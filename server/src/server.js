#!/usr/bin/env node
// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Yandex Browser MCP server. Talks to the "YX Bridge" extension over a local
// WebSocket (127.0.0.1:17555). Exposes tools to read open pages, manipulate DOM,
// run JS, take screenshots and send raw Chrome DevTools Protocol commands.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Bridge } from "./bridge.js";
import { locate, getTranslateSettings, applyTranslateSettings, closeBrowser, launchBrowser, isRunning } from "./profile.js";
import { uiList, uiClick, uiChain, translateMenu, supported as uiSupported } from "./ui.js";

const PORT = Number(process.env.BROWSER_BRIDGE_PORT || 17555);
const SHOT_DIR = process.env.BROWSER_SHOT_DIR || path.join(os.tmpdir(), "yx-bridge-shots");
const log = (m) => process.stderr.write(`[yx-bridge] ${m}\n`);

// Optional password so only the genuine extension (which stores the same password)
// may connect to the local port. Source: env YX_BRIDGE_TOKEN, else a token file.
const HERE = path.dirname(fileURLToPath(import.meta.url)); // works with spaces and non-Latin letters in the path
const PKG = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8")); } catch { return { version: "0.0.0" }; } })();
const TOKEN_FILE = process.env.YX_BRIDGE_TOKEN_FILE || path.join(HERE, "..", ".token");
function readToken() {
  if (process.env.YX_BRIDGE_TOKEN) return String(process.env.YX_BRIDGE_TOKEN).trim();
  try { const t = fs.readFileSync(TOKEN_FILE, "utf8").trim(); return t || null; } catch { return null; }
}
function writeToken(token) {
  if (token) fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  else { try { fs.unlinkSync(TOKEN_FILE); } catch {} }
}
let TOKEN = readToken();

const bridge = new Bridge({
  port: PORT, log, getToken: () => TOKEN,
  onSetToken: (token) => { TOKEN = token || null; writeToken(TOKEN); },
}).start();

const S = (type, extra = {}) => ({ type, ...extra });
const obj = (properties, required = []) => ({ type: "object", properties, required });
const TAB = S("number", { description: "Tab id (from browser_list_tabs). Omit = active tab." });

const tools = [
  {
    name: "browser_status",
    description: "Check whether the browser extension is connected; returns extension version and tabs with CDP attached.",
    inputSchema: obj({}),
    run: async () => {
      if (!bridge.connected) return { connected: false, passwordSet: !!TOKEN, hint: "Open the browser with the YX Bridge extension enabled; it auto-connects to ws://127.0.0.1:" + PORT + (TOKEN ? " (password required — the extension must have the matching password stored)" : "") };
      const r = await bridge.call("ping", {}, { timeoutMs: 5000 });
      return { connected: true, passwordSet: !!TOKEN, ...r, ua: bridge.hello && bridge.hello.ua };
    },
  },
  { name: "browser_list_tabs", description: "List all open tabs (id, windowId, url, title, active).", inputSchema: obj({}), run: () => bridge.call("list_tabs") },
  { name: "browser_active_tab", description: "Return the currently active tab.", inputSchema: obj({}), run: () => bridge.call("active_tab") },
  {
    name: "browser_open_tab",
    description: "Open a new tab with the given URL (in the work window if one is set, else the current window; windowId overrides).",
    inputSchema: obj({ url: S("string"), active: S("boolean", { description: "default true" }), windowId: S("number") }, ["url"]),
    run: (a) => bridge.call("open_tab", a),
  },
  {
    name: "browser_work_window",
    description: "Choose a 'work window' so the agent does not disturb the window the user is using: mode=least_tabs picks another window with the fewest tabs (creates one if there is only one window), mode=new opens a fresh window, or pass a windowId number; mode=clear resets; mode=status shows. While set, browser_open_tab/open_urls open there and tools without tabId use that window's active tab. Call this at the start of a session when the user is busy in their own window.",
    inputSchema: obj({ mode: S(["string", "number"], { description: "least_tabs | new | clear | status | <windowId>" }), url: S("string", { description: "for mode=new" }) }),
    run: (a) => bridge.call("work_window", a),
  },
  { name: "browser_close_tab", description: "Close a tab by id.", inputSchema: obj({ tabId: S("number") }, ["tabId"]), run: (a) => bridge.call("close_tab", a) },
  { name: "browser_activate_tab", description: "Make a tab active in its window; focusWindow=false keeps the user's current window in front.", inputSchema: obj({ tabId: S("number"), focusWindow: S("boolean") }, ["tabId"]), run: (a) => bridge.call("activate_tab", a) },
  {
    name: "browser_navigate",
    description: "Navigate a tab to a URL and wait for load.",
    inputSchema: obj({ tabId: TAB, url: S("string"), wait: S("boolean") }, ["url"]),
    run: (a) => bridge.call("navigate", a, { timeoutMs: 45000 }),
  },
  { name: "browser_reload", description: "Reload a tab.", inputSchema: obj({ tabId: TAB, bypassCache: S("boolean") }), run: (a) => bridge.call("reload", a, { timeoutMs: 45000 }) },
  { name: "browser_back", description: "Go back in a tab's history.", inputSchema: obj({ tabId: TAB }), run: (a) => bridge.call("go_back", a, { timeoutMs: 45000 }) },
  {
    name: "browser_get_page",
    description: "Get url, title and the visible text (innerText) of a page. Best first look at any tab. `translated: maybe` means Yandex auto-translate probably rewrote the text; pass original=true to re-fetch the page HTML (with the page's cookies) and return the untranslated text (server-rendered content only), or call browser_translation mode=off.",
    inputSchema: obj({ tabId: TAB, maxChars: S("number", { description: "default 20000" }), original: S("boolean", { description: "re-fetch HTML to bypass browser auto-translation" }) }),
    run: (a) => bridge.call("get_page", a),
  },
  {
    name: "browser_get_html",
    description: "Get HTML of the whole document or of the first element matching a CSS selector.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), outer: S("boolean", { description: "outerHTML (default) vs innerHTML" }), maxChars: S("number", { description: "default 30000" }) }),
    run: (a) => bridge.call("get_html", a),
  },
  {
    name: "browser_query",
    description: "querySelectorAll on the page: returns tag, id, class, text, href/src/value, bounding rect, visibility and requested attributes for each match.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), limit: S("number", { description: "default 50" }), attrs: S("array", { items: S("string"), description: "attribute names to include" }), textMax: S("number") }, ["selector"]),
    run: (a) => bridge.call("query", a),
  },
  {
    name: "browser_links",
    description: "List unique links (href + text) on the page.",
    inputSchema: obj({ tabId: TAB, limit: S("number", { description: "default 200" }) }),
    run: (a) => bridge.call("links", a),
  },
  { name: "browser_forms", description: "List forms and their fields (password values masked).", inputSchema: obj({ tabId: TAB }), run: (a) => bridge.call("forms", a) },
  {
    name: "browser_find_text",
    description: "Search the page's visible text for a substring; returns total count and snippets with surrounding context.",
    inputSchema: obj({ tabId: TAB, text: S("string"), limit: S("number", { description: "default 20" }), context: S("number", { description: "chars around each match, default 80" }), caseSensitive: S("boolean") }, ["text"]),
    run: (a) => bridge.call("find_text", a),
  },
  {
    name: "browser_tables",
    description: "Extract HTML tables as arrays of rows (headers detected from <thead>).",
    inputSchema: obj({ tabId: TAB, limit: S("number", { description: "max tables, default 10" }), maxRows: S("number", { description: "default 200" }) }),
    run: (a) => bridge.call("tables", a),
  },
  {
    name: "browser_wait_for",
    description: "Wait until a CSS selector and/or a text appears on the page (after navigation, clicks, AJAX). Returns found:true/false.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), text: S("string"), timeoutMs: S("number", { description: "default 15000" }) }),
    run: (a) => bridge.call("wait_for", a, { timeoutMs: (a.timeoutMs || 15000) + 5000 }),
  },
  {
    name: "browser_click",
    description: "Click the Nth element matching a CSS selector (dispatches pointer/mouse events + click()).",
    inputSchema: obj({ tabId: TAB, selector: S("string"), index: S("number", { description: "default 0" }) }, ["selector"]),
    run: (a) => bridge.call("click", a),
  },
  {
    name: "browser_type",
    description: "Type text into an input/textarea/contenteditable matched by selector. Fires input/change events (React/Vue-friendly). clear=true replaces, submit=true presses Enter / submits the form.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), text: S("string"), clear: S("boolean"), submit: S("boolean") }, ["selector", "text"]),
    run: (a) => bridge.call("type", a),
  },
  {
    name: "browser_select",
    description: "Choose an option in a <select> by value (default) or by visible text (byText=true). Fires input/change.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), value: S("string"), byText: S("boolean") }, ["selector", "value"]),
    run: (a) => bridge.call("select", a),
  },
  {
    name: "browser_translation",
    description: "Control Yandex Browser auto-translation. mode=off blocks it for all future page loads (registers a content script that marks pages notranslate at DOMContentLoaded); mode=on restores browser behaviour; mode=status just reports. reload=true (default) reloads the tab so the change applies immediately. Persists across browser restarts until switched back.",
    inputSchema: obj({ mode: S("string", { enum: ["off", "on", "status"] }), tabId: TAB, reload: S("boolean") }),
    run: (a) => bridge.call("translation", a, { timeoutMs: 45000 }),
  },
  {
    name: "browser_translate_settings_get",
    description: "Read Yandex Browser's translation settings straight from the profile's Preferences file: enabled, alwaysTranslate {lang:target}, neverOfferFrom [lang], neverTranslateSites [host]. Works even when the extension is not connected.",
    inputSchema: obj({ profile: S("string", { description: "profile dir name, default 'Default'" }) }),
    run: async (a) => {
      const loc = locate({ profile: a.profile });
      return { prefsFile: loc.prefs, browserRunning: await isRunning(loc), ...getTranslateSettings(loc) };
    },
  },
  {
    name: "browser_translate_settings_set",
    description: "Change Yandex Browser's translation settings by editing the profile's Preferences file. The browser MUST be closed while writing, so this tool closes it gracefully (all windows; session is restored on relaunch), writes, and relaunches it. A backup copy of Preferences is kept next to it. Fields: enabled (master 'offer to translate' switch); always {\"en\":\"ru\"} = 'always translate from'; neverOfferFrom [\"en\"] = 'never offer translation from' (this is the 'never translate English' setting); neverTranslateSites [\"host\"]; removeAlways / removeNeverOffer / removeSites to undo. Pass null for always/neverOfferFrom/neverTranslateSites to clear the whole list. Ask the user before running: it restarts their browser.",
    inputSchema: obj({
      enabled: S("boolean"),
      always: S("object", { description: "{sourceLang: targetLang}, or null to clear" }),
      neverOfferFrom: S("array", { items: S("string"), description: "language codes, or null to clear" }),
      neverTranslateSites: S("array", { items: S("string"), description: "hostnames, or null to clear" }),
      removeAlways: S("array", { items: S("string") }),
      removeNeverOffer: S("array", { items: S("string") }),
      removeSites: S("array", { items: S("string") }),
      profile: S("string"),
      relaunch: S("boolean", { description: "default true" }),
      force: S("boolean", { description: "kill the browser if it does not close within 20 s (default false)" }),
    }),
    run: async (a) => {
      const loc = locate({ profile: a.profile });
      const close = await closeBrowser(loc, { force: !!a.force });
      if (!close.closed) return { ok: false, ...close };
      await new Promise((r) => setTimeout(r, 800));
      const res = applyTranslateSettings(loc, a);
      const launch = a.relaunch === false ? { launched: false } : launchBrowser(loc);
      return { ok: true, closedBrowser: close, ...res, ...launch };
    },
  },
  {
    name: "browser_translate_menu",
    description: "Drive the Yandex Browser translate bubble like a human (Windows only, via UI Automation): opens the toolbar 'Переведено/Перевести' button and acts. action=status lists the bubble buttons and the ⋮ menu items; show_original / translate / translate_images click the bubble buttons; always_translate / never_offer / never_this_site / change_language toggle the ⋮ menu items ('never_offer' = 'Не предлагать перевод с <языка>', i.e. never translate that language). Applies instantly, no browser restart. The browser window must be visible (not minimized). Toggles flip the current state: check browser_translate_settings_get first.",
    inputSchema: obj({ action: S("string", { enum: ["status", "show_original", "translate", "translate_images", "always_translate", "never_offer", "never_this_site", "change_language"] }) }),
    run: (a) => translateMenu(a.action || "status"),
  },
  {
    name: "browser_ui_list",
    description: "List the browser's own UI controls (toolbar buttons, bubbles, menus, tabs) via Windows UI Automation, filtered by a regex over name/id/class. includeWeb=true also lists web-page accessibility nodes.",
    inputSchema: obj({ pattern: S("string", { description: "regex, default '.' ; '*' = everything" }), includeWeb: S("boolean") }),
    run: (a) => uiList(a.pattern || ".", !!a.includeWeb),
  },
  {
    name: "browser_ui_click",
    description: "Click a browser UI control found by regex (name/id/class), e.g. '^Переведено$', 'CustoAppMenuButton', 'Открыть панель загрузки'. Uses Invoke/Toggle/Select patterns, falls back to a real mouse click at the control's center.",
    inputSchema: obj({ pattern: S("string"), index: S("number") }, ["pattern"]),
    run: (a) => uiClick(a.pattern, a.index || 0),
  },
  {
    name: "browser_ui_chain",
    description: "Run a sequence of browser-UI steps in one go, separated by ';': click:<regex>[#idx] | wait:<regex> | list:<regex> | mouse:x,y | key:<ESC|ENTER|TAB|DOWN…> | sleep:<ms> | shot:<png path>. Example: 'click:^Переведено$;wait:YandexBaseBubbleFrameView;click:^Показать оригинал'.",
    inputSchema: obj({ steps: S("string"), timeoutMs: S("number", { description: "per wait/click, default 5000" }) }, ["steps"]),
    run: (a) => uiChain(a.steps, a.timeoutMs || 5000),
  },
  {
    name: "browser_launch",
    description: "Start Yandex Browser (optionally with extra command-line args) if it is not running.",
    inputSchema: obj({ args: S("array", { items: S("string") }), profile: S("string") }),
    run: async (a) => {
      const loc = locate({ profile: a.profile });
      if (await isRunning(loc)) return { launched: false, reason: "already running" };
      return launchBrowser(loc, a.args || []);
    },
  },
  {
    name: "browser_pdf",
    description: "Print the page to PDF via CDP and save it to disk; returns the file path.",
    inputSchema: obj({ tabId: TAB, saveTo: S("string", { description: "file path; default temp dir" }), landscape: S("boolean"), printBackground: S("boolean"), scale: S("number") }),
    run: async (a) => {
      const r = await bridge.call("pdf", a, { timeoutMs: 60000 });
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const file = a.saveTo || path.join(SHOT_DIR, `page-${Date.now()}.pdf`);
      fs.writeFileSync(file, Buffer.from(r.base64, "base64"));
      return { file, bytes: Buffer.byteLength(r.base64, "base64") };
    },
  },
  {
    name: "browser_reload_extension",
    description: "Reload the YX Bridge extension itself (after editing its files). The connection drops and comes back within a few seconds.",
    inputSchema: obj({}),
    run: (a) => bridge.call("reload_extension", a),
  },
  {
    name: "browser_set_html",
    description: "Replace or extend an element's HTML. mode: inner (default) | outer | append | prepend | text.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), html: S("string"), mode: S("string") }, ["selector", "html"]),
    run: (a) => bridge.call("set_html", a),
  },
  {
    name: "browser_set_attr",
    description: "Set (or remove, when value is null) an attribute on matching element(s).",
    inputSchema: obj({ tabId: TAB, selector: S("string"), name: S("string"), value: S("string"), all: S("boolean") }, ["selector", "name"]),
    run: (a) => bridge.call("set_attr", a),
  },
  {
    name: "browser_set_style",
    description: "Apply inline CSS styles (object of camelCase props) to matching element(s).",
    inputSchema: obj({ tabId: TAB, selector: S("string"), styles: S("object"), all: S("boolean") }, ["selector", "styles"]),
    run: (a) => bridge.call("set_style", a),
  },
  {
    name: "browser_remove",
    description: "Remove matching element(s) from the DOM.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), all: S("boolean") }, ["selector"]),
    run: (a) => bridge.call("remove", a),
  },
  {
    name: "browser_inject_css",
    description: "Inject a CSS stylesheet into the page.",
    inputSchema: obj({ tabId: TAB, css: S("string") }, ["css"]),
    run: (a) => bridge.call("inject_css", a),
  },
  {
    name: "browser_scroll",
    description: "Scroll the window by x/y pixels, or scroll an element (selector) into view.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), x: S("number"), y: S("number") }),
    run: (a) => bridge.call("scroll", a),
  },
  {
    name: "browser_eval",
    description: "Run JavaScript in the page's own context via CDP and return the result (use `return`; async/await allowed). Sees page globals (window.*, frameworks), bypasses CSP. Attaches the debugger: the browser shows a 'being debugged' bar until browser_cdp_detach. For plain DOM reads/edits prefer browser_query / browser_set_* which need no debugger.",
    inputSchema: obj({ tabId: TAB, code: S("string"), timeoutMs: S("number") }, ["code"]),
    run: (a) => bridge.call("eval", a, { timeoutMs: (a.timeoutMs || 30000) + 5000 }),
  },
  {
    name: "browser_screenshot",
    description: "Screenshot a tab (activates it). fullPage=true captures the whole scrollable page via CDP. Saves PNG/JPEG to disk and returns the path plus the image.",
    inputSchema: obj({ tabId: TAB, format: S("string", { enum: ["png", "jpeg"] }), quality: S("number"), fullPage: S("boolean"), saveTo: S("string", { description: "file path; default temp dir" }) }),
    run: async (a) => {
      const r = await bridge.call("screenshot", a, { timeoutMs: 30000 });
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const file = a.saveTo || path.join(SHOT_DIR, `shot-${Date.now()}.${r.format === "jpeg" ? "jpg" : "png"}`);
      fs.writeFileSync(file, Buffer.from(r.base64, "base64"));
      return { __image: { data: r.base64, mimeType: r.format === "jpeg" ? "image/jpeg" : "image/png" }, file, width: r.width, height: r.height };
    },
  },
  {
    name: "browser_console_logs",
    description: "Return console.log/warn/error and uncaught exceptions captured in a tab (attaches CDP; collection starts at first attach).",
    inputSchema: obj({ tabId: TAB, clear: S("boolean") }),
    run: (a) => bridge.call("console_logs", a),
  },
  // ---- windows & tabs, extended ----
  { name: "browser_windows", description: "List all browser windows with their tabs (id, focused, state, incognito).", inputSchema: obj({}), run: () => bridge.call("windows_list") },
  { name: "browser_window_new", description: "Open a new window (optionally incognito, with a URL, size or state normal|minimized|maximized|fullscreen).", inputSchema: obj({ url: S("string"), incognito: S("boolean"), state: S("string"), width: S("number"), height: S("number") }), run: (a) => bridge.call("window_new", a) },
  { name: "browser_window_close", description: "Close a window and all its tabs.", inputSchema: obj({ windowId: S("number") }, ["windowId"]), run: (a) => bridge.call("window_close", a) },
  { name: "browser_window_focus", description: "Focus a window; optionally set its state (normal|minimized|maximized|fullscreen).", inputSchema: obj({ windowId: S("number"), state: S("string") }, ["windowId"]), run: (a) => bridge.call("window_focus", a) },
  { name: "browser_tab_update", description: "Pin/unpin, mute/unmute, activate or change the URL of a tab.", inputSchema: obj({ tabId: TAB, pinned: S("boolean"), muted: S("boolean"), url: S("string"), active: S("boolean") }), run: (a) => bridge.call("tab_update", a) },
  { name: "browser_tab_duplicate", description: "Duplicate a tab.", inputSchema: obj({ tabId: TAB }), run: (a) => bridge.call("tab_duplicate", a) },
  { name: "browser_find_tabs", description: "Find open tabs whose URL or title matches a regex.", inputSchema: obj({ pattern: S("string") }, ["pattern"]), run: (a) => bridge.call("find_tabs", a) },
  { name: "browser_open_urls", description: "Open several URLs at once (background tabs by default).", inputSchema: obj({ urls: S("array", { items: S("string") }), active: S("boolean") }, ["urls"]), run: (a) => bridge.call("open_urls", a) },
  { name: "browser_close_tabs", description: "Close many tabs by id list and/or by URL/title regex.", inputSchema: obj({ pattern: S("string"), tabIds: S("array", { items: S("number") }) }), run: (a) => bridge.call("close_tabs", a) },
  { name: "browser_zoom", description: "Get or set the zoom factor of a tab (1 = 100%).", inputSchema: obj({ tabId: TAB, factor: S("number") }), run: (a) => bridge.call("zoom", a) },

  // ---- history / bookmarks / downloads / cookies / sessions ----
  { name: "browser_history_search", description: "Search browsing history by text (empty = most recent), within the last N days.", inputSchema: obj({ text: S("string"), maxResults: S("number"), daysBack: S("number") }), run: (a) => bridge.call("history_search", a) },
  { name: "browser_history_delete_url", description: "Remove one URL from browsing history.", inputSchema: obj({ url: S("string") }, ["url"]), run: (a) => bridge.call("history_delete_url", a) },
  { name: "browser_bookmarks_search", description: "Search bookmarks by text (empty = most recent).", inputSchema: obj({ query: S("string"), limit: S("number") }), run: (a) => bridge.call("bookmarks_search", a) },
  { name: "browser_bookmarks_tree", description: "Full bookmarks tree (folders and links).", inputSchema: obj({}), run: () => bridge.call("bookmarks_tree") },
  { name: "browser_bookmark_add", description: "Add a bookmark (parentId from browser_bookmarks_tree; default = 'Other bookmarks').", inputSchema: obj({ title: S("string"), url: S("string"), parentId: S("string") }, ["title", "url"]), run: (a) => bridge.call("bookmark_add", a) },
  { name: "browser_bookmark_remove", description: "Remove a bookmark by id.", inputSchema: obj({ id: S("string") }, ["id"]), run: (a) => bridge.call("bookmark_remove", a) },
  { name: "browser_download", description: "Download a URL through the browser (uses the browser's cookies/session) into the Downloads folder; waits up to 30 s for completion. filename may include subfolders.", inputSchema: obj({ url: S("string"), filename: S("string"), saveAs: S("boolean"), conflictAction: S("string", { enum: ["uniquify", "overwrite", "prompt"] }) }, ["url"]), run: (a) => bridge.call("download", a, { timeoutMs: 45000 }) },
  { name: "browser_downloads_list", description: "List recent downloads (state: in_progress|complete|interrupted).", inputSchema: obj({ limit: S("number"), state: S("string") }), run: (a) => bridge.call("downloads_list", a) },
  { name: "browser_cookies_get", description: "Read cookies for a URL or domain (optionally one name). Values are returned in clear: treat as secrets.", inputSchema: obj({ url: S("string"), domain: S("string"), name: S("string") }), run: (a) => bridge.call("cookies_get", a) },
  { name: "browser_cookie_set", description: "Set a cookie for a URL.", inputSchema: obj({ url: S("string"), name: S("string"), value: S("string"), domain: S("string"), path: S("string"), secure: S("boolean"), httpOnly: S("boolean"), expirationDays: S("number") }, ["url", "name", "value"]), run: (a) => bridge.call("cookie_set", a) },
  { name: "browser_cookie_remove", description: "Delete one cookie by URL and name.", inputSchema: obj({ url: S("string"), name: S("string") }, ["url", "name"]), run: (a) => bridge.call("cookie_remove", a) },
  { name: "browser_clear_data", description: "Clear browsing data: types from cache, cookies, localStorage, indexedDB, serviceWorkers, cacheStorage, history, downloads, formData, passwords; optionally only for given origins (https://example.com) and only newer than sinceDays. Confirm with the user before clearing anything but cache.", inputSchema: obj({ origins: S("array", { items: S("string") }), types: S("array", { items: S("string") }), sinceDays: S("number") }), run: (a) => bridge.call("clear_data", a) },
  { name: "browser_recent_closed", description: "Recently closed tabs and windows with sessionIds.", inputSchema: obj({ max: S("number") }), run: (a) => bridge.call("recent_closed", a) },
  { name: "browser_restore_session", description: "Reopen a recently closed tab/window by sessionId (omit = most recent).", inputSchema: obj({ sessionId: S("string") }), run: (a) => bridge.call("restore_session", a) },

  {
    name: "browser_session_save",
    description: "Save all open windows and tabs (urls, titles, pinned, active) to a JSON file so they can be reopened later with browser_session_load. windowId limits it to one window. Default file: <temp>/yx-bridge-shots/session-<timestamp>.json.",
    inputSchema: obj({ file: S("string"), windowId: S("number") }),
    run: async (a) => {
      const wins = await bridge.call("windows_list");
      const sel = a.windowId ? wins.filter((w) => w.id === a.windowId) : wins;
      const data = { savedAt: new Date().toISOString(), windows: sel.map((w) => ({ id: w.id, incognito: w.incognito, tabs: w.tabs.filter((t) => /^(https?|file):/i.test(t.url || "")).map((t) => ({ url: t.url, title: t.title, pinned: t.pinned, active: t.active })) })) };
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const file = a.file || path.join(SHOT_DIR, `session-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(data, null, 1));
      return { file, windows: data.windows.length, tabs: data.windows.reduce((n, w) => n + w.tabs.length, 0) };
    },
  },
  {
    name: "browser_session_load",
    description: "Reopen a session saved by browser_session_save: each saved window becomes a new window with its tabs (background, pinned restored). newWindow=false opens everything as tabs in the work/current window instead. Pass windowIndex to restore only one saved window.",
    inputSchema: obj({ file: S("string"), newWindow: S("boolean", { description: "default true" }), windowIndex: S("number") }, ["file"]),
    run: async (a) => {
      const data = JSON.parse(fs.readFileSync(a.file, "utf8"));
      const wins = a.windowIndex != null ? [data.windows[a.windowIndex]] : data.windows;
      const out = [];
      for (const w of wins) {
        if (!w || !w.tabs.length) continue;
        const urls = w.tabs.map((t) => t.url);
        let windowId;
        if (a.newWindow !== false) {
          const nw = await bridge.call("window_new", { url: urls[0] });
          windowId = nw.id;
          if (urls.length > 1) await bridge.call("open_urls", { urls: urls.slice(1), windowId, active: false });
        } else {
          await bridge.call("open_urls", { urls, active: false });
        }
        const pinned = w.tabs.filter((t) => t.pinned).length;
        if (pinned && windowId) {
          const tabs = (await bridge.call("windows_list")).find((x) => x.id === windowId)?.tabs || [];
          for (const t of w.tabs) if (t.pinned) { const m = tabs.find((x) => x.url === t.url); if (m) await bridge.call("tab_update", { tabId: m.id, pinned: true }); }
        }
        out.push({ windowId: windowId || "current", tabs: urls.length, pinned });
      }
      return { restored: out, savedAt: data.savedAt };
    },
  },

  // ---- user-facing ----
  { name: "browser_notify", description: "Show a desktop notification from the browser (e.g. to tell the user a long task finished).", inputSchema: obj({ title: S("string"), message: S("string") }, ["message"]), run: (a) => bridge.call("notify", a) },
  { name: "browser_speak", description: "Read text aloud with the browser's text-to-speech (lang e.g. 'ru-RU', 'en-US'); stop=true stops.", inputSchema: obj({ text: S("string"), lang: S("string"), rate: S("number"), stop: S("boolean") }), run: (a) => bridge.call("speak", a) },
  { name: "browser_search", description: "Search with the browser's default search engine (opens a new tab, or CURRENT_TAB / NEW_WINDOW).", inputSchema: obj({ text: S("string"), disposition: S("string", { enum: ["NEW_TAB", "CURRENT_TAB", "NEW_WINDOW"] }) }, ["text"]), run: (a) => bridge.call("search", a) },

  // ---- page-level extras ----
  { name: "browser_fill_form", description: "Fill several fields at once: {selectorOrName: value}. Handles inputs, textareas, selects (by value or text), checkboxes/radios (true/false), contenteditable. submitSelector clicks a button afterwards (or submits the form if not found).", inputSchema: obj({ tabId: TAB, fields: S("object"), submitSelector: S("string") }, ["fields"]), run: (a) => bridge.call("fill_form", a) },
  { name: "browser_extract", description: "Structured scraping: spec {name: 'css' | {selector, attr?, all?, html?}} → {name: value | [values]}. E.g. {title:'h1', prices:{selector:'.price',all:true}, link:{selector:'a.next',attr:'href'}}.", inputSchema: obj({ tabId: TAB, spec: S("object"), textMax: S("number") }, ["spec"]), run: (a) => bridge.call("extract", a) },
  { name: "browser_storage", description: "Read/write the page's localStorage or sessionStorage: op get (key or all) | set | remove | clear | keys.", inputSchema: obj({ tabId: TAB, area: S("string", { enum: ["local", "session"] }), op: S("string", { enum: ["get", "set", "remove", "clear", "keys"] }), key: S("string"), value: S("string") }), run: (a) => bridge.call("storage", a) },
  { name: "browser_meta", description: "Page metadata: title, canonical, favicon, description, OpenGraph/Twitter tags, all <meta>, JSON-LD blocks, h1/h2 outline.", inputSchema: obj({ tabId: TAB }), run: (a) => bridge.call("meta", a) },
  { name: "browser_article", description: "Extract the main article text (readability-style: <article>/<main> or the densest text block, menus/footers stripped). Better than get_page for news, docs, blog posts.", inputSchema: obj({ tabId: TAB, maxChars: S("number") }), run: (a) => bridge.call("article", a) },
  { name: "browser_hover", description: "Hover an element (dispatches pointer/mouse over/enter/move) to reveal menus and tooltips.", inputSchema: obj({ tabId: TAB, selector: S("string") }, ["selector"]), run: (a) => bridge.call("hover", a) },
  { name: "browser_press_key", description: "Dispatch a keyboard event on an element (or the focused one) without the debugger: key Enter|Escape|Tab|ArrowDown|a…, with ctrl/shift/alt/meta flags. For editors that ignore synthetic events use browser_cdp_key.", inputSchema: obj({ tabId: TAB, selector: S("string"), key: S("string"), ctrl: S("boolean"), shift: S("boolean"), alt: S("boolean"), meta: S("boolean") }, ["key"]), run: (a) => bridge.call("press_key", a) },
  { name: "browser_highlight", description: "Draw a coloured outline around matching elements (visual debugging; take a screenshot after).", inputSchema: obj({ tabId: TAB, selector: S("string"), color: S("string"), all: S("boolean") }, ["selector"]), run: (a) => bridge.call("highlight", a) },
  { name: "browser_scroll_bottom", description: "Scroll to the bottom repeatedly until the page stops growing (loads infinite feeds), then stop.", inputSchema: obj({ tabId: TAB, maxSteps: S("number"), delayMs: S("number") }), run: (a) => bridge.call("scroll_bottom", a, { timeoutMs: 120000 }) },
  {
    name: "browser_element_screenshot",
    description: "Screenshot of one element (by CSS selector) via CDP; saves a file and returns the image.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), format: S("string", { enum: ["png", "jpeg"] }), saveTo: S("string") }, ["selector"]),
    run: async (a) => {
      const r = await bridge.call("element_screenshot", a, { timeoutMs: 30000 });
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const file = a.saveTo || path.join(SHOT_DIR, `el-${Date.now()}.${r.format === "jpeg" ? "jpg" : "png"}`);
      fs.writeFileSync(file, Buffer.from(r.base64, "base64"));
      return { __image: { data: r.base64, mimeType: r.format === "jpeg" ? "image/jpeg" : "image/png" }, file, width: r.width, height: r.height };
    },
  },

  // ---- media ----
  {
    name: "browser_media_list",
    description: "Catalogue all media on the page: images (best-resolution URL from srcset/picture, alt, natural size, link), <video> elements (direct URL or blob/MSE, sources, poster, duration, selector), <audio>, video embeds (YouTube/VK/Rutube… iframes) and direct links to media files. minSize filters icons. Use before browser_image_view / browser_media_download / browser_video_frames.",
    inputSchema: obj({ tabId: TAB, limit: S("number", { description: "default 200" }), includeBackgrounds: S("boolean", { description: "also CSS background images" }), minSize: S("number", { description: "skip images smaller than this px on both sides, default 50" }) }),
    run: (a) => bridge.call("media_list", a),
  },
  {
    name: "browser_image_view",
    description: "Fetch an image from inside the page (with the page's cookies, so protected images work), downscale it and return it to the agent as an image to look at. Also saves a copy to disk. url from browser_media_list. maxSide default 1280.",
    inputSchema: obj({ tabId: TAB, url: S("string"), maxSide: S("number"), quality: S("number"), saveTo: S("string") }, ["url"]),
    run: async (a) => {
      const r = await bridge.call("image_view", a, { timeoutMs: 45000 });
      if (!r.ok) return r;
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const ext = r.mime === "image/jpeg" ? "jpg" : (r.mime.split("/")[1] || "bin").replace("svg+xml", "svg");
      const file = a.saveTo || path.join(SHOT_DIR, `img-${Date.now()}.${ext}`);
      fs.writeFileSync(file, Buffer.from(r.base64, "base64"));
      const { base64, ...rest } = r;
      return { __image: { data: base64, mimeType: r.mime }, file, ...rest };
    },
  },
  {
    name: "browser_media_download",
    description: "Download media files (images, videos, audio by URL from browser_media_list or any URL) through the browser into Downloads/yx-bridge/<host>/ (or a custom subfolder). Uses the page's session, so login-protected files work. Direct file URLs only: blob:/MSE streams (YouTube etc.) cannot be downloaded this way, use browser_video_frames to look at them.",
    inputSchema: obj({ tabId: TAB, urls: S("array", { items: S("string") }), folder: S("string", { description: "subfolder under Downloads" }) }, ["urls"]),
    run: (a) => bridge.call("media_download", a, { timeoutMs: 30000 * Math.max(1, (a.urls || []).length) }),
  },
  {
    name: "browser_video_control",
    description: "Control a <video> on the page: action info | play | pause | seek (value=seconds) | mute | unmute | speed (value=rate) | volume (value 0..1) | fullscreen. selector optional (first video by default; use the selector from browser_media_list). Works on YouTube, VK, Rutube and any HTML5 player.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), action: S("string", { enum: ["info", "play", "pause", "seek", "mute", "unmute", "speed", "volume", "fullscreen"] }), value: S("number") }),
    run: (a) => bridge.call("video_control", a),
  },
  {
    name: "browser_keep_visible",
    description: "Make a background/occluded tab behave as visible and focused (CDP focus emulation + document.visibilityState override) so players, timers and lazy loading keep working without bringing the window to front. Auto-applied by browser_video_frames / video_control play; call it manually before scroll_bottom or long waits in a work window. Attaches the debugger.",
    inputSchema: obj({ tabId: TAB }),
    run: (a) => bridge.call("keep_visible", a),
  },
  {
    name: "browser_video_frames",
    description: "Grab frames from a <video> on the page at given times (seconds; default 10/30/50/70/90% of duration) and return them to the agent as images, so it can 'watch' the video. Works for same-origin and MSE players (YouTube, VK, Rutube); cross-origin files without CORS return an error per frame. Saves frames to disk too.",
    inputSchema: obj({ tabId: TAB, selector: S("string"), times: S("array", { items: S("number") }), maxSide: S("number", { description: "default 960" }), quality: S("number") }),
    run: async (a) => {
      const r = await bridge.call("video_frames", a, { timeoutMs: 90000 });
      if (!r.ok) return r;
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const content = [];
      const files = [];
      for (const f of r.frames) {
        if (!f.base64) { files.push({ time: f.time, error: f.error }); continue; }
        const file = path.join(SHOT_DIR, `frame-${Date.now()}-${String(f.time).replace(".", "_")}.jpg`);
        fs.writeFileSync(file, Buffer.from(f.base64, "base64"));
        files.push({ time: f.time, file });
        content.push({ type: "image", data: f.base64, mimeType: "image/jpeg" });
      }
      return { __images: content, duration: r.duration, width: r.width, height: r.height, frames: files };
    },
  },

  // ---- students (e-learning) ----
  {
    name: "browser_quiz_extract",
    description: "Scan an e-learning / test page for questions and answer inputs: radio/checkbox groups (with option labels and selectors), text/number/textarea answers, and <select> questions. Use to understand a quiz, then browser_choose / browser_type / browser_select to answer.",
    inputSchema: obj({ tabId: TAB, limit: S("number") }),
    run: (a) => bridge.call("quiz_extract", a),
  },
  {
    name: "browser_choose",
    description: "Pick a radio/checkbox answer by its visible label text (partial match; exact=true for exact). groupSelector limits the search to one question container. Clicks the label and fires change events.",
    inputSchema: obj({ tabId: TAB, label: S("string"), groupSelector: S("string"), exact: S("boolean") }, ["label"]),
    run: (a) => bridge.call("choose", a),
  },
  {
    name: "browser_math_extract",
    description: "Extract mathematical formulas from the page: MathML, LaTeX/TeX sources (MathJax/KaTeX annotations), and inline $…$ / \\(…\\) expressions. For solving math problems shown as rendered formulas.",
    inputSchema: obj({ tabId: TAB }),
    run: (a) => bridge.call("math_extract", a),
  },

  // ---- testers / security ----
  {
    name: "browser_fetch",
    description: "Make an HTTP request from the page's own context (with the site's cookies and origin), returning status, response headers and body. For probing APIs, testing endpoints, replaying requests. Subject to the page's CORS for cross-origin URLs; same-origin is unrestricted.",
    inputSchema: obj({ tabId: TAB, url: S("string"), method: S("string"), headers: S("object"), body: S("string"), maxChars: S("number") }, ["url"]),
    run: (a) => bridge.call("fetch_url", a, { timeoutMs: 45000 }),
  },
  {
    name: "browser_iframes",
    description: "List the page's iframes/frames: src, origin, same-origin flag, sandbox attribute, size. For mapping embedded content and cross-origin boundaries.",
    inputSchema: obj({ tabId: TAB }),
    run: (a) => bridge.call("iframes", a),
  },
  {
    name: "browser_storage_dump",
    description: "Dump everything a page stores on the client: localStorage, sessionStorage, JS-visible cookies, plus all cookies for the URL (including HttpOnly, with flags). Sensitive: may contain tokens and session data.",
    inputSchema: obj({ tabId: TAB }),
    run: (a) => bridge.call("storage_dump", a),
  },
  {
    name: "browser_security_scan",
    description: "Passive security overview of the page (authorized testing / your own sites): CSP header and meta, HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy / COOP, inline vs external script counts and their origins, forms (method, password/file fields, CSRF-token presence, https action), mixed-content resources, password fields served over http. Read-only, no payloads sent.",
    inputSchema: obj({ tabId: TAB }),
    run: (a) => bridge.call("security_scan", a),
  },
  {
    name: "browser_accessibility_tree",
    description: "The page's accessibility (AX) tree via CDP: roles, names, values, headings levels. A compact semantic map of the page, useful for understanding structure and for automated testing.",
    inputSchema: obj({ tabId: TAB, maxNodes: S("number") }),
    run: (a) => bridge.call("accessibility_tree", a),
  },
  {
    name: "browser_outline",
    description: "Quick structural outline for summarizing a page fast: title, heading tree, ARIA landmarks, and counts of images/links/forms/iframes/videos/tables/buttons.",
    inputSchema: obj({ tabId: TAB }),
    run: (a) => bridge.call("outline", a),
  },

  {
    name: "browser_page_code",
    description: "Return the page's code: the rendered outer HTML, all inline <script> and <style> contents, and the URLs of external scripts and stylesheets. For reading how a page works or auditing it. Large; prefer browser_snapshot to dump it to files.",
    inputSchema: obj({ tabId: TAB, maxChars: S("number", { description: "cap on HTML length, default 500000" }) }),
    run: async (a) => {
      const c = await bridge.call("collect_code", a);
      const cap = a.maxChars || 500000;
      return { htmlLength: c.html.length, html: c.html.slice(0, cap), htmlTruncated: c.html.length > cap, inlineScripts: c.inlineScripts, inlineStyles: c.inlineStyles, externalScripts: c.extScripts, externalStyles: c.extStyles };
    },
  },

  // ---- full extraction ----
  {
    name: "browser_snapshot",
    description: "Download a whole page to a folder in one call: page.html (full DOM), text.txt (visible text), article.txt (main readable text), meta.json, outline.json, links.json, media.json (image/video/audio catalogue), screenshot.png (full page), and the page code — inline scripts/styles saved as files and a code.json listing external script/style URLs. With downloadImages=true it also saves every image into images/. Returns the folder path and a manifest. This is the 'suck everything out of this page' tool.",
    inputSchema: obj({ tabId: TAB, dir: S("string", { description: "output folder; default <temp>/yx-bridge-shots/snapshot-<timestamp>" }), downloadImages: S("boolean", { description: "also download all images (default true)" }), maxImages: S("number", { description: "default 60" }) }),
    run: async (a) => {
      const dir = a.dir || path.join(SHOT_DIR, `snapshot-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      const manifest = { dir, files: [] };
      const save = (name, content) => { const p = path.join(dir, name); fs.writeFileSync(p, content); manifest.files.push(name); };
      const page = await bridge.call("get_page", { tabId: a.tabId, maxChars: 5000000 });
      manifest.url = page.url; manifest.title = page.title;
      save("text.txt", page.text);
      const html = await bridge.call("get_html", { tabId: a.tabId, maxChars: 20000000 });
      save("page.html", html.html || "");
      try { save("article.txt", (await bridge.call("article", { tabId: a.tabId, maxChars: 5000000 })).text || ""); } catch {}
      try { save("meta.json", JSON.stringify(await bridge.call("meta", { tabId: a.tabId }), null, 1)); } catch {}
      try { save("outline.json", JSON.stringify(await bridge.call("outline", { tabId: a.tabId }), null, 1)); } catch {}
      try { save("links.json", JSON.stringify(await bridge.call("links", { tabId: a.tabId, limit: 5000 }), null, 1)); } catch {}
      let media = { images: [] };
      try { media = await bridge.call("media_list", { tabId: a.tabId, limit: 1000, includeBackgrounds: true }); save("media.json", JSON.stringify(media, null, 1)); } catch {}
      try { const code = await bridge.call("collect_code", { tabId: a.tabId }); fs.mkdirSync(path.join(dir, "code"), { recursive: true }); code.inlineScripts.forEach((s, i) => save(`code/inline-script-${i}.js`, s)); code.inlineStyles.forEach((s, i) => save(`code/inline-style-${i}.css`, s)); save("code.json", JSON.stringify({ externalScripts: code.extScripts, externalStyles: code.extStyles }, null, 1)); } catch {}
      try { await bridge.call("keep_visible", { tabId: a.tabId }).catch(() => {}); const shot = await bridge.call("screenshot", { tabId: a.tabId, fullPage: true, format: "png" }); fs.writeFileSync(path.join(dir, "screenshot.png"), Buffer.from(shot.base64, "base64")); manifest.files.push("screenshot.png"); await bridge.call("cdp_detach", { tabId: a.tabId }).catch(() => {}); } catch (e) { manifest.screenshotError = e.message; }
      let imagesSaved = 0;
      if (a.downloadImages !== false && media.images && media.images.length) {
        const urls = [...new Set(media.images.map((i) => i.url).filter((u) => u && !u.startsWith("data:")))].slice(0, a.maxImages || 60);
        const imgDir = path.join(dir, "images");
        fs.mkdirSync(imgDir, { recursive: true });
        const extOf = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "image/avif": ".avif" };
        for (let i = 0; i < urls.length; i++) {
          try {
            const b = await bridge.call("download_bytes", { url: urls[i] }, { timeoutMs: 30000 });
            if (!b.ok) continue;
            let name = "img";
            try { name = decodeURIComponent(new URL(urls[i]).pathname.split("/").pop() || "img").replace(/[^\w.\-]+/g, "_").slice(0, 60); } catch {}
            if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += (extOf[b.mime.split(";")[0]] || ".bin");
            fs.writeFileSync(path.join(imgDir, `${String(i).padStart(3, "0")}-${name}`), Buffer.from(b.base64, "base64"));
            imagesSaved++;
          } catch {}
        }
        if (imagesSaved) manifest.imagesFolder = "images";
      }
      manifest.counts = { textChars: (page.text || "").length, htmlChars: (html.html || "").length, images: media.images ? media.images.length : 0, imagesDownloaded: imagesSaved };
      save("manifest.json", JSON.stringify(manifest, null, 1));
      return manifest;
    },
  },

  // ---- emulation / network (CDP) ----
  { name: "browser_set_viewport", description: "Emulate a device viewport (width/height/scale, mobile=true adds touch). width=0 clears the override.", inputSchema: obj({ tabId: TAB, width: S("number"), height: S("number"), mobile: S("boolean"), scale: S("number") }), run: (a) => bridge.call("set_viewport", a) },
  { name: "browser_set_user_agent", description: "Override the User-Agent (and optionally Accept-Language / platform) for a tab; reload afterwards.", inputSchema: obj({ tabId: TAB, userAgent: S("string"), acceptLanguage: S("string"), platform: S("string") }, ["userAgent"]), run: (a) => bridge.call("set_user_agent", a) },
  { name: "browser_geolocation", description: "Override geolocation for a tab (latitude/longitude/accuracy) or clear=true.", inputSchema: obj({ tabId: TAB, latitude: S("number"), longitude: S("number"), accuracy: S("number"), clear: S("boolean") }), run: (a) => bridge.call("geolocation", a) },
  { name: "browser_network_start", description: "Start recording network requests of a tab (URL, method, type, status, mime, size, errors). Reload or interact afterwards, then read with browser_network_log.", inputSchema: obj({ tabId: TAB }), run: (a) => bridge.call("network_start", a) },
  { name: "browser_network_log", description: "Recorded requests since browser_network_start; filter = regex over URL/type; clear=true empties the buffer.", inputSchema: obj({ tabId: TAB, filter: S("string"), limit: S("number"), clear: S("boolean") }), run: (a) => bridge.call("network_log", a) },
  { name: "browser_network_stop", description: "Stop recording network requests.", inputSchema: obj({ tabId: TAB }), run: (a) => bridge.call("network_stop", a) },
  { name: "browser_response_body", description: "Body of the latest recorded response whose URL matches a regex (JSON APIs, XHR). Needs browser_network_start before the request happened.", inputSchema: obj({ tabId: TAB, urlPattern: S("string") }, ["urlPattern"]), run: (a) => bridge.call("response_body", a) },
  { name: "browser_block_urls", description: "Block requests matching URL patterns (wildcards *), e.g. ['*ads*','*.gif']. Empty list unblocks.", inputSchema: obj({ tabId: TAB, patterns: S("array", { items: S("string") }) }, ["patterns"]), run: (a) => bridge.call("block_urls", a) },
  { name: "browser_dialogs", description: "Auto-handle alert/confirm/prompt dialogs in a tab: mode accept | dismiss | off (promptText for prompts). Returns dialogs seen so far.", inputSchema: obj({ tabId: TAB, mode: S("string", { enum: ["accept", "dismiss", "off"] }), promptText: S("string") }), run: (a) => bridge.call("dialogs", a) },
  {
    name: "browser_cdp",
    description: "Send a raw Chrome DevTools Protocol command to a tab (e.g. method 'DOM.getDocument', 'Network.enable', 'Emulation.setDeviceMetricsOverride'). Attaches the debugger.",
    inputSchema: obj({ tabId: TAB, method: S("string"), params: S("object") }, ["method"]),
    run: (a) => bridge.call("cdp", a, { timeoutMs: 60000 }),
  },
  { name: "browser_cdp_type", description: "Type text with real input events via CDP Input.insertText (works with editors that ignore DOM value changes, e.g. Slate/Draft).", inputSchema: obj({ tabId: TAB, text: S("string") }, ["text"]), run: (a) => bridge.call("cdp_type", a) },
  { name: "browser_cdp_key", description: "Press a key via CDP (Enter, Tab, Escape, Backspace, ArrowDown… or a single character). modifiers bitmask: 1=Alt 2=Ctrl 4=Meta 8=Shift.", inputSchema: obj({ tabId: TAB, key: S("string"), modifiers: S("number") }, ["key"]), run: (a) => bridge.call("cdp_key", a) },
  { name: "browser_cdp_click_xy", description: "Real mouse click at viewport coordinates via CDP.", inputSchema: obj({ tabId: TAB, x: S("number"), y: S("number"), button: S("string"), clickCount: S("number") }, ["x", "y"]), run: (a) => bridge.call("cdp_click_xy", a) },
  { name: "browser_cdp_wheel", description: "Real mouse-wheel scroll via CDP (triggers lazy loading unlike scrollTop).", inputSchema: obj({ tabId: TAB, x: S("number"), y: S("number"), deltaY: S("number"), deltaX: S("number") }), run: (a) => bridge.call("cdp_wheel", a) },
  { name: "browser_cdp_detach", description: "Detach the debugger from a tab (removes the 'being debugged' bar).", inputSchema: obj({ tabId: TAB }), run: (a) => bridge.call("cdp_detach", a) },
];

// Compact factory for the large tool batches. t(name, description, props, required, cmd, timeoutMs).
const t = (name, description, props = {}, required = [], cmd = null, timeoutMs = null) => ({
  name,
  description,
  inputSchema: obj({ tabId: TAB, ...props }, required),
  run: (a) => bridge.call(cmd || name.replace(/^browser_/, ""), a, timeoutMs ? { timeoutMs } : undefined),
});
const arr = (items) => S("array", { items });

// ================================================================ STUDENTS (e-learning)
tools.push(
  t("browser_quiz_answer_all", "Answer many quiz questions at once. answers: array of {selector|name, value} for text/select/checkbox, or {group, label, exact?} to pick a radio/checkbox by its label text. Returns per-item result.", { answers: arr(S("object")) }, ["answers"], "quiz_answer_all"),
  t("browser_quiz_submit", "Click the quiz's submit/check/finish button (matches submit, отправить, проверить, next, далее, finish…). Override with patterns.", { patterns: arr(S("string")) }, [], "quiz_submit"),
  t("browser_quiz_next", "Click the 'next question' button (next, далее, следующий, продолжить…).", { patterns: arr(S("string")) }, [], "quiz_next"),
  t("browser_quiz_prev", "Click the 'previous question' button (back, назад, предыдущий…).", { patterns: arr(S("string")) }, [], "quiz_prev"),
  t("browser_click_text", "Click the first button/link whose visible text (or aria-label/value) matches any of the given patterns. role='link' to restrict to links.", { patterns: arr(S("string")), role: S("string", { enum: ["button", "link"] }) }, ["patterns"], "click_text"),
  t("browser_flashcards", "Extract flashcards (term/definition pairs) from Quizlet-style pages or <dl> lists.", { limit: S("number") }, [], "flashcards"),
  t("browser_essay_write", "Write a long text (essay/answer) into a textarea or contenteditable (first one, or a selector). append=true keeps existing text. Returns word/char count.", { selector: S("string"), text: S("string"), append: S("boolean") }, ["text"], "essay_write"),
  t("browser_word_count", "Count words/characters/sentences/paragraphs of a textarea/contenteditable (selector) or the whole page.", { selector: S("string") }, [], "word_count"),
  t("browser_fill_blanks", "Fill visible text/number inputs and textareas in order with the given array of values (fill-in-the-blank questions).", { values: arr(S("string")) }, ["values"], "fill_blanks"),
  t("browser_set_range", "Set an <input type=range> slider to a value.", { selector: S("string"), value: S("number") }, ["selector", "value"], "set_range"),
  t("browser_drag_drop", "HTML5 drag-and-drop from one element to another (matching/ordering questions).", { from: S("string"), to: S("string") }, ["from", "to"], "drag_drop"),
  t("browser_reorder", "Reorder a container's direct children into the given index order (sortable/ordering questions).", { container: S("string"), order: arr(S("number")) }, ["container", "order"], "reorder"),
  t("browser_code_get", "Read code from an in-page editor: Monaco, CodeMirror 5/6, Ace, or a plain textarea. For coding assignments.", { selector: S("string") }, [], "code_get"),
  t("browser_code_set", "Write code into an in-page editor (Monaco/CodeMirror/Ace/textarea).", { selector: S("string"), code: S("string") }, ["code"], "code_set"),
  t("browser_timer_read", "Read a countdown/exam timer shown on the page (mm:ss / hh:mm:ss).", {}, [], "timer_read"),
  t("browser_progress_read", "Read progress bars: <progress> and role=progressbar (value, max, percent).", {}, [], "progress_read"),
  t("browser_captions", "Extract video captions/subtitles: active textTrack cues and <track> elements (for transcribing lecture videos).", {}, [], "captions"),
  t("browser_definitions", "Extract term/definition pairs from <dl>/<dt>/<dd> lists.", {}, [], "definitions"),
  t("browser_required_fields", "List required form fields and which are still empty/invalid (so nothing is missed before submit).", {}, [], "required_fields"),
  t("browser_form_validate", "Report HTML5 validity of forms and list invalid fields with their validation messages.", { selector: S("string") }, [], "form_validate"),
  t("browser_answer_key_scan", "Scan the DOM for answers accidentally exposed in data-* attributes (data-correct, data-answer, isCorrect…). For self-checking / teachers auditing their own quizzes.", {}, [], "answer_key_scan"),
);

// ================================================================ TESTERS / SECURITY (authorized)
const fetchInTab = (a, url, extra = {}) => bridge.call("fetch_url", { tabId: a.tabId, url, maxChars: 200000, ...extra }, { timeoutMs: 45000 });
tools.push(
  t("browser_tech_detect", "Detect front-end technologies on the page: JS frameworks (React/Vue/Angular/Svelte/Next/Nuxt), libraries (jQuery/lodash/GSAP/Three.js), CSS frameworks, CMS (WordPress/Shopify), analytics, CDNs — with versions where readable.", {}, [], "tech_detect"),
  t("browser_globals_list", "List custom JavaScript globals the page added to window, grouped by type. Recon for how a site's client code is structured.", {}, [], "globals_list"),
  t("browser_comments_extract", "Extract HTML comments from the page (they sometimes leak TODOs, credentials, internal URLs).", { limit: S("number") }, [], "comments_extract"),
  t("browser_hidden_inputs", "List hidden form inputs and their values (tokens, ids, state).", {}, [], "hidden_inputs"),
  t("browser_inline_handlers", "List inline event handlers (onclick=…, onerror=…) across the DOM — potential XSS/DOM sinks to review.", {}, [], "inline_handlers"),
  t("browser_cookie_audit", "Which cookies are visible to JavaScript (i.e. lack HttpOnly). Combine with browser_storage_dump for full flag audit.", {}, [], "cookie_audit"),
  t("browser_secrets_scan", "Scan the page HTML, localStorage, sessionStorage and cookies for exposed secrets (AWS/Google keys, JWTs, bearer tokens, private keys, api_key=…). For auditing your own site's client-side exposure.", {}, [], "secrets_scan"),
  t("browser_links_classify", "Classify all links: internal, external (with origins), mailto, tel, in-page anchors, javascript:. Site-map recon.", {}, [], "links_classify"),
  t("browser_params", "Collect the page's URL query params, hash, and all form field names/types. Attack-surface mapping.", {}, [], "params"),
  t("browser_perf", "Page performance: TTFB, DOMContentLoaded, load time, HTTP protocol, resource count/sizes, and the 15 largest resources.", {}, [], "perf"),
  t("browser_third_party", "List third-party origins the page loads from and known trackers/analytics among them (Google, Yandex Metrica, Facebook, Hotjar, Sentry…).", {}, [], "third_party"),
  t("browser_source_maps", "List script URLs and sourceMappingURL references — check whether .map files are publicly served (source-code disclosure).", {}, [], "source_maps"),
  t("browser_sri_audit", "List third-party scripts/styles loaded without Subresource Integrity (integrity=…).", {}, [], "sri_audit"),
  t("browser_iframe_audit", "Audit iframes: src, cross-origin flag, whether sandbox/allow are set.", {}, [], "iframe_audit"),
  t("browser_cookie_consent", "Detect a cookie-consent / GDPR banner on the page and return its text.", {}, [], "cookie_consent"),
  t("browser_hidden_elements", "List elements hidden with display:none / visibility:hidden that still carry text (hidden content, off-screen data).", { limit: S("number") }, [], "hidden_elements"),
  t("browser_console_errors", "Return only console errors and uncaught exceptions captured in the tab (attaches CDP).", {}, [], "console_errors"),
  t("browser_websocket_frames", "Record and read WebSocket frames (sent/received) of the tab via CDP. Call once to start, interact, then read; clear=true empties.", { clear: S("boolean") }, [], "websocket_frames"),
  {
    name: "browser_headers_get",
    description: "Fetch a URL from the page context and return its response status and headers (Server, Content-Type, Set-Cookie visibility, caching, security headers). Same-origin unrestricted; cross-origin limited by CORS.",
    inputSchema: obj({ tabId: TAB, url: S("string") }, ["url"]),
    run: async (a) => { const r = await fetchInTab(a, a.url, { maxChars: 0 }); return { url: a.url, status: r.status, ok: r.ok, headers: r.headers, server: r.headers && r.headers.server, contentType: r.headers && r.headers["content-type"] }; },
  },
  {
    name: "browser_robots",
    description: "Fetch and parse /robots.txt of the page's site: user-agents, Disallow/Allow rules, sitemaps.",
    inputSchema: obj({ tabId: TAB }),
    run: async (a) => { const page = await bridge.call("get_page", { tabId: a.tabId, maxChars: 10 }); const origin = new URL(page.url).origin; const r = await fetchInTab(a, origin + "/robots.txt"); const lines = (r.body || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")); const disallow = lines.filter((l) => /^disallow:/i.test(l)).map((l) => l.split(":").slice(1).join(":").trim()); const sitemaps = lines.filter((l) => /^sitemap:/i.test(l)).map((l) => l.split(":").slice(1).join(":").trim()); return { url: origin + "/robots.txt", status: r.status, disallow, sitemaps, raw: (r.body || "").slice(0, 4000) }; },
  },
  {
    name: "browser_sitemap",
    description: "Fetch sitemap.xml (or a given sitemap URL) and list the URLs it declares.",
    inputSchema: obj({ tabId: TAB, url: S("string") }),
    run: async (a) => { let sm = a.url; if (!sm) { const page = await bridge.call("get_page", { tabId: a.tabId, maxChars: 10 }); sm = new URL(page.url).origin + "/sitemap.xml"; } const r = await fetchInTab(a, sm); const urls = [...(r.body || "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]); return { url: sm, status: r.status, count: urls.length, urls: urls.slice(0, 500) }; },
  },
  {
    name: "browser_security_txt",
    description: "Fetch /.well-known/security.txt (responsible-disclosure contact) for the page's site.",
    inputSchema: obj({ tabId: TAB }),
    run: async (a) => { const page = await bridge.call("get_page", { tabId: a.tabId, maxChars: 10 }); const origin = new URL(page.url).origin; const r = await fetchInTab(a, origin + "/.well-known/security.txt"); return { status: r.status, found: r.status === 200, body: (r.body || "").slice(0, 2000) }; },
  },
  {
    name: "browser_broken_links",
    description: "Check the page's links with HEAD/GET requests and report which return errors (4xx/5xx) or fail. Limited to `limit` links; same-origin and CORS-allowed only.",
    inputSchema: obj({ tabId: TAB, limit: S("number", { description: "default 40" }) }),
    run: async (a) => { const links = await bridge.call("links", { tabId: a.tabId, limit: 2000 }); const urls = [...new Set(links.links.map((l) => l.href).filter((u) => /^https?:/.test(u)))].slice(0, a.limit || 40); const out = []; for (const u of urls) { try { const r = await fetchInTab(a, u, { method: "GET", maxChars: 0 }); if (!r.ok) out.push({ url: u, status: r.status }); } catch (e) { out.push({ url: u, error: e.message }); } } return { checked: urls.length, broken: out.length, results: out }; },
  },
  {
    name: "browser_redirect_chain",
    description: "Follow the redirect chain for a URL from the page context and report each hop's status and location.",
    inputSchema: obj({ tabId: TAB, url: S("string") }, ["url"]),
    run: async (a) => { const r = await fetchInTab(a, a.url, { method: "GET", maxChars: 0 }); return { url: a.url, finalUrl: r.url, redirected: r.redirected, status: r.status, note: "fetch follows redirects; final URL and status shown" }; },
  },
  {
    name: "browser_cors_probe",
    description: "Send a request to a URL from the page context and report the CORS response headers (Access-Control-Allow-Origin/-Credentials/-Methods) — to check a target's CORS policy. Authorized testing only.",
    inputSchema: obj({ tabId: TAB, url: S("string") }, ["url"]),
    run: async (a) => { const r = await fetchInTab(a, a.url, { maxChars: 0 }).catch((e) => ({ error: e.message })); const h = r.headers || {}; return { url: a.url, status: r.status, error: r.error, cors: { allowOrigin: h["access-control-allow-origin"] || null, allowCredentials: h["access-control-allow-credentials"] || null, allowMethods: h["access-control-allow-methods"] || null } }; },
  },
);

// ================================================================ USER (extract / summarize / productivity)
const pat = (name, kind, desc) => ({ name, description: desc, inputSchema: obj({ tabId: TAB, limit: S("number") }), run: (a) => bridge.call("patterns", { ...a, kind }) });
const schema = (name, type, desc) => ({ name, description: desc, inputSchema: obj({ tabId: TAB }), run: (a) => bridge.call("schema_extract", { tabId: a.tabId, type }) });
tools.push(
  pat("browser_emails", "emails", "Extract all email addresses from the page text."),
  pat("browser_phones", "phones", "Extract phone numbers from the page text."),
  pat("browser_dates", "dates", "Extract dates from the page text (various formats, RU/EN month names)."),
  pat("browser_prices", "prices", "Extract prices with currency symbols ($ € £ ¥ ₽ руб) from the page."),
  pat("browser_extract_urls", "urls", "Extract all http(s) URLs found in the page source."),
  pat("browser_hashtags", "hashtags", "Extract #hashtags from the page."),
  pat("browser_mentions", "mentions", "Extract @mentions from the page."),
  pat("browser_numbers", "numbers", "Extract numbers/statistics from the page text."),
  pat("browser_ip_addresses", "ips", "Extract IPv4 addresses appearing on the page."),
  t("browser_social_links", "Find links to social networks (Facebook, X, Instagram, YouTube, Telegram, VK, LinkedIn, TikTok, GitHub, Discord…).", {}, [], "social_links"),
  t("browser_summary_data", "Gather everything needed to summarize a page in one call: title, description, author, date, heading tree, first paragraphs, keywords.", {}, [], "summary_data"),
  t("browser_toc", "Table of contents from the page's headings (with anchors).", {}, [], "toc"),
  t("browser_schema_data", "Extract structured data (JSON-LD and microdata / schema.org). type filters by @type (Product, Article, Recipe…).", { type: S("string") }, [], "schema_extract"),
  schema("browser_product_extract", "product", "Extract product structured data (schema.org Product): name, price, availability, rating."),
  schema("browser_recipe_extract", "recipe", "Extract recipe structured data (schema.org Recipe): ingredients, steps, time."),
  schema("browser_event_extract", "event", "Extract event structured data (schema.org Event): date, place, tickets."),
  schema("browser_job_extract", "jobposting", "Extract job-posting structured data (schema.org JobPosting): title, salary, company."),
  t("browser_reviews", "Extract reviews and ratings (schema.org Review and on-page rating widgets).", {}, [], "reviews"),
  t("browser_lists_extract", "Extract meaningful <ul>/<ol> lists and their items (ignores nav/footer).", {}, [], "lists_extract"),
  t("browser_quotes", "Extract quotes (blockquote, q, quote widgets).", {}, [], "quotes"),
  t("browser_code_blocks", "Extract code blocks (<pre>/<code>) with detected language.", {}, [], "code_blocks"),
  t("browser_citations", "Extract citations/references (cite, reference lists).", {}, [], "citations"),
  t("browser_breadcrumbs", "Extract breadcrumb navigation items.", {}, [], "breadcrumbs"),
  t("browser_pagination", "Find next/previous page links.", {}, [], "pagination"),
  t("browser_rss_find", "Find RSS/Atom feed links declared on the page.", {}, [], "rss_find"),
  t("browser_author", "Extract the page/article author.", {}, [], "author"),
  t("browser_publish_date", "Extract published/modified dates from metadata.", {}, [], "publish_date"),
  t("browser_main_image", "The page's main image (og:image or the largest image).", {}, [], "main_image"),
  t("browser_image_alts", "List images with their alt text and count how many are missing alt (a11y).", {}, [], "image_alts"),
  t("browser_faq", "Extract FAQ question/answer pairs (<details>, FAQ widgets, FAQ schema).", {}, [], "faq"),
  t("browser_paragraphs", "Extract the page's paragraphs longer than `min` chars.", { min: S("number") }, [], "paragraphs"),
  t("browser_headings", "Extract all headings h1–h6 with levels.", {}, [], "headings"),
  t("browser_word_freq", "Word-frequency analysis (stopwords removed, RU+EN): the top N words.", { top: S("number"), minLen: S("number") }, [], "word_freq"),
  t("browser_reading_time", "Estimate reading time (word count, minutes at 130/200 wpm).", {}, [], "reading_time"),
  t("browser_lang_detect", "Detect the page's language (html lang + Cyrillic/Latin ratio).", {}, [], "lang_detect"),
  t("browser_reader_view", "Clean reader view: main content as plain structured text, ads/nav/related stripped.", { maxChars: S("number") }, [], "reader_view"),
  t("browser_to_markdown", "Convert the page's main content to Markdown (headings, links, images, lists, code, quotes).", { maxChars: S("number") }, [], "to_markdown"),
  t("browser_entities", "Extract likely named entities (capitalized multi-word phrases) with counts.", {}, [], "entities"),
  t("browser_login_detect", "Detect a login form and its fields/action.", {}, [], "login_detect"),
  t("browser_newsletter_detect", "Detect a newsletter/subscribe form.", {}, [], "newsletter_detect"),
  t("browser_search_on_page", "Type a query into the page's own search box and submit it.", { query: S("string") }, ["query"], "search_on_page"),
  t("browser_detect_paywall", "Detect whether the page is likely behind a paywall/subscription wall.", {}, [], "detect_paywall"),
  t("browser_remove_clutter", "Remove ads, banners, popups, cookie bars, sidebars and related-content blocks to declutter the page.", {}, [], "remove_clutter"),
  t("browser_focus_mode", "Declutter the page for distraction-free reading (alias of remove_clutter).", {}, [], "focus_mode"),
  t("browser_dark_mode", "Toggle a dark-mode filter on the page (on=false removes it).", { on: S("boolean") }, [], "dark_mode"),
  t("browser_font_size", "Enlarge/shrink the page font by a percent (e.g. 130).", { percent: S("number") }, [], "font_size"),
);
// server-composed extraction/file tools
tools.push(
  {
    name: "browser_save_text", description: "Save the page's visible text to a .txt file and return the path.",
    inputSchema: obj({ tabId: TAB, file: S("string") }),
    run: async (a) => { const p = await bridge.call("get_page", { tabId: a.tabId, maxChars: 5000000 }); fs.mkdirSync(SHOT_DIR, { recursive: true }); const file = a.file || path.join(SHOT_DIR, `text-${Date.now()}.txt`); fs.writeFileSync(file, `${p.title}\n${p.url}\n\n${p.text}`); return { file, chars: p.text.length }; },
  },
  {
    name: "browser_save_html", description: "Save the page's full HTML to an .html file.",
    inputSchema: obj({ tabId: TAB, file: S("string") }),
    run: async (a) => { const h = await bridge.call("get_html", { tabId: a.tabId, maxChars: 20000000 }); fs.mkdirSync(SHOT_DIR, { recursive: true }); const file = a.file || path.join(SHOT_DIR, `page-${Date.now()}.html`); fs.writeFileSync(file, h.html || ""); return { file, chars: (h.html || "").length }; },
  },
  {
    name: "browser_save_markdown", description: "Convert the page to Markdown and save it as an .md file.",
    inputSchema: obj({ tabId: TAB, file: S("string") }),
    run: async (a) => { const m = await bridge.call("to_markdown", { tabId: a.tabId, maxChars: 5000000 }); fs.mkdirSync(SHOT_DIR, { recursive: true }); const file = a.file || path.join(SHOT_DIR, `page-${Date.now()}.md`); fs.writeFileSync(file, m.markdown); return { file, chars: m.length }; },
  },
  {
    name: "browser_tables_to_csv", description: "Export every table on the page to CSV files in a folder.",
    inputSchema: obj({ tabId: TAB, dir: S("string") }),
    run: async (a) => { const tabs = await bridge.call("tables", { tabId: a.tabId, limit: 50, maxRows: 5000 }); const dir = a.dir || path.join(SHOT_DIR, `tables-${Date.now()}`); fs.mkdirSync(dir, { recursive: true }); const files = []; tabs.forEach((tb, i) => { const rows = (tb.headers ? [tb.headers, ...tb.data] : tb.data) || []; const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"); const f = path.join(dir, `table-${i}.csv`); fs.writeFileSync(f, csv); files.push(f); }); return { dir, tables: files.length, files }; },
  },
  {
    name: "browser_download_pdfs", description: "Find every PDF link on the page and download them all into Downloads/yx-bridge/<host>/.",
    inputSchema: obj({ tabId: TAB }),
    run: async (a) => { const links = await bridge.call("links", { tabId: a.tabId, limit: 5000 }); const pdfs = [...new Set(links.links.map((l) => l.href).filter((u) => /\.pdf(\?|$)/i.test(u)))]; if (!pdfs.length) return { pdfs: 0 }; return bridge.call("media_download", { tabId: a.tabId, urls: pdfs }, { timeoutMs: 30000 * pdfs.length }); },
  },
  {
    name: "browser_download_images", description: "Download all images on the page into Downloads/yx-bridge/<host>/ (a whole gallery in one call).",
    inputSchema: obj({ tabId: TAB, maxImages: S("number") }),
    run: async (a) => { const media = await bridge.call("media_list", { tabId: a.tabId, limit: 1000, includeBackgrounds: true }); const urls = [...new Set(media.images.map((i) => i.url).filter((u) => u && !u.startsWith("data:")))].slice(0, a.maxImages || 100); if (!urls.length) return { images: 0 }; return bridge.call("media_download", { tabId: a.tabId, urls }, { timeoutMs: 20000 * urls.length }); },
  },
  {
    name: "browser_favicon_save", description: "Download the page's favicon to a file.",
    inputSchema: obj({ tabId: TAB, file: S("string") }),
    run: async (a) => { const meta = await bridge.call("meta", { tabId: a.tabId }); const b = await bridge.call("download_bytes", { url: meta.favicon }, { timeoutMs: 20000 }); if (!b.ok) return b; fs.mkdirSync(SHOT_DIR, { recursive: true }); const file = a.file || path.join(SHOT_DIR, `favicon-${Date.now()}.ico`); fs.writeFileSync(file, Buffer.from(b.base64, "base64")); return { file, url: meta.favicon }; },
  },
  {
    name: "browser_read_aloud", description: "Read the page's main article text aloud with the browser's text-to-speech.",
    inputSchema: obj({ tabId: TAB, lang: S("string"), maxChars: S("number") }),
    run: async (a) => { const art = await bridge.call("article", { tabId: a.tabId, maxChars: a.maxChars || 8000 }); await bridge.call("speak", { text: art.text, lang: a.lang }); return { spoke: true, chars: art.text.length }; },
  },
  {
    name: "browser_contact_info", description: "Extract all contact details from a page in one call: emails, phones, social links, and any postal-address microdata.",
    inputSchema: obj({ tabId: TAB }),
    run: async (a) => { const emails = await bridge.call("patterns", { tabId: a.tabId, kind: "emails", limit: 50 }); const phones = await bridge.call("patterns", { tabId: a.tabId, kind: "phones", limit: 50 }); const social = await bridge.call("social_links", { tabId: a.tabId }); const org = await bridge.call("schema_extract", { tabId: a.tabId, type: "organization" }); return { emails: emails.matches, phones: phones.matches, social: social.social, organizations: org.jsonld.concat(org.microdata) }; },
  },
  {
    name: "browser_compare_pages", description: "Compare two URLs' readable text and report added/removed lines (simple diff). Opens each in the work window, reads, closes.",
    inputSchema: obj({ urlA: S("string"), urlB: S("string") }, ["urlA", "urlB"]),
    run: async (a) => {
      const read = async (url) => { const tb = await bridge.call("open_tab", { url, active: false }); await bridge.call("wait_for", { tabId: tb.id, selector: "body", timeoutMs: 15000 }); const art = await bridge.call("article", { tabId: tb.id, maxChars: 500000 }); await bridge.call("close_tab", { tabId: tb.id }); return (art.text || "").split("\n").map((l) => l.trim()).filter(Boolean); };
      const A = await read(a.urlA), B = await read(a.urlB); const sa = new Set(A), sb = new Set(B);
      return { onlyInA: A.filter((l) => !sb.has(l)).slice(0, 200), onlyInB: B.filter((l) => !sa.has(l)).slice(0, 200), linesA: A.length, linesB: B.length };
    },
  },
);

// ================================================================ UTILITY (all personas)
const lbt = (name, type, desc) => ({ name, description: desc, inputSchema: obj({ tabId: TAB }), run: (a) => bridge.call("links_by_type", { tabId: a.tabId, type }) });
tools.push(
  t("browser_get_selection", "Get the text the user has selected on the page.", {}, [], "get_selection"),
  t("browser_scroll_to_text", "Scroll to the first occurrence of a text on the page and return its context.", { text: S("string") }, ["text"], "scroll_to_text"),
  t("browser_mark_text", "Highlight all occurrences of a text on the page with <mark> (color optional). Visual aid before a screenshot.", { text: S("string"), color: S("string") }, ["text"], "mark_text"),
  t("browser_unmark", "Remove highlights added by browser_mark_text.", {}, [], "unmark"),
  t("browser_table_search", "Search all tables on the page for rows containing a query string.", { query: S("string") }, ["query"], "table_search"),
  t("browser_fonts_used", "List the font families used on the page.", {}, [], "fonts_used"),
  t("browser_colors_used", "List the most-used text/background colors on the page.", {}, [], "colors_used"),
  t("browser_meta_audit", "SEO/meta audit: viewport, robots, canonical, charset, description, responsive flag.", {}, [], "meta_audit"),
  t("browser_lazy_images", "Count lazy-loaded vs eager images.", {}, [], "lazy_images"),
  t("browser_validation_audit", "HTML/a11y validation issues: duplicate ids, empty links, skipped heading levels, images without alt, number of h1.", {}, [], "validation_audit"),
  lbt("browser_external_links", "external", "List external links (other origins)."),
  lbt("browser_internal_links", "internal", "List internal links (same origin)."),
  lbt("browser_pdf_links", "pdf", "List links to PDF files."),
  lbt("browser_doc_links", "doc", "List links to document files (doc, xls, ppt, csv, txt…)."),
  lbt("browser_video_links", "video", "List links to video files."),
  lbt("browser_audio_links", "audio", "List links to audio files."),
  t("browser_price_stats", "Statistics over prices found on the page: min, max, median, average.", {}, [], "price_stats"),
  t("browser_text_stats", "Readability statistics: words, sentences, avg words/sentence, Flesch reading ease and level.", {}, [], "text_stats"),
  t("browser_json_scan", "Find embedded JSON and app-state objects in the page's scripts (application/json, __INITIAL_STATE__, etc).", {}, [], "json_scan"),
  t("browser_element_info", "Detailed info about one element (selector): tag, text, value, visibility, rect, attributes, key styles.", { selector: S("string") }, ["selector"], "element_info"),
  t("browser_attr_values", "Collect the values of one attribute across all elements matching a selector (e.g. every href, every data-id).", { selector: S("string"), attr: S("string") }, ["selector", "attr"], "attr_values"),
  t("browser_count_selector", "Count elements matching a selector (total and visible).", { selector: S("string") }, ["selector"], "count_selector"),
  t("browser_submit_form", "Submit a form (selector, or the first form).", { selector: S("string") }, [], "submit_form"),
  t("browser_reset_form", "Reset a form to its defaults.", { selector: S("string") }, [], "reset_form"),
  t("browser_check_all", "Check or uncheck all checkboxes matching a selector (default: all checkboxes).", { selector: S("string"), checked: S("boolean") }, [], "check_all"),
  t("browser_focus_element", "Focus an element and scroll it into view.", { selector: S("string") }, ["selector"], "focus_element"),
  t("browser_get_value", "Get the value/checked state of an input/select/textarea.", { selector: S("string") }, ["selector"], "get_value"),
  t("browser_is_visible", "Check whether an element is visible and whether it is in the viewport.", { selector: S("string") }, ["selector"], "is_visible"),
  t("browser_get_styles", "Get computed CSS styles of an element (given props, or a sensible default set).", { selector: S("string"), props: arr(S("string")) }, ["selector"], "get_styles"),
  t("browser_get_attribute", "Get one attribute value of the first element matching a selector.", { selector: S("string"), attr: S("string") }, ["selector", "attr"], "get_attribute"),
  t("browser_element_text", "Get the full text of the first element matching a selector.", { selector: S("string") }, ["selector"], "element_text"),
  t("browser_duplicate_content", "Find duplicated paragraphs on the page (repeated content / boilerplate).", {}, [], "duplicate_content"),
  t("browser_wait_gone", "Wait until elements matching a selector disappear (spinners, loaders, modals).", { selector: S("string"), timeoutMs: S("number") }, ["selector"], "wait_gone"),
  t("browser_clipboard_write", "Copy text to the clipboard via the page.", { text: S("string") }, ["text"], "clipboard_write"),
  t("browser_clipboard_read", "Read the clipboard text (may be blocked without a user gesture/permission).", {}, [], "clipboard_read"),
);
// ---- browsing statistics (tracked by the extension, works even when the agent is off) ----
tools.push(
  { name: "browser_stats", description: "Get browsing statistics the extension records (independently of the agent). Returns: totals for day/week/month/year (minutes + d/ч/м formatted); a per-main-domain time breakdown for a date range (from/to as YYYY-MM-DD, default last 30 days) — grouped by registrable domain, not subdomains (docs.github.com → github.com); the top sites by number of visits; and per-day minutes. Time is only counted while the browser window is focused (not minimized or behind a fullscreen app). A viewable page with a date picker is in the extension popup (Stats button).", inputSchema: obj({ from: S("string", { description: "range start YYYY-MM-DD" }), to: S("string", { description: "range end YYYY-MM-DD" }) }), run: (a) => bridge.call("stats_get", a) },
  { name: "browser_stats_reset", description: "Clear all recorded browsing statistics.", inputSchema: obj({}), run: () => bridge.call("stats_reset") },
  {
    name: "browser_stats_export",
    description: "Export browsing statistics to files: a full JSON (re-importable with browser_stats_import, e.g. to move to another device) and a friendly CSV (domain, minutes, visits) for sharing. Returns the file paths.",
    inputSchema: obj({ dir: S("string", { description: "output folder; default temp dir" }) }),
    run: async (a) => {
      const raw = await bridge.call("stats_raw");
      const dir = a.dir || SHOT_DIR; fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      const jsonFile = path.join(dir, `yx-stats-${stamp}.json`);
      fs.writeFileSync(jsonFile, JSON.stringify(raw, null, 1));
      // Same registrable-domain rule as the extension (docs.github.com → github.com, bbc.co.uk stays bbc.co.uk).
      const MULTI_TLD = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au", "co.jp", "co.nz", "com.br", "com.tr", "co.in", "com.ua", "co.il", "com.cn", "com.mx", "com.sg", "com.hk", "com.ru"]);
      const md = (h) => { const p = String(h).split("."); if (p.length <= 2) return h; const l2 = p.slice(-2).join("."); return MULTI_TLD.has(l2) ? p.slice(-3).join(".") : l2; };
      const byMain = {};
      for (const [host, v] of Object.entries(raw.byDomain || {})) { const m = md(host); const t = byMain[m] = byMain[m] || { seconds: 0, visits: 0 }; t.seconds += v.seconds; t.visits += v.visits; }
      const rows = [["domain", "minutes", "hours", "visits"]].concat(Object.entries(byMain).sort((x, y) => y[1].seconds - x[1].seconds).map(([d, v]) => [d, Math.round(v.seconds / 60), (Math.round(v.seconds / 360) / 10).toString(), v.visits]));
      const csvFile = path.join(dir, `yx-stats-${stamp}.csv`);
      fs.writeFileSync(csvFile, rows.map((r) => r.join(",")).join("\n"));
      return { jsonFile, csvFile, totalHours: Math.round((raw.totalSeconds || 0) / 360) / 10, domains: Object.keys(byMain).length };
    },
  },
  {
    name: "browser_stats_import",
    description: "Import browsing statistics from a JSON file exported by browser_stats_export (e.g. from another device). merge=true adds to the current data; merge=false (default) replaces it.",
    inputSchema: obj({ file: S("string"), merge: S("boolean") }, ["file"]),
    run: async (a) => { const stats = JSON.parse(fs.readFileSync(a.file, "utf8")); return bridge.call("stats_import", { stats, merge: !!a.merge }); },
  },
  {
    name: "browser_password",
    description: "Manage the connection password that locks the local port so only the genuine YX Bridge extension may connect. action=status shows whether a password is set; set/change sets one (pass `password`, or omit to auto-generate a strong one) — it is stored in the extension and in a server-side token file, and takes effect on the next reconnect; off removes it. IMPORTANT for the agent: when you set a password, save it to your own memory, tell the user the password, and tell them how to change it later (this tool, or edit server/.token + the extension). Does not disrupt the current connection.",
    inputSchema: obj({ action: S("string", { enum: ["status", "set", "change", "off"] }), password: S("string") }),
    run: async (a) => {
      const act = a.action || "status";
      if (act === "status") return { passwordSet: !!TOKEN, source: process.env.YX_BRIDGE_TOKEN ? "env" : (TOKEN ? "file" : "none"), tokenFile: TOKEN_FILE };
      if (act === "off") { await bridge.call("set_password", { token: null }).catch(() => {}); TOKEN = null; writeToken(null); return { ok: true, passwordSet: false, note: "Password removed. The port is open to any local client again." }; }
      const pw = a.password || ("yx-" + crypto.randomBytes(18).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 16));
      await bridge.call("set_password", { token: pw }); // store in the extension first
      TOKEN = pw; writeToken(pw); // then require it server-side
      return {
        ok: true, password: pw, passwordSet: true, tokenFile: TOKEN_FILE,
        reminder_for_agent: "Save this password to your memory. Tell the user the password now, and that they can change it later by calling browser_password action=change, or by editing the server .token file and the extension's stored password.",
        how_to_change_manually: `Run browser_password with action=change and a new password; OR set env YX_BRIDGE_TOKEN for the server (or edit ${TOKEN_FILE}) and store the same value in the extension.`,
      };
    },
  },
  {
    name: "browser_jwt_decode",
    description: "Decode a JWT (JSON Web Token): returns its header and payload (base64url-decoded), plus human-readable exp/iat times. Pass `token`, or scan=true to find and decode JWTs in the page's storage/cookies. Signature is NOT verified. Authorized testing / your own tokens.",
    inputSchema: obj({ tabId: TAB, token: S("string"), scan: S("boolean") }),
    run: async (a) => {
      const dec = (jwt) => {
        const parts = String(jwt).split(".");
        if (parts.length < 2) return { jwt: jwt.slice(0, 30), error: "not a JWT" };
        const b64 = (s) => { try { return JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch { return null; } };
        const header = b64(parts[0]), payload = b64(parts[1]);
        const out = { header, payload };
        if (payload) { if (payload.exp) out.expires = new Date(payload.exp * 1000).toISOString(); if (payload.iat) out.issuedAt = new Date(payload.iat * 1000).toISOString(); if (payload.exp) out.expired = payload.exp * 1000 < Date.now(); }
        return out;
      };
      if (a.token) return dec(a.token);
      if (a.scan) {
        const dump = await bridge.call("storage_dump", { tabId: a.tabId });
        const hay = JSON.stringify(dump);
        const found = [...new Set(hay.match(/eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g) || [])];
        return { found: found.length, tokens: found.map((t) => ({ token: t.slice(0, 24) + "…", ...dec(t) })) };
      }
      return { error: "pass token or scan=true" };
    },
  },
);

const server = new Server({ name: "yx-bridge-mcp", version: PKG.version }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) return { content: [{ type: "text", text: `unknown tool ${req.params.name}` }], isError: true };
  try {
    const result = await tool.run(req.params.arguments || {});
    if (result && result.__images) {
      const { __images, ...rest } = result;
      return { content: [...__images, { type: "text", text: JSON.stringify(rest) }] };
    }
    if (result && result.__image) {
      const { __image, ...rest } = result;
      return { content: [{ type: "image", data: __image.data, mimeType: __image.mimeType }, { type: "text", text: JSON.stringify(rest) }] };
    }
    return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result ?? null, null, 1) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `error: ${(e && e.message) || e}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready; bridge on ws://127.0.0.1:${PORT}`);
