# Changelog

All notable changes to YX Bridge. Dates are 2026.

## 1.0.0 — 12 Sep
First stable public release. YX Bridge is a browser extension plus a local MCP server that gives an AI agent access to your open tabs: read pages, edit the DOM, run JS, take screenshots, read media, send raw DevTools commands, control Yandex Browser's auto-translation, and drive the browser UI (Windows). 254 tools. Optional local password on the port, a pause kill-switch, and browsing statistics (local-time hourly chart, time zone, JSON/CSV export). Bilingual EN/RU interface. Apache-2.0.

Hardening done during the release review:
- A client becomes "the extension" only after a hello that passes the password check. Unauthenticated sockets can no longer displace the real extension, receive commands, spoof replies or change the password; a client that never says hello is dropped.
- The password/token file path is derived with `fileURLToPath`, so installs under folders with spaces or non-Latin letters work.
- Yandex Browser paths on Linux restored (they had been caught by the project rename).
- The statistics page escapes domain names, so an imported file cannot inject markup.
- Passwords are generated from a cryptographic random source (server and popup).
- The MCP handshake reports the real package version; CSV export groups multi-part TLDs (co.uk) like the extension.
- Installer fixes: the one-click Windows installer no longer aborts when a tool writes to stderr (a PowerShell 5.1 quirk that crashed it at the Claude Code registration and connection-check steps); the Claude Code config is read as UTF-8 and written without a BOM (Node cannot parse JSON with a BOM); the manual hint now says `chrome://extensions` (in Yandex Browser `browser://extensions` opens the catalog); the skip-pause variable is `YX_BRIDGE_NOPAUSE`. Leftovers of the project's old name were removed from the code (default notification title, content-script id, test strings, tool descriptions).
- New offline test `server/test-auth.mjs` for the connection/password rules.

## 0.9.6 — 12 Sep
- **Statistics record and show your time zone.** The extension reads your device's zone (e.g. Europe/Amsterdam, UTC+2), stores it with the data, shows it on the statistics page next to `Tracking since`, and reports it to the agent. Day and hour counting already runs in that zone.

## 0.9.5 — 12 Sep
- **Popup status dot turns yellow when you pause the agent** (it was red), matching the toolbar icon: green = connected, red = not connected, yellow = paused.
- **Statistics use local time** for the day and hour buckets, so the hourly `Today` view lines up with your clock and no longer drifts near midnight.

## 0.9.4 — 12 Sep
- **New icon**: a white light bulb on an orange background (16/32/48/128).
- **Live status dot on the toolbar icon**: green = connected to the agent, red = not connected, yellow = you paused the agent from the extension. The icon is redrawn whenever the state changes.
- **Hardening**: removed the throwaway pause-recovery page used during testing and added a build-time allowlist so no stray test page can ship in the extension.

## 0.9.3 — 12 Sep
- **Statistics bar chart with a Day / Week / Month / Year switch.**
- **Day view is hourly**: one bar per hour of the day plus a line `Active from HH:00 to HH:00 · busiest hour HH:00`, so you can see from what time to what time you were in the browser. Per-hour detail is recorded from this version onward.
- Week shows the last 7 days, Month the last 30 days, Year the last 12 months.

## 0.9.2 — 12 Sep
- **Show the connection password in the popup**: the current password is displayed (hidden behind dots, with reveal and copy buttons); still changeable/removable inside.
- **Hide the IP**: the popup shows `localhost` instead of `127.0.0.1` for the server address.

## 0.9.1 — 12 Sep
- **Fix stats table desync**: the "most visited" table now follows the same grouping toggle as the activity table, so both always show the same domains (subdomains or main domains) instead of one splitting subdomains while the other merged them.

## 0.9.0 — 12 Sep
- **Bilingual interface**: the popup and statistics page are English by default with an EN/RU toggle (persisted). Every label, button, time unit and message is translated.

## 0.8.7 — 12 Sep
- **Change the connection password from the extension**: a password section in the popup sets, changes or removes it in the browser; the new password syncs to the server over the live connection.

## 0.8.6 — 12 Sep
- **Connection password**: optional password locks the local port so only the genuine extension may connect (`browser_password`). The agent can set it itself; it is stored in the extension and a server-side `.token` file.
- **browser_jwt_decode**: decode a JWT's header/payload (and scan a page's storage for JWTs).
- **Statistics fairness**: time is counted only while the browser window is focused — minimized or covered-by-a-fullscreen-app time is no longer counted.
- **Statistics export/import**: export JSON (re-importable, move between devices) and CSV (share your screen time) from the stats page or via `browser_stats_export` / `browser_stats_import`.
- **GitHub-ready**: `.gitignore`, this changelog, package metadata.

## 0.8.5 — 12 Sep
- Statistics: removed the TLD "zone" grouping; fixed column shifting (fixed table layout); lists limited to ~10 rows with scroll to 100; search by domain; the "most visited" list stays by main domain.

## 0.8.4 — 12 Sep
- Statistics: the "top most visited" list no longer changes with the grouping toggle.

## 0.8.3 — 12 Sep
- Statistics: domain-grouping toggle (subdomains / main domain / zone).

## 0.8.2 — 12 Sep
- Detailed statistics: day/week/month/year totals (d/h/m), date-range picker, grouping by main domain, top by visits.

## 0.8.1 — 12 Sep
- New popup and stats-page design; light/dark/auto theme toggle.

## 0.8.0 — 12 Sep
- Browsing statistics: the extension records active-tab time per domain, viewable on its own page and via `browser_stats`.

## 0.7.0 — 12 Sep
- Reached 250 tools: student (quizzes, code editors, formulas), tester/security (tech detect, secrets, CSP, robots/sitemap, CORS), and extraction/productivity batches; `browser_snapshot` to dump a whole page.

## 0.6.x — 12 Sep
- Work-window support so the agent never disturbs the user's window; `keep_visible` for background tabs; media tools (image view, video frames, media download).

## earlier — 12 Sep
- Renamed to **yx-bridge**; Apache-2.0 license (author MRsuperkosmos); translation control (page-level and profile-level); browser-UI automation on Windows; the core extension + MCP server with tabs/DOM/JS/CDP tools.
