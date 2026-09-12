// YX Bridge stats page — reads chrome.storage.local directly (works with the AI off).

// theme (shared with popup)
function applyTheme(mode) {
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  document.querySelectorAll("#theme button").forEach((b) => b.classList.toggle("sel", b.dataset.t === mode));
}
chrome.storage.local.get("theme").then((r) => applyTheme(r.theme || "auto")).catch(() => applyTheme("auto"));
document.querySelectorAll("#theme button").forEach((b) => b.addEventListener("click", () => { applyTheme(b.dataset.t); chrome.storage.local.set({ theme: b.dataset.t }); }));

// ---- helpers ----
const MULTI = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au", "co.jp", "co.nz", "com.br", "com.tr", "co.in", "com.ua", "co.il", "com.cn", "com.mx", "com.sg", "com.hk", "com.ru"]);
function mainDomain(host) { const p = String(host).split("."); if (p.length <= 2) return host; const l2 = p.slice(-2).join("."); return MULTI.has(l2) ? p.slice(-3).join(".") : l2; }
let GROUP = "main"; // host | main
function groupKey(host) { return GROUP === "host" ? host : mainDomain(host); }
function dhm(sec) { const m = Math.round(sec / 60); const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; const out = []; if (d) out.push(d + " " + tr("unit_d")); if (h) out.push(h + " " + tr("unit_h")); if (mm || !out.length) out.push(mm + " " + tr("unit_min")); return out.join(" "); }
function iso(offset) { const d = new Date(Date.now() - offset * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

let STATS = { totalSeconds: 0, byDomain: {}, byDay: {}, since: null };

function rangeSecondsByMain(from, to) {
  const byMain = {}; let total = 0;
  for (const [day, v] of Object.entries(STATS.byDay || {})) {
    if (from && day < from) continue;
    if (to && day > to) continue;
    for (const [host, sec] of Object.entries(v.byDomain || {})) { const md = groupKey(host); byMain[md] = (byMain[md] || 0) + sec; total += sec; }
  }
  return { byMain, total };
}
function periodSeconds(days) { let t = 0; for (let i = 0; i < days; i++) { const d = STATS.byDay[iso(i)]; if (d) t += d.seconds; } return t; }

function renderCards() {
  document.getElementById("pDay").textContent = dhm(periodSeconds(1));
  document.getElementById("pWeek").textContent = dhm(periodSeconds(7));
  document.getElementById("pMonth").textContent = dhm(periodSeconds(30));
  document.getElementById("pYear").textContent = dhm(periodSeconds(365));
  const sinceTxt = STATS.since ? tr("since", new Date(STATS.since).toLocaleDateString(LANG === "ru" ? "ru-RU" : "en-US")) : tr("since_empty");
  let tz = STATS.tz; try { if (!tz) tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  const offMin = typeof STATS.tzOffsetMin === "number" ? STATS.tzOffsetMin : -new Date().getTimezoneOffset();
  document.getElementById("since").textContent = sinceTxt + (tz ? "  ·  " + tr("tz_label", tz, fmtOffset(offMin)) : "");
}
function fmtOffset(min) { const sign = min >= 0 ? "+" : "-"; const a = Math.abs(min); const h = Math.floor(a / 60), m = a % 60; return "UTC" + sign + h + (m ? ":" + String(m).padStart(2, "0") : ""); }

let CHART = "month"; // day | week | month | year
function monthName(m) { return new Date(2000, m, 1).toLocaleDateString(LANG === "ru" ? "ru-RU" : "en-US", { month: "short" }); }
function weekdayName(d) { return new Date(d + "T12:00:00").toLocaleDateString(LANG === "ru" ? "ru-RU" : "en-US", { weekday: "short" }); }

function renderChart() {
  const bars = document.getElementById("daybars"); bars.innerHTML = "";
  const labs = document.getElementById("chartLabels"); labs.innerHTML = "";
  const title = document.getElementById("chartTitle");
  const range = document.getElementById("dayrange");
  const data = []; // {val, tip, label}

  if (CHART === "day") {
    title.textContent = tr("chart_t_day");
    const bh = STATS.byDay[iso(0)]?.byHour || {};
    for (let h = 0; h < 24; h++) { const sec = bh[h] || 0; data.push({ val: sec, tip: `${h}:00–${h + 1}:00 · ${dhm(sec)}`, label: (h % 6 === 0 || h === 23) ? h + "h" : "" }); }
    const active = data.map((d, i) => (d.val > 0 ? i : -1)).filter((i) => i >= 0);
    if (active.length) {
      const first = active[0], last = active[active.length - 1];
      let peak = 0; for (let i = 1; i < 24; i++) if (data[i].val > data[peak].val) peak = i;
      range.textContent = tr("active_window", first + ":00", (last + 1) + ":00") + " · " + tr("active_peak", peak + ":00");
    } else range.textContent = tr("active_none");
  } else if (CHART === "week") {
    title.textContent = tr("chart_t_week");
    for (let i = 6; i >= 0; i--) { const d = iso(i); const sec = STATS.byDay[d]?.seconds || 0; data.push({ val: sec, tip: d + " · " + dhm(sec), label: weekdayName(d) }); }
  } else if (CHART === "year") {
    title.textContent = tr("chart_t_year");
    const buckets = {}; for (const [day, v] of Object.entries(STATS.byDay || {})) { const ym = day.slice(0, 7); buckets[ym] = (buckets[ym] || 0) + (v.seconds || 0); }
    const now = new Date();
    for (let i = 11; i >= 0; i--) { const dt = new Date(now.getFullYear(), now.getMonth() - i, 1); const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; const sec = buckets[ym] || 0; data.push({ val: sec, tip: ym + " · " + dhm(sec), label: monthName(dt.getMonth()) }); }
  } else { // month
    title.textContent = tr("chart_t_month");
    for (let i = 29; i >= 0; i--) { const d = iso(i); const sec = STATS.byDay[d]?.seconds || 0; const dn = +d.slice(8, 10); data.push({ val: sec, tip: d + " · " + dhm(sec), label: (dn % 5 === 0) ? dn : "" }); }
  }

  const max = Math.max(1, ...data.map((d) => d.val));
  for (const d of data) {
    const b = document.createElement("div"); b.className = "daybar";
    b.style.height = (d.val > 0 ? Math.max(6, Math.round((d.val / max) * 100)) : 2) + "%";
    if (d.val === 0) b.style.opacity = ".2";
    b.title = d.tip; bars.appendChild(b);
    const l = document.createElement("div"); l.className = "clab"; l.textContent = d.label; labs.appendChild(l);
  }
  if (CHART !== "day") { const total = data.reduce((s, d) => s + d.val, 0); range.textContent = tr("chart_total", dhm(total), dhm(max)); }
}

function renderRange() {
  const from = document.getElementById("from").value || null;
  const to = document.getElementById("to").value || null;
  const { byMain, total } = rangeSecondsByMain(from, to);
  document.getElementById("siteColHead").textContent = tr(GROUP === "host" ? "col_site_sub" : "col_site_main");
  document.getElementById("rangeLabel").textContent = tr("range_label", from || tr("range_start"), to || tr("range_today"), dhm(total));
  const q = (document.getElementById("siteSearch").value || "").trim().toLowerCase();
  let all = Object.entries(byMain).map(([domain, sec]) => ({ domain, sec })).sort((a, b) => b.sec - a.sec);
  const totalCount = all.length;
  if (q) all = all.filter((r) => r.domain.toLowerCase().includes(q));
  const rows = all.slice(0, 100);
  const max = Math.max(1, ...rows.map((r) => r.sec));
  const tb = document.getElementById("rangeSites"); tb.innerHTML = "";
  for (const r of rows) { const tr2 = document.createElement("tr"); tr2.innerHTML = `<td class="dom" title="${r.domain}">${r.domain}</td><td class="num">${dhm(r.sec)}</td><td><div class="bar" style="width:${Math.round((r.sec / max) * 100)}%"></div></td>`; tb.appendChild(tr2); }
  if (!rows.length) tb.innerHTML = `<tr><td colspan="3" class="muted">${tr("empty_range", q)}</td></tr>`;
  document.getElementById("rangeCount").textContent = q ? tr("count_found", all.length) : tr("count_domains", totalCount);
}

function renderTopVisits() {
  // Follow the same grouping as the activity table so the two stay in sync.
  const visits = {}, secs = {};
  for (const [host, v] of Object.entries(STATS.byDomain)) { const md = groupKey(host); visits[md] = (visits[md] || 0) + v.visits; secs[md] = (secs[md] || 0) + v.seconds; }
  const rows = Object.entries(visits).map(([domain, n]) => ({ domain, visits: n, sec: secs[domain] || 0 })).sort((a, b) => b.visits - a.visits).slice(0, 100);
  document.getElementById("topSiteHead").textContent = tr(GROUP === "host" ? "col_site_sub" : "col_site_main");
  const tb = document.getElementById("topVisits"); tb.innerHTML = "";
  for (const r of rows) { const tr2 = document.createElement("tr"); tr2.innerHTML = `<td class="dom" title="${r.domain}">${r.domain}</td><td class="num">${r.visits}</td><td class="num muted">${dhm(r.sec)}</td>`; tb.appendChild(tr2); }
  if (!rows.length) tb.innerHTML = `<tr><td colspan="3" class="muted">${tr("empty_top")}</td></tr>`;
}

async function load() {
  const store = await chrome.storage.local.get("stats");
  STATS = store.stats || { totalSeconds: 0, byDomain: {}, byDay: {}, since: null };
  renderCards(); renderChart(); renderRange(); renderTopVisits();
}

// chart period toggle (day / week / month / year), persisted
chrome.storage.local.get("statChart").then((r) => { CHART = ["day", "week", "month", "year"].includes(r.statChart) ? r.statChart : "month"; document.querySelectorAll("#chartPeriod button").forEach((b) => b.classList.toggle("sel", b.dataset.c === CHART)); renderChart(); }).catch(() => {});
document.querySelectorAll("#chartPeriod button").forEach((b) => b.addEventListener("click", () => { CHART = b.dataset.c; document.querySelectorAll("#chartPeriod button").forEach((x) => x.classList.toggle("sel", x === b)); chrome.storage.local.set({ statChart: CHART }); renderChart(); }));

// date range presets
function setPreset(days) {
  document.getElementById("to").value = iso(0);
  document.getElementById("from").value = days === 0 ? (STATS.since ? STATS.since.slice(0, 10) : iso(365)) : iso(days - 1);
  document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("sel", +b.dataset.d === days));
  renderRange();
}
document.querySelectorAll("#presets button").forEach((b) => b.addEventListener("click", () => setPreset(+b.dataset.d)));
// grouping toggle (host / main / tld), persisted
chrome.storage.local.get("statGroup").then((r) => { GROUP = r.statGroup === "host" ? "host" : "main"; document.querySelectorAll("#grouping button").forEach((b) => b.classList.toggle("sel", b.dataset.g === GROUP)); renderRange(); renderTopVisits(); }).catch(() => {});
document.querySelectorAll("#grouping button").forEach((b) => b.addEventListener("click", () => { GROUP = b.dataset.g; document.querySelectorAll("#grouping button").forEach((x) => x.classList.toggle("sel", x === b)); chrome.storage.local.set({ statGroup: GROUP }); renderRange(); renderTopVisits(); }));
document.getElementById("from").addEventListener("change", () => { document.querySelectorAll("#presets button").forEach((b) => b.classList.remove("sel")); renderRange(); });
document.getElementById("to").addEventListener("change", () => { document.querySelectorAll("#presets button").forEach((b) => b.classList.remove("sel")); renderRange(); });
document.getElementById("siteSearch").addEventListener("input", renderRange);
document.getElementById("refresh").addEventListener("click", load);

// export / import (works entirely in the browser, no agent needed)
function download(name, text, mime) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const stamp = () => new Date().toISOString().slice(0, 10);
document.getElementById("exportJson").addEventListener("click", () => { download(`yx-stats-${stamp()}.json`, JSON.stringify(STATS, null, 1), "application/json"); document.getElementById("ioMsg").textContent = tr("io_json"); });
document.getElementById("exportCsv").addEventListener("click", () => {
  const byMain = {};
  for (const [host, v] of Object.entries(STATS.byDomain)) { const m = mainDomain(host); const t = byMain[m] = byMain[m] || { sec: 0, visits: 0 }; t.sec += v.seconds; t.visits += v.visits; }
  const rows = [["domain", "minutes", "hours", "visits"]].concat(Object.entries(byMain).sort((a, b) => b[1].sec - a[1].sec).map(([d, v]) => [d, Math.round(v.sec / 60), Math.round(v.sec / 360) / 10, v.visits]));
  download(`yx-stats-${stamp()}.csv`, rows.map((r) => r.join(",")).join("\n"), "text/csv");
  document.getElementById("ioMsg").textContent = tr("io_csv");
});
document.getElementById("import").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.byDomain && !data.byDay) throw new Error(tr("io_bad_file"));
    const merge = confirm(tr("io_import_confirm"));
    if (merge) {
      const cur = STATS;
      cur.totalSeconds = (cur.totalSeconds || 0) + (data.totalSeconds || 0);
      for (const [d, v] of Object.entries(data.byDomain || {})) { const t = cur.byDomain[d] = cur.byDomain[d] || { seconds: 0, visits: 0, lastVisit: null }; t.seconds += v.seconds || 0; t.visits += v.visits || 0; }
      for (const [day, v] of Object.entries(data.byDay || {})) { const dd = cur.byDay[day] = cur.byDay[day] || { seconds: 0, byDomain: {}, byHour: {} }; dd.seconds += v.seconds || 0; for (const [h, sec] of Object.entries(v.byDomain || {})) dd.byDomain[h] = (dd.byDomain[h] || 0) + sec; if (v.byHour) { dd.byHour = dd.byHour || {}; for (const [h, sec] of Object.entries(v.byHour)) dd.byHour[h] = (dd.byHour[h] || 0) + sec; } }
      await chrome.storage.local.set({ stats: cur });
    } else await chrome.storage.local.set({ stats: data });
    document.getElementById("ioMsg").textContent = tr("io_imported");
    load();
  } catch (err) { document.getElementById("ioMsg").textContent = tr("io_import_fail", err.message); }
  e.target.value = "";
});
document.getElementById("reset").addEventListener("click", async () => { if (confirm(tr("reset_confirm"))) { await chrome.storage.local.remove("stats"); load(); } });

// init: language first, then render
document.getElementById("to").value = iso(0);
document.getElementById("from").value = iso(29);
loadLang().then(() => {
  applyStatic();
  wireLangToggle(load);
  load();
  setInterval(load, 8000);
});
