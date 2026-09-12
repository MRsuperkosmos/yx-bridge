// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Live test of media tools (extension >= 0.5.0). Uses Wikipedia (images) and a
// public MP4 sample (video). Saves outputs to ./media-test/.
import fs from "node:fs";
import { Bridge } from "./src/bridge.js";
const b = new Bridge({ log: () => {} }).start();
const call = (c, a, t = 60000) => b.call(c, a, { timeoutMs: t, connectTimeoutMs: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (n, r) => console.log(n + ":", JSON.stringify(r).slice(0, 240));
fs.mkdirSync("media-test", { recursive: true });
const fails = [];
const step = async (name, fn) => { try { show(name, await fn()); } catch (e) { fails.push(name); console.log(name + ": FAIL " + e.message); } };
try {
  console.log("work window:", JSON.stringify(await call("work_window", { mode: "least_tabs" })));
  const t = await call("open_tab", { url: "https://ru.wikipedia.org/wiki/Амстердам", active: true });
  await call("wait_load", { tabId: t.id });
  await sleep(2500);
  let list = null;
  await step("media_list", async () => { list = await call("media_list", { tabId: t.id, limit: 30, minSize: 120 }); return { counts: list.counts, first: list.images[0] && list.images[0].url }; });
  await step("image_view", async () => {
    const img = list.images.find((i) => i.width >= 300) || list.images[0];
    const r = await call("image_view", { tabId: t.id, url: img.url, maxSide: 800 });
    if (r.base64) fs.writeFileSync("media-test/image.jpg", Buffer.from(r.base64, "base64"));
    const { base64, ...rest } = r;
    return rest;
  });
  await step("media_download", () => call("media_download", { tabId: t.id, urls: [list.images[0].url], folder: "yx-bridge-test" }, 60000));
  await call("close_tab", { tabId: t.id });

  // YouTube (MSE/blob player): frames are grabbed from the <video> element itself.
  const v = await call("open_tab", { url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", active: true });
  await call("wait_load", { tabId: v.id });
  await sleep(5000);
  await step("video play", () => call("video_control", { tabId: v.id, action: "play" }));
  await sleep(3000);
  await step("video seek+pause", async () => { await call("video_control", { tabId: v.id, action: "seek", value: 10 }); return call("video_control", { tabId: v.id, action: "pause" }); });
  await step("video_frames", async () => {
    const r = await call("video_frames", { tabId: v.id, times: [5, 20, 40], maxSide: 640 }, 90000);
    if (!r.ok) throw new Error(r.error);
    r.frames.forEach((f, i) => f.base64 && fs.writeFileSync(`media-test/frame${i}.jpg`, Buffer.from(f.base64, "base64")));
    return { duration: r.duration, frames: r.frames.map((f) => f.error ? "ERR " + f.error.slice(0, 40) : f.time) };
  });
  await step("media_list (video page)", () => call("media_list", { tabId: v.id }).then((m) => m.videos[0]));
  await call("close_tab", { tabId: v.id });
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  console.log(fails.length ? "FAILED STEPS: " + fails.join(", ") : "ALL STEPS OK");
  b.close();
}
