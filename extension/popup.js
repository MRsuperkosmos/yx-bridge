// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// theme (auto / light / dark)
function applyTheme(mode) {
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  document.querySelectorAll("#theme button").forEach((b) => b.classList.toggle("sel", b.dataset.t === mode));
}
chrome.storage.local.get("theme").then((r) => applyTheme(r.theme || "auto")).catch(() => applyTheme("auto"));
document.querySelectorAll("#theme button").forEach((b) => {
  b.addEventListener("click", () => { const mode = b.dataset.t; applyTheme(mode); chrome.storage.local.set({ theme: mode }); });
});

// status
function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (s) => {
    if (!s) return;
    document.getElementById("dot").className = "dot " + (s.paused ? "paused" : s.connected ? "on" : "off");
    document.getElementById("state").textContent = s.paused ? tr("state_paused") : s.connected ? tr("state_connected") : tr("state_disconnected");
    document.getElementById("ver").textContent = (s.version ? "v" + s.version + " · " : "") + tr("app_sub");
    document.getElementById("url").textContent = (s.url || "").replace(/^ws:\/\//, "").replace(/^127\.0\.0\.1/, "localhost");
    document.getElementById("handled").textContent = s.handled;
    const at = s.attached && s.attached.length;
    document.getElementById("attached").textContent = at ? s.attached.length + " (" + s.attached.join(", ") + ")" : tr("attached_none");
    document.getElementById("err").textContent = (!s.connected && s.lastError) ? tr(s.lastError) : "";
    const sw = document.getElementById("pause");
    sw.setAttribute("aria-checked", s.paused ? "true" : "false");
    document.getElementById("pauseSub").textContent = s.paused ? tr("pause_off") : tr("pause_on");
    document.getElementById("pwState").textContent = s.hasPassword ? tr("pw_set") : tr("pw_none");
    // current password display (masked until revealed)
    CURRENT_PW = s.password || null;
    document.getElementById("pwCurrent").hidden = !s.hasPassword;
    if (s.hasPassword) document.getElementById("pwValue").textContent = PW_REVEALED ? CURRENT_PW : "•".repeat(Math.min(14, (CURRENT_PW || "").length || 8));
  });
}
let CURRENT_PW = null, PW_REVEALED = false;
document.getElementById("pwReveal").addEventListener("click", () => {
  PW_REVEALED = !PW_REVEALED;
  document.getElementById("pwReveal").setAttribute("title", tr(PW_REVEALED ? "pw_conceal_title" : "pw_reveal_title"));
  document.getElementById("pwValue").textContent = PW_REVEALED ? (CURRENT_PW || "") : "•".repeat(Math.min(14, (CURRENT_PW || "").length || 8));
});
document.getElementById("pwCopy").addEventListener("click", async () => {
  if (!CURRENT_PW) return;
  try { await navigator.clipboard.writeText(CURRENT_PW); } catch { const ta = document.createElement("textarea"); ta.value = CURRENT_PW; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  document.getElementById("pwMsg").textContent = tr("pw_copied");
});
document.getElementById("reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reconnect" }, () => setTimeout(refresh, 800));
});
document.getElementById("stats").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
});
document.getElementById("pause").addEventListener("click", () => {
  const on = document.getElementById("pause").getAttribute("aria-checked") === "true";
  chrome.runtime.sendMessage({ type: "pause", value: !on }, () => setTimeout(refresh, 200));
});

// password change from the extension
document.getElementById("pwToggle").addEventListener("click", () => {
  const e = document.getElementById("pwEdit");
  e.hidden = !e.hidden;
  document.getElementById("pwToggle").textContent = e.hidden ? tr("pw_change") : tr("pw_hide");
  if (!e.hidden) document.getElementById("pwInput").focus();
});
document.getElementById("pwSave").addEventListener("click", () => {
  let pw = document.getElementById("pwInput").value.trim();
  if (!pw) { const a = new Uint8Array(14); crypto.getRandomValues(a); pw = "yx-" + Array.from(a, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join(""); }
  chrome.runtime.sendMessage({ type: "setPassword", value: pw }, (r) => {
    document.getElementById("pwMsg").textContent = (r && r.ok) ? tr("pw_saved", pw) : tr("pw_error", r && r.error);
    document.getElementById("pwInput").value = "";
    setTimeout(refresh, 300);
  });
});
document.getElementById("pwClear").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "setPassword", value: "" }, (r) => {
    document.getElementById("pwMsg").textContent = (r && r.ok) ? tr("pw_removed") : tr("pw_error", "");
    setTimeout(refresh, 300);
  });
});

// language
loadLang().then(() => {
  applyStatic();
  wireLangToggle(refresh);
  refresh();
  setInterval(refresh, 1500);
});
