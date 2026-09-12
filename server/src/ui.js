// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Browser-chrome automation (Windows only) through UI Automation: toolbar buttons,
// bubbles, menus — everything the extension API cannot reach. Backed by src/uia.ps1.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "uia.ps1");

export const supported = process.platform === "win32";

async function ps(args, timeoutMs = 60000) {
  if (!supported) throw new Error("browser UI automation is Windows-only (UI Automation)");
  const { stdout } = await execFileP("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args], {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const dedupe = (arr) => {
  const seen = new Set();
  return (arr || []).filter((e) => {
    const k = [e.type, e.name, e.class, e.x, e.y, e.w, e.h].join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export async function uiList(pattern = ".", includeWeb = false) {
  const r = await ps(["list", "-Pattern", pattern, ...(includeWeb ? ["-IncludeWeb"] : [])]);
  return dedupe(Array.isArray(r) ? r : r && r.type ? [r] : []);
}

export async function uiClick(pattern, index = 0) {
  return ps(["click", "-Pattern", pattern, "-Index", String(index)]);
}

export async function uiChain(steps, timeoutMs = 5000) {
  const r = await ps(["chain", "-Steps", steps, "-TimeoutMs", String(timeoutMs)], 120000);
  const arr = Array.isArray(r) ? r : [r];
  for (const s of arr) if (s && s.found) s.found = dedupe(s.found);
  return arr;
}

// ---- Yandex translate bubble -------------------------------------------------
// Toolbar button is "Переведено" on a translated page or "Перевести" on an untranslated one.
const TRANSLATE_BTN = "^(Переведено|Перевести|Translated|Translate)$";
const BUBBLE = "YandexBaseBubbleFrameView";
const MENU = "ContextMenuItemsView";
const ITEMS = {
  show_original: "^(Показать оригинал|Show original)",
  translate: "^(Перевести|Translate)$",
  translate_images: "^(Перевести все картинки|Translate all images)",
  always_translate: "^(Всегда переводить|Always translate)",
  never_offer: "^(Не предлагать перевод|Never offer to translate|Never translate .*language)",
  never_this_site: "^(Никогда не переводить этот сайт|Never translate this site)",
  change_language: "^(Сменить язык|Change language)",
};

export async function translateMenu(action = "status") {
  const steps = [`click:${TRANSLATE_BTN}`, `wait:${BUBBLE}`, "sleep:300", "list:^PopupButtonBase$"];
  const open = await uiChain(steps.join(";"));
  const bubbleStep = open.find((s) => s.step.startsWith("wait:"));
  if (!bubbleStep || !bubbleStep.ok) return { ok: false, error: "translate bubble did not open (is the page translatable? is the browser window visible?)", trace: open };
  const buttons = (open[open.length - 1].found || []).filter((e) => e.type === "Button");
  const result = { ok: true, bubbleButtons: buttons.map((b) => b.name) };

  if (action === "show_original" || action === "translate" || action === "translate_images") {
    const r = await uiChain(`click:${ITEMS[action]}`);
    result.clicked = r[0];
    return result;
  }

  // the "⋮" button has no accessible name: it sits right of the last labelled button in the bubble
  const last = buttons.filter((b) => b.y > 200).sort((a, b) => b.x - a.x)[0];
  if (!last) {
    await uiChain("key:ESC");
    return { ...result, ok: false, error: "no bubble buttons found" };
  }
  const mx = Math.round(last.x + last.w + 38);
  const my = Math.round(last.y + last.h / 2);
  const menu = await uiChain(`mouse:${mx},${my};wait:${MENU};sleep:200;list:ContextMenuItemsButtonView`);
  const items = (menu[menu.length - 1].found || []).filter((e) => e.type === "CheckBox" || e.type === "MenuItem");
  result.menu = items.map((i) => ({ name: i.name, type: i.type, checked: i.checked }));
  if (!items.length) {
    await uiChain("key:ESC;sleep:200;key:ESC");
    return { ...result, ok: false, error: "menu did not open" };
  }

  if (action === "status") {
    await uiChain("key:ESC;sleep:200;key:ESC");
    return result;
  }
  const pat = ITEMS[action];
  if (!pat) {
    await uiChain("key:ESC;sleep:200;key:ESC");
    return { ...result, ok: false, error: `unknown action ${action}` };
  }
  const r = await uiChain(`click:${pat}`);
  result.clicked = r[0];
  await uiChain("sleep:300;key:ESC");
  return result;
}
