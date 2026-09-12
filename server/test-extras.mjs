// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Live test of the 0.4.0 tool batch. Needs extension >= 0.4.0 loaded. Non-destructive:
// opens/closes its own tabs, adds+removes one bookmark, downloads one tiny file.
import fs from "node:fs";
import { Bridge } from "./src/bridge.js";
const b = new Bridge({ log: () => {} }).start();
const call = (c, a, t = 45000) => b.call(c, a, { timeoutMs: t, connectTimeoutMs: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (n, r) => console.log(n + ":", JSON.stringify(r).slice(0, 220));
const fails = [];
const step = async (name, fn) => { try { show(name, await fn()); } catch (e) { fails.push(name); console.log(name + ": FAIL " + e.message); } };
try {
  console.log("work window:", JSON.stringify(await call("work_window", { mode: "least_tabs" })));
  show("ping", await call("ping"));
  await step("windows", () => call("windows_list").then((w) => ({ windows: w.length })));
  const t = await call("open_tab", { url: "https://www.iana.org/help/example-domains", active: true });
  await call("wait_load", { tabId: t.id });
  await sleep(2500);
  await step("find_tabs", () => call("find_tabs", { pattern: "iana" }).then((x) => x.length));
  await step("zoom", () => call("zoom", { tabId: t.id }));
  await step("meta", () => call("meta", { tabId: t.id }).then((m) => ({ title: m.title, canonical: m.canonical, h: m.headings.length })));
  await step("article", () => call("article", { tabId: t.id, maxChars: 120 }));
  await step("extract", () => call("extract", { tabId: t.id, spec: { h1: "h1", links: { selector: "a", attr: "href", all: true } } }).then((x) => ({ h1: x.h1, links: x.links.length })));
  await step("storage set/get", async () => { await call("storage", { tabId: t.id, op: "set", key: "cb_test", value: "1" }); return call("storage", { tabId: t.id, op: "get", key: "cb_test" }); });
  await step("highlight", () => call("highlight", { tabId: t.id, selector: "h1" }));
  await step("hover", () => call("hover", { tabId: t.id, selector: "a" }));
  await step("press_key", () => call("press_key", { tabId: t.id, key: "End" }));
  await step("scroll_bottom", () => call("scroll_bottom", { tabId: t.id, maxSteps: 3, delayMs: 200 }));
  await step("element_screenshot", () => call("element_screenshot", { tabId: t.id, selector: "h1" }).then((r) => ({ bytes: r.base64.length })));
  await step("network_start+reload+log", async () => { await call("network_start", { tabId: t.id }); await call("reload", { tabId: t.id }); await sleep(2500); return call("network_log", { tabId: t.id, limit: 3 }).then((l) => ({ total: l.total, first: l.requests[0] && l.requests[0].url })); });
  await step("response_body", () => call("response_body", { tabId: t.id, urlPattern: "example-domains" }).then((r) => ({ status: r.status, len: r.body.length })));
  await step("network_stop", () => call("network_stop", { tabId: t.id }));
  await step("set_viewport mobile", () => call("set_viewport", { tabId: t.id, width: 390, height: 800, mobile: true }));
  await step("set_viewport clear", () => call("set_viewport", { tabId: t.id, width: 0 }));
  await step("dialogs accept", async () => { await call("dialogs", { tabId: t.id, mode: "accept" }); await call("eval", { tabId: t.id, code: "return confirm('cb test')" }); return call("dialogs", { tabId: t.id, mode: "off" }); });
  await step("cdp_detach", () => call("cdp_detach", { tabId: t.id }));
  await step("fill_form (yandex)", async () => { const y = await call("open_tab", { url: "https://ya.ru", active: true }); await call("wait_load", { tabId: y.id }); await sleep(2000); const r = await call("fill_form", { tabId: y.id, fields: { "input[name=text]": "claude bridge test" } }); await call("close_tab", { tabId: y.id }); return r; });
  await step("history_search", () => call("history_search", { text: "iana", maxResults: 3 }).then((h) => h.length));
  await step("bookmark add/remove", async () => { const bm = await call("bookmark_add", { title: "[cb-test]", url: "https://example.com/cb" }); const found = await call("bookmarks_search", { query: "cb-test" }); await call("bookmark_remove", { id: bm.id }); return { added: bm.id, found: found.length }; });
  await step("download", () => call("download", { url: "https://www.iana.org/_img/2022/iana-logo-header.svg", filename: "yx-bridge-test/iana.svg" }, 60000));
  await step("downloads_list", () => call("downloads_list", { limit: 1 }).then((d) => d[0] && d[0].state));
  await step("cookies_get", () => call("cookies_get", { domain: "iana.org" }).then((c) => c.length));
  await step("recent_closed", () => call("recent_closed", { max: 2 }).then((r) => r.length));
  await step("notify", () => call("notify", { title: "YX Bridge", message: "Тест уведомления прошёл" }));
  await step("speak", () => call("speak", { text: "Проверка озвучки", lang: "ru-RU" }));
  await step("tab_update pin/unpin", async () => { await call("tab_update", { tabId: t.id, pinned: true }); return call("tab_update", { tabId: t.id, pinned: false }); });
  await step("close_tabs", () => call("close_tabs", { pattern: "iana\\.org/help" }));
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  console.log(fails.length ? "FAILED STEPS: " + fails.join(", ") : "ALL STEPS OK");
  b.close();
}
