// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Live test of translation control + new tools. Needs extension >= 0.3.0 loaded.
import fs from "node:fs";
import { Bridge } from "./src/bridge.js";
const b = new Bridge({ log: () => {} }).start();
const call = (c, a, t = 45000) => b.call(c, a, { timeoutMs: t, connectTimeoutMs: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (n, r) => console.log(n + ":", JSON.stringify(r).slice(0, 260));
try {
  console.log("work window:", JSON.stringify(await call("work_window", { mode: "least_tabs" })));
  show("ping", await call("ping"));
  const t = await call("open_tab", { url: "https://example.com/?t=1", active: true });
  await call("wait_load", { tabId: t.id });
  await sleep(3500);
  show("page (browser default)", await call("get_page", { tabId: t.id, maxChars: 60 }));
  show("page original=true", await call("get_page", { tabId: t.id, maxChars: 60, original: true }));
  show("translation off", await call("translation", { mode: "off", tabId: t.id }));
  await sleep(3500);
  show("page after off", await call("get_page", { tabId: t.id, maxChars: 60 }));
  const t2 = await call("open_tab", { url: "https://www.iana.org/help/example-domains", active: true });
  await call("wait_load", { tabId: t2.id });
  await sleep(3500);
  show("second tab while off", await call("get_page", { tabId: t2.id, maxChars: 60 }));
  show("find_text", await call("find_text", { tabId: t2.id, text: "example", limit: 2 }));
  show("tables", await call("tables", { tabId: t2.id, limit: 1, maxRows: 2 }));
  show("wait_for", await call("wait_for", { tabId: t2.id, selector: "h1", timeoutMs: 3000 }));
  const pdf = await call("pdf", { tabId: t2.id }, 60000);
  fs.writeFileSync("test-page.pdf", Buffer.from(pdf.base64, "base64"));
  show("pdf", { bytes: fs.statSync("test-page.pdf").size });
  await call("cdp_detach", { tabId: t2.id });
  await call("close_tab", { tabId: t2.id });
  show("translation on", await call("translation", { mode: "on", tabId: t.id }));
  await sleep(3500);
  show("page after on", await call("get_page", { tabId: t.id, maxChars: 60 }));
  show("status", await call("translation", { mode: "status" }));
  await call("close_tab", { tabId: t.id });
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  b.close();
}
