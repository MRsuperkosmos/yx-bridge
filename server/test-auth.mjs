// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Offline test of the bridge's connection and password handling. No browser needed:
// node test-auth.mjs   (uses port 17999 so it never touches the real extension)
import WebSocket from "ws";
import { Bridge } from "./src/bridge.js";

const PORT = 17999;
let TOKEN = "secret-1";
const bridge = new Bridge({ port: PORT, log: () => {}, getToken: () => TOKEN, onSetToken: (t) => { TOKEN = t; }, helloTimeoutMs: 800 }).start();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = () => new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}`); ws.on("open", () => res(ws)); ws.on("error", rej); });
const nextMsg = (ws) => new Promise((res) => ws.once("message", (d) => res(JSON.parse(String(d)))));
let ok = 0; const fails = [];
const check = (name, cond) => { if (cond) ok++; else fails.push(name); console.log((cond ? "ok   " : "FAIL ") + name); };

try {
  // 1. A silent client never becomes the extension and is dropped after the hello timeout.
  const a = await connect(); await sleep(200);
  check("silent client is not accepted as the extension", !bridge.connected);
  await sleep(1000);
  check("silent client is dropped after the hello timeout", a.readyState === WebSocket.CLOSED);

  // 2. Wrong password is rejected and closed.
  const b = await connect(); b.send(JSON.stringify({ type: "hello", token: "nope" }));
  const bm = await nextMsg(b); await sleep(150);
  check("wrong password gets auth ok:false", bm.type === "auth" && bm.ok === false);
  check("wrong-password socket is closed", b.readyState === WebSocket.CLOSED || b.readyState === WebSocket.CLOSING);
  check("bridge is still not connected", !bridge.connected);

  // 3. Correct password is accepted and commands flow (the fake extension answers ping after a delay).
  const c = await connect();
  c.on("message", (d) => { const m = JSON.parse(String(d)); if (m.id && m.cmd === "ping") setTimeout(() => c.send(JSON.stringify({ id: m.id, ok: true, result: { pong: true } })), 300); });
  c.send(JSON.stringify({ type: "hello", token: TOKEN, version: "test", protocol: 1 }));
  await sleep(150);
  check("correct password -> connected", bridge.connected);
  const r = await bridge.call("ping", {}, { timeoutMs: 2000 });
  check("command round-trip works", r && r.pong === true);

  // 4. A rogue client cannot displace the extension, change the password, or spoof replies.
  const d = await connect();
  d.send(JSON.stringify({ type: "set_token", token: "hacked" })); await sleep(100);
  check("unauthenticated set_token is ignored", TOKEN === "secret-1");
  check("rogue client did not displace the extension", bridge.connected && bridge.ext !== d);
  const p = bridge.call("ping", {}, { timeoutMs: 2000 });
  await sleep(50); d.send(JSON.stringify({ id: bridge.seq, ok: true, result: { pong: "spoofed" } })); // arrives before the real reply
  const rr = await p;
  check("spoofed reply from the rogue client is ignored", rr.pong === true);
  d.close(); await sleep(100);

  // 5. set_token from the authenticated extension is honoured.
  c.send(JSON.stringify({ type: "set_token", token: "secret-2" })); await sleep(100);
  check("set_token from the extension changes the password", TOKEN === "secret-2");
} catch (e) { fails.push("exception: " + e.message); console.log("FAIL exception:", e.message); }

console.log(`\nRESULT: ${ok} ok, ${fails.length} failed${fails.length ? ": " + fails.join("; ") : ""}`);
bridge.close();
process.exit(fails.length ? 1 : 0);
