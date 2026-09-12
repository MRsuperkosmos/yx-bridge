// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Offline self-test: fake extension + MCP stdio round-trip.
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { Bridge } from "./bridge.js";

// 1) bridge <-> fake extension
const bridge = new Bridge({ port: 17556, log: () => {} }).start();
const fake = new WebSocket("ws://127.0.0.1:17556");
fake.on("open", () => fake.send(JSON.stringify({ type: "hello", protocol: 1, version: "test" })));
fake.on("message", (d) => {
  const m = JSON.parse(String(d));
  if (m.cmd === "ping") fake.send(JSON.stringify({ id: m.id, ok: true, result: { pong: true } }));
  else fake.send(JSON.stringify({ id: m.id, ok: false, error: "nope " + m.cmd }));
});
const r1 = await bridge.call("ping");
console.log("bridge ping:", JSON.stringify(r1));
try { await bridge.call("zzz"); } catch (e) { console.log("bridge error path ok:", e.message); }
fake.close();
bridge.close();

// 2) MCP server over stdio: initialize + tools/list
const proc = spawn(process.execPath, ["src/server.js"], { env: { ...process.env, BROWSER_BRIDGE_PORT: "17557" } });
let buf = "";
const send = (o) => proc.stdin.write(JSON.stringify(o) + "\n");
const got = new Promise((resolve) => {
  proc.stdout.on("data", (d) => {
    buf += d;
    for (const line of buf.split("\n")) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line);
        if (m.id === 2) resolve(m);
      } catch {}
    }
  });
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "selftest", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const res = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error("mcp timeout")), 8000))]);
console.log("mcp tools:", res.result.tools.length, res.result.tools.map((t) => t.name).join(", "));
proc.kill();
process.exit(0);
