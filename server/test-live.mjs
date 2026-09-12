// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Live test against the connected extension: node test-live.mjs
import { Bridge } from "./src/bridge.js";
const b = new Bridge({ log: () => {} }).start();
const call = (c, a) => b.call(c, a, { timeoutMs: 30000, connectTimeoutMs: 20000 });
const show = (n, r) => console.log(n + ":", JSON.stringify(r).slice(0, 300));
try {
  console.log("work window:", JSON.stringify(await call("work_window", { mode: "least_tabs" })));
  const tabs = await call("list_tabs");
  let tab = tabs.find((t) => (t.url || "").startsWith("https://example.com"));
  if (!tab) tab = await call("open_tab", { url: "https://example.com", active: true });
  await call("activate_tab", { tabId: tab.id });
  await call("wait_load", { tabId: tab.id });
  const id = tab.id;
  show("query", await call("query", { tabId: id, selector: "h1, a", limit: 5 }));
  show("links", await call("links", { tabId: id }));
  show("eval main", await call("eval", { tabId: id, code: 'return {title: document.title, h1: document.querySelector("h1").textContent, loc: location.href}', world: "main" }));
  show("set_html", await call("set_html", { tabId: id, selector: "h1", html: "YX Bridge was here ✅" }));
  show("set_style", await call("set_style", { tabId: id, selector: "h1", styles: { color: "red" } }));
  show("inject_css", await call("inject_css", { tabId: id, css: "body{background:#ffe}" }));
  show("eval again", await call("eval", { tabId: id, code: 'return document.querySelector("h1").textContent' }));
  show("get_html", await call("get_html", { tabId: id, selector: "h1", maxChars: 200 }));
  show("find_text", await call("find_text", { tabId: id, text: "YX Bridge" }));
  show("tables", await call("tables", { tabId: id }));
  show("wait_for", await call("wait_for", { tabId: id, selector: "h1", text: "YX Bridge", timeoutMs: 3000 }));
  show("click", await call("click", { tabId: id, selector: "a" }));
  await new Promise((r) => setTimeout(r, 2500));
  show("after click", await call("get_page", { tabId: id, maxChars: 80 }));
  show("back", await call("go_back", { tabId: id }));
  show("console", await call("console_logs", { tabId: id }));
  show("cdp", await call("cdp", { tabId: id, method: "Page.getLayoutMetrics" }));
  const shot = await call("screenshot", { tabId: id, fullPage: true });
  show("fullPage shot", { format: shot.format, bytes: shot.base64.length, w: shot.width, h: shot.height });
  show("detach", await call("cdp_detach", { tabId: id }));
  show("ping", await call("ping"));
  show("close", await call("close_tab", { tabId: id }));
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  b.close();
}
