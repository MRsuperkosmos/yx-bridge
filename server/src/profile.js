// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Browser-profile level operations that no extension API can do: editing the
// Preferences file (translate settings). Requires the browser to be closed while
// writing, because Chromium rewrites Preferences on exit.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = {
  win32: {
    userData: [path.join(process.env.LOCALAPPDATA || "", "Yandex", "YandexBrowser", "User Data")],
    exe: [
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Yandex", "YandexBrowser", "Application", "browser.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Yandex", "YandexBrowser", "Application", "browser.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Yandex", "YandexBrowser", "Application", "browser.exe"),
    ],
    processName: "browser.exe",
  },
  darwin: {
    userData: [path.join(os.homedir(), "Library", "Application Support", "Yandex", "YandexBrowser")],
    exe: ["/Applications/Yandex.app/Contents/MacOS/Yandex"],
    processName: "Yandex",
  },
  linux: {
    userData: [path.join(os.homedir(), ".config", "yx-bridge"), path.join(os.homedir(), ".config", "yx-bridge-beta")],
    exe: ["/usr/bin/yx-bridge", "/usr/bin/yx-bridge-beta", "/opt/yandex/browser/yx-bridge"],
    processName: "yx-bridge",
  },
};

export function locate({ userData, profile = "Default", exe } = {}) {
  const c = CANDIDATES[process.platform] || CANDIDATES.linux;
  const ud = userData || process.env.BROWSER_USER_DATA || c.userData.find((p) => fs.existsSync(p));
  const bin = exe || process.env.BROWSER_EXE || c.exe.find((p) => fs.existsSync(p));
  if (!ud) throw new Error("browser user-data dir not found; set BROWSER_USER_DATA");
  const prefs = path.join(ud, profile, "Preferences");
  if (!fs.existsSync(prefs)) throw new Error(`Preferences not found: ${prefs}`);
  return { userData: ud, profile, prefs, exe: bin, processName: c.processName };
}

export function readPrefs(loc) {
  return JSON.parse(fs.readFileSync(loc.prefs, "utf8").replace(/^\uFEFF/, ""));
}

// ---- translate settings ---------------------------------------------------
export function getTranslateSettings(loc) {
  const p = readPrefs(loc);
  return {
    enabled: p.translate && p.translate.enabled === false ? false : true,
    alwaysTranslate: p.translate_allowlists || {}, // {"en":"ru"}
    neverOfferFrom: p.translate_blocked_languages || [], // ["en"]
    neverTranslateSites: Object.keys(p.translate_site_blocklist_with_time || {}),
    recentTarget: p.translate_recent_target || null,
    yandexAutosuggestDisabledPairs: (p.autotranslate && p.autotranslate.autosuggest_disabled_pairs) || [],
  };
}

// desired: { enabled?, always?: {lang:target} | null, neverOfferFrom?: [lang] | null, neverTranslateSites?: [host] | null,
//            removeAlways?: [lang], removeNeverOffer?: [lang], removeSites?: [host] }
export function applyTranslateSettings(loc, desired) {
  const p = readPrefs(loc);
  const backup = loc.prefs + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(loc.prefs, backup);

  if (desired.enabled !== undefined) {
    p.translate = { ...(p.translate || {}), enabled: !!desired.enabled };
  }
  if (desired.always !== undefined) {
    if (desired.always === null) delete p.translate_allowlists;
    else p.translate_allowlists = { ...(p.translate_allowlists || {}), ...desired.always };
  }
  for (const l of desired.removeAlways || []) if (p.translate_allowlists) delete p.translate_allowlists[l];
  if (desired.neverOfferFrom !== undefined) {
    if (desired.neverOfferFrom === null) delete p.translate_blocked_languages;
    else p.translate_blocked_languages = [...new Set([...(p.translate_blocked_languages || []), ...desired.neverOfferFrom])];
  }
  if (desired.removeNeverOffer && p.translate_blocked_languages) {
    p.translate_blocked_languages = p.translate_blocked_languages.filter((l) => !desired.removeNeverOffer.includes(l));
  }
  if (desired.neverTranslateSites !== undefined) {
    if (desired.neverTranslateSites === null) delete p.translate_site_blocklist_with_time;
    else {
      p.translate_site_blocklist_with_time = p.translate_site_blocklist_with_time || {};
      // Chromium "webkit time": microseconds since 1601-01-01
      const now = String((Date.now() + 11644473600000) * 1000);
      for (const h of desired.neverTranslateSites) p.translate_site_blocklist_with_time[h] = now;
    }
  }
  for (const h of desired.removeSites || []) if (p.translate_site_blocklist_with_time) delete p.translate_site_blocklist_with_time[h];

  // A language cannot be both "always translate" and "never offer": never wins.
  for (const l of p.translate_blocked_languages || []) if (p.translate_allowlists) delete p.translate_allowlists[l];

  fs.writeFileSync(loc.prefs, JSON.stringify(p));
  return { backup, settings: getTranslateSettings(loc) };
}

// ---- process control ------------------------------------------------------
export async function isRunning(loc) {
  if (process.platform === "win32") {
    const { stdout } = await execFileP("tasklist", ["/FI", `IMAGENAME eq ${loc.processName}`, "/FO", "CSV", "/NH"]);
    return stdout.toLowerCase().includes(loc.processName.toLowerCase());
  }
  try {
    await execFileP("pgrep", ["-f", loc.processName]);
    return true;
  } catch {
    return false;
  }
}

export async function closeBrowser(loc, { timeoutMs = 20000, force = false } = {}) {
  if (!(await isRunning(loc))) return { closed: true, wasRunning: false };
  if (process.platform === "win32") {
    // graceful: WM_CLOSE to every window; the browser saves session + prefs and exits
    await execFileP("taskkill", ["/IM", loc.processName]).catch(() => {});
  } else if (process.platform === "darwin") {
    await execFileP("osascript", ["-e", 'tell application "Yandex" to quit']).catch(() => {});
  } else {
    await execFileP("pkill", ["-TERM", "-f", loc.processName]).catch(() => {});
  }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!(await isRunning(loc))) return { closed: true, wasRunning: true, forced: false, ms: Date.now() - t0 };
    await sleep(400);
  }
  if (!force) return { closed: false, wasRunning: true, hint: "browser did not exit gracefully; pass force=true to kill it" };
  if (process.platform === "win32") await execFileP("taskkill", ["/F", "/IM", loc.processName]).catch(() => {});
  else await execFileP("pkill", ["-KILL", "-f", loc.processName]).catch(() => {});
  await sleep(1000);
  return { closed: !(await isRunning(loc)), wasRunning: true, forced: true };
}

export function launchBrowser(loc, args = []) {
  if (!loc.exe) throw new Error("browser executable not found; set BROWSER_EXE");
  const child = process.platform === "darwin" && loc.exe.endsWith("/MacOS/Yandex")
    ? spawn("open", ["-a", "Yandex", ...(args.length ? ["--args", ...args] : [])], { detached: true, stdio: "ignore" })
    : spawn(loc.exe, args, { detached: true, stdio: "ignore" });
  child.unref();
  return { launched: true, exe: loc.exe };
}
