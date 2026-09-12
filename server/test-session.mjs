// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Live test of session save/load through the MCP server itself (stdio JSON-RPC).
import { spawn } from "node:child_process";
const proc = spawn(process.execPath, ["src/server.js"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", id = 0;
const pending = new Map();
proc.stdout.on("data", (d) => {
  buf += d;
  const lines = buf.split("\n"); buf = lines.pop();
  for (const l of lines) { try { const m = JSON.parse(l); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} }
});
const rpc = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
const tool = async (name, args = {}) => { const r = await rpc("tools/call", { name, arguments: args }); const t = r.result.content.find((c) => c.type === "text"); return JSON.parse(t.text); };
try {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const ww = await tool("browser_work_window", { mode: "least_tabs" });
  console.log("work window:", JSON.stringify(ww));
  const opened = await tool("browser_open_urls", { urls: ["https://example.com/?s=1", "https://www.iana.org/help/example-domains"], windowId: ww.workWindowId });
  for (const t of opened) await tool("browser_wait_for", { tabId: t.id, selector: "body", timeoutMs: 15000 });
  await tool("browser_tab_update", { tabId: opened[0].id, pinned: true });
  const saved = await tool("browser_session_save", { windowId: ww.workWindowId });
  console.log("saved:", JSON.stringify(saved));
  const loaded = await tool("browser_session_load", { file: saved.file });
  console.log("loaded:", JSON.stringify(loaded));
  const newId = loaded.restored[0].windowId;
  const wins = await tool("browser_windows");
  const w = wins.find((x) => x.id === newId);
  console.log("new window tabs:", w ? w.tabs.length : "not found");
  const pinnedOk = w && w.tabs.some((t) => t.pinned && /example\.com/.test(t.url));
  console.log("pinned restored:", pinnedOk);
  await tool("browser_window_close", { windowId: newId });
  await tool("browser_tab_update", { tabId: opened[0].id, pinned: false });
  await tool("browser_close_tabs", { tabIds: opened.map((t) => t.id) });
  console.log("cleanup done; " + (w && w.tabs.length >= 2 && pinnedOk ? "ALL OK" : "CHECK FAILED"));
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  proc.kill();
}
