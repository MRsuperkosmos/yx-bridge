#!/usr/bin/env node
// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Quick manual test without MCP: node src/cli.js <cmd> [jsonArgs]
// e.g. node src/cli.js list_tabs ; node src/cli.js get_page '{"maxChars":500}'
import fs from "node:fs";
import { Bridge } from "./bridge.js";

const [cmd = "ping", argsJson = "{}"] = process.argv.slice(2);
// argsJson may be inline JSON or @path/to/file.json (handy on Windows shells that eat quotes)
const raw = argsJson.startsWith("@") ? fs.readFileSync(argsJson.slice(1), "utf8") : argsJson;
const args = JSON.parse(raw.replace(/^﻿/, ""));
const bridge = new Bridge({ log: (m) => console.error("[bridge]", m) }).start();
try {
  const r = await bridge.call(cmd, args, { timeoutMs: 60000, connectTimeoutMs: 20000 });
  if (r && r.base64) {
    fs.writeFileSync("cli-shot.png", Buffer.from(r.base64, "base64"));
    console.log("saved cli-shot.png", r.width || "", r.height || "");
  } else console.log(JSON.stringify(r, null, 2));
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  bridge.close();
}
