> This document is provided in two languages: **English** first, then **Русский** (same content).
> Этот документ приведён на двух языках: сначала **английский**, затем **русский** (то же содержание).

---

# YX Bridge — Yandex Browser / Chromium ⇄ AI agents (MCP)

Browser extension + local MCP server. Gives Claude Code (or any MCP-capable agent) access to your open
tabs: read pages, change their code (DOM), click and type, run JavaScript, take screenshots, send raw
DevTools Protocol commands, control Yandex Browser's auto-translation, drive the browser's own UI.
Works in Yandex Browser and any Chromium browser (Chrome, Edge, Brave, Opera, Vivaldi).

```
Agent ──stdio──> server/src/server.js ──ws://127.0.0.1:17555──> extension/background.js ──> tabs
                       └── browser profile files, browser start/stop, UI Automation (Windows)
```

No accounts, no external servers. Everything stays on your computer. An optional local password locks the port to your extension only.

## 1. Installation

### Requirements
- Node.js 18+ (https://nodejs.org, LTS) — the Windows installer installs it if missing
- Claude Code (CLI) or another MCP-capable agent
- Yandex Browser or another Chromium browser

### Fastest: one double-click (Windows)
1. Extract the archive to a permanent folder, e.g. `C:\tools\yx-bridge`.
2. Double-click **`install.cmd`**.

The installer: installs Node.js via winget if missing; installs server dependencies; registers the MCP
server in Claude Code; opens a **new browser window** on the extensions page, turns on Developer mode,
clicks "Load unpacked", enters the path and confirms; closes that window; checks the connection.
Your open tabs are untouched. Supports Yandex Browser, Chrome and Edge (`install.cmd -Browser chrome`).

Uninstall: double-click **`uninstall.cmd`** — removes the Claude Code registration and removes the
extension from the browser (card → Remove → confirm), also automatically. Then delete the folder.

Flags: `-NoBrowser` (server + registration only), `-NoNode` (do not install Node.js).
macOS/Linux: `install.sh` (the extension is loaded manually there, see below).

### Installation by an AI agent
Hand the archive to any agent and say "install it following AGENT-INSTALL.md". That file is written for
agents: it runs the installer, finds the agent's own config (Claude Code, Cursor, OpenCode, Codex,
Gemini CLI, Windsurf, Cline, Claude Desktop, VS Code Copilot, Zed) and registers the server itself.

### Manual way
1. **Extract** to a permanent folder (`C:\tools\yx-bridge` or `~/yx-bridge`). Do not move it later:
   the path is written into the agent config and the browser.
2. **Server + registration:** Windows: right-click `install.ps1` → Run with PowerShell
   (or `powershell -ExecutionPolicy Bypass -File install.ps1`); macOS/Linux: `bash install.sh`.
   Equivalent by hand:
   ```
   cd server
   npm install
   claude mcp add yx-bridge -s user -- node "<full path>/server/src/server.js"
   ```
   The self-test must print `mcp tools: 254 ...`.
3. **Load the extension:** type `chrome://extensions` in the address bar (in Yandex Browser type exactly
   this; `browser://extensions` opens Yandex's catalog instead), turn on **Developer mode** (top right),
   click **Load unpacked**, choose the **`extension`** folder. A "YX Bridge" card appears and an orange
   light-bulb icon on the toolbar. The dot in its corner shows the state: green = connected to the server,
   red = server not running yet (it starts together with the agent), yellow = you paused the agent.
4. **Restart the agent.** Tools `browser_*` appear. Test: ask "list my open tabs".

## 2. Usage

Just tell the agent what you need:
- "Read the open tab and summarise it"
- "Find all PDF links on this page"
- "Remove the cookie banner and ads from this page"
- "Fill the form: name John, email …, and submit"
- "Take a full-page screenshot"
- "Run `return window.__APP_STATE__` on the page"
- "Extract the table on this page as CSV"
- "Open these 3 links in tabs and collect their titles"
- "Look at the photos on this page" / "Watch this video and tell me what happens"

`tabId` is optional in every tool: without it the active tab is used. `browser_list_tabs` gives ids.

If you work in the browser at the same time as the agent, ask it to "work in a second window": it calls
`browser_work_window least_tabs`, and all its tabs open in a separate window without stealing focus.

The extension UI (popup and statistics page) is in **English by default** with an **EN/RU** toggle in the corner — the choice is remembered.

**Extension icon:** click the light-bulb icon for connection status, executed-command count, tabs with the
debugger attached, a Reconnect button, the **pause switch** (stops all data transfer to the agent until you
switch it back) and the **connection password** (shown behind dots with reveal/copy; change or remove it there).

## 3. Tools (254)

### Tabs
| Tool | What it does |
|---|---|
| `browser_status` | Is the extension connected, its version, tabs with the debugger attached |
| `browser_list_tabs` | All tabs: id, window, url, title, active |
| `browser_active_tab` | Current tab |
| `browser_open_tab` | Open a new tab (in the work window if set) |
| `browser_close_tab` | Close a tab |
| `browser_activate_tab` | Make a tab active; `focusWindow=false` keeps your window in front |
| `browser_navigate` | Go to a URL and wait for load |
| `browser_reload` | Reload (optionally bypassing cache) |
| `browser_back` | Go back |

### Reading
| Tool | What it does |
|---|---|
| `browser_get_page` | url, title and the visible text; `original=true` re-fetches untranslated HTML |
| `browser_get_html` | HTML of the document or of an element by CSS selector |
| `browser_query` | querySelectorAll: tag, id, class, text, href/src/value, rect, visibility, attributes |
| `browser_find_text` | Substring search with count and context snippets |
| `browser_links` | All unique links with text |
| `browser_forms` | Forms and fields (passwords masked) |
| `browser_tables` | HTML tables as row arrays, headers from `<thead>` |
| `browser_wait_for` | Wait until a selector and/or text appears |
| `browser_screenshot` | Screenshot of the tab; `fullPage=true` for the whole page; saves a file and shows the image |
| `browser_pdf` | Save the page as PDF |
| `browser_console_logs` | console.log/warn/error and uncaught exceptions |

### Changing the page
| Tool | What it does |
|---|---|
| `browser_click` | Click the Nth element matching a selector |
| `browser_type` | Type into input/textarea/contenteditable; `clear`, `submit` |
| `browser_select` | Choose a `<select>` option by value or text |
| `browser_set_html` | Replace element HTML (`inner`/`outer`), `append`/`prepend`, or set `text` |
| `browser_set_attr` | Set or remove an attribute |
| `browser_set_style` | Inline styles |
| `browser_remove` | Remove elements (banners, popups) |
| `browser_inject_css` | Inject a stylesheet |
| `browser_scroll` | Scroll the window or to an element |

### JavaScript
| Tool | What it does |
|---|---|
| `browser_eval` | Run JS in the page context (sees page globals and frameworks, bypasses CSP). Use `return …`, `await` allowed |

### Windows and tabs, extended
| Tool | What it does |
|---|---|
| `browser_work_window` | Assign the agent a "work window" so it does not disturb yours: `least_tabs` picks another window with the fewest tabs, `new` creates one, a number = windowId, `clear` resets. While set, new tabs open there and tools without tabId use that window's active tab |
| `browser_windows` | All windows with their tabs |
| `browser_window_new` / `browser_window_close` / `browser_window_focus` | New window (incl. incognito), close, focus/maximise |
| `browser_tab_update` | Pin, mute, change url, activate |
| `browser_tab_duplicate` | Duplicate a tab |
| `browser_find_tabs` | Find tabs by url/title regex |
| `browser_open_urls` / `browser_close_tabs` | Open a list of URLs; close many tabs by id or regex |
| `browser_zoom` | Tab zoom |

### History, bookmarks, downloads, cookies, sessions
| Tool | What it does |
|---|---|
| `browser_history_search` / `browser_history_delete_url` | Search history for N days; delete a URL from history |
| `browser_bookmarks_search` / `browser_bookmarks_tree` / `browser_bookmark_add` / `browser_bookmark_remove` | Bookmarks |
| `browser_download` / `browser_downloads_list` | Download a file through the browser (with its cookies) into Downloads; list downloads |
| `browser_cookies_get` / `browser_cookie_set` / `browser_cookie_remove` | Cookies by url or domain. Values are returned in clear: secrets |
| `browser_clear_data` | Clear cache, cookies, localStorage etc., optionally only for given sites |
| `browser_recent_closed` / `browser_restore_session` | Recently closed tabs and restoring them |
| `browser_session_save` / `browser_session_load` | Save all windows and tabs to a JSON file; reopen them later as new windows (pinned tabs restored) |

### For the user
| Tool | What it does |
|---|---|
| `browser_notify` | Desktop notification from the browser |
| `browser_speak` | Read text aloud with the built-in TTS |
| `browser_search` | Search with the default search engine |

### Page work, extended
| Tool | What it does |
|---|---|
| `browser_fill_form` | Fill many fields at once: inputs, selects, checkboxes, contenteditable; submit |
| `browser_extract` | Structured scraping: `{name: selector or {selector, attr, all, html}}` |
| `browser_storage` | Page localStorage / sessionStorage: get, set, remove, clear, keys |
| `browser_meta` | Metadata: canonical, favicon, OpenGraph, all meta, JSON-LD, headings |
| `browser_article` | Main article text without menus and footers |
| `browser_hover` | Hover to reveal menus and tooltips |
| `browser_press_key` | Key press on an element without the debugger |
| `browser_highlight` | Outline elements to check a selector |
| `browser_scroll_bottom` | Scroll an infinite feed to the end |
| `browser_element_screenshot` | Screenshot of one element |

### For students (e-learning)
| Tool | What it does |
|---|---|
| `browser_quiz_extract` | Scan a test/quiz page for questions and answer inputs (radio/checkbox groups with option labels, text answers, selects) |
| `browser_choose` | Pick a radio/checkbox answer by its visible label text |
| `browser_math_extract` | Extract formulas: MathML, LaTeX/TeX (MathJax/KaTeX), inline `$…$` / `\(…\)` |

### For testers / security (authorized use)
| Tool | What it does |
|---|---|
| `browser_fetch` | HTTP request from the page context (site cookies + origin): status, headers, body. Probe APIs, replay requests |
| `browser_iframes` | List iframes: src, origin, same-origin flag, sandbox |
| `browser_storage_dump` | Dump localStorage, sessionStorage, JS cookies and all URL cookies (with flags). Sensitive |
| `browser_security_scan` | Passive overview: CSP, HSTS/X-Frame-Options/etc, inline vs external scripts and origins, forms (CSRF token, https action), mixed content |
| `browser_accessibility_tree` | The page's AX tree (roles, names, values) — a compact semantic map |
| `browser_outline` | Fast summary aid: title, heading tree, ARIA landmarks, element counts |
| `browser_page_code` | The page's code: rendered HTML, inline scripts/styles, external script/style URLs |

### Extract everything from a page
| Tool | What it does |
|---|---|
| `browser_snapshot` | Download a whole page to a folder: page.html, text.txt, article.txt, meta.json, outline.json, links.json, media.json, screenshot.png (full page), inline code files + code.json, and every image into images/. The 'suck everything out' tool |
### Photos, video, audio on the page
| Tool | What it does |
|---|---|
| `browser_media_list` | Catalogue of all media: images at best resolution (srcset, picture, lazy attributes, backgrounds), `<video>` with sources, poster and duration, `<audio>`, embedded YouTube/VK/Rutube players, direct file links |
| `browser_image_view` | Fetch an image from inside the page (with its cookies, so private galleries work), downscale and show it to the agent as an image. A copy is saved to disk |
| `browser_media_download` | Download a list of files through the browser into `Downloads/yx-bridge/<site>/` |
| `browser_video_control` | Player control: play, pause, seek, mute, speed, volume, fullscreen, info |
| `browser_video_frames` | Frames from a video at given seconds, returned as images to the agent. Works with YouTube, VK, Rutube and any HTML5 player. In a background window it enables visibility emulation itself |
| `browser_keep_visible` | Make a background/occluded tab consider itself visible and focused: players, timers and lazy loading keep working without bringing the window to front |

"Look at the photos on this page" = `browser_media_list`, then `browser_image_view` for the URLs you want.
"Watch the video" = `browser_video_frames` (frames) plus `browser_get_page` or `browser_article` for description and captions.
YouTube-style video arrives as a stream (blob/MSE): it cannot be downloaded as a file, only frames. Verified 12 Sep 2026: YouTube frames captured (640×360 at 5 s and 20 s).
Placeholder players that create `<video>` only after a click (e.g. Wikimedia Commons) need `browser_click` on Play first. If a site blocks autoplay with sound, the tool mutes automatically.
Images are fetched from the extension's background worker, so CORS does not interfere and the user's cookies are attached. If a server requires Referer and returns 403, a fallback request runs from the page context.

### Emulation and network (via DevTools)
| Tool | What it does |
|---|---|
| `browser_set_viewport` | Emulate screen size and mobile device |
| `browser_set_user_agent` | Override User-Agent and language |
| `browser_geolocation` | Override geolocation |
| `browser_network_start` / `browser_network_log` / `browser_network_stop` | Record network requests: url, method, status, type, size |
| `browser_response_body` | Body of the latest response matching a URL regex, handy for JSON APIs |
| `browser_block_urls` | Block requests by patterns |
| `browser_dialogs` | Auto-answer alert/confirm/prompt |

### Yandex Browser auto-translation
Yandex translates pages directly in the DOM and keeps no original. Three levels of control:

| Tool | What it does |
|---|---|
| `browser_get_page original=true` | Without reload: re-fetches the HTML with the page's cookies and returns untranslated text (server-rendered content only) |
| `browser_translation` | `off` blocks auto-translation for all future loads (a content script marks pages notranslate at DOMContentLoaded, which Yandex honours); `on` restores; `status` |
| `browser_translate_menu` | **Windows.** Opens the "Translated" bubble in the browser toolbar and clicks like a human: `show_original`, `translate`, `translate_images`, `always_translate`, `never_offer` ("Never offer to translate from …", i.e. never translate that language), `never_this_site`, `change_language`, `status`. Changes real browser settings instantly, no restart |
| `browser_translate_settings_get` | Reads translation settings from the profile file: `alwaysTranslate`, `neverOfferFrom`, `neverTranslateSites`, `enabled` |
| `browser_translate_settings_set` | Edits the profile file directly (any languages and sites as lists). The browser is closed gracefully, the file edited, the browser relaunched; a backup is kept. Ask the user before running |

### The browser's own UI (Windows, UI Automation)
| Tool | What it does |
|---|---|
| `browser_ui_list` | List browser toolbar, bubble, menu and tab controls by regex over name/id/class |
| `browser_ui_click` | Click a browser UI control (Invoke/Toggle/Select, else a real mouse click at its centre) |
| `browser_ui_chain` | A sequence of steps in one call: `click:` `wait:` `list:` `set:` `mouse:x,y` `key:ESC` `sleep:ms` `shot:file.png` |
| `browser_launch` | Start the browser if closed |
| `browser_reload_extension` | Reload the extension after editing its code |

### Low level (Chrome DevTools Protocol)
| Tool | What it does |
|---|---|
| `browser_cdp` | Any CDP command: `DOM.*`, `Network.*`, `Emulation.*`, … |
| `browser_cdp_type` | Type with real input events (for editors that ignore value changes) |
| `browser_cdp_key` | Key press (Enter, Tab, Escape, arrows; modifiers 1=Alt 2=Ctrl 4=Meta 8=Shift) |
| `browser_cdp_click_xy` | Mouse click at coordinates |
| `browser_cdp_wheel` | Mouse wheel (triggers lazy loading) |
| `browser_cdp_detach` | Detach the debugger from a tab |


### More tools by persona (v0.8 — 254 total)
**Students (e-learning):** browser_quiz_extract, browser_quiz_answer_all, browser_quiz_submit/next/prev, browser_choose, browser_click_text, browser_flashcards, browser_essay_write, browser_word_count, browser_fill_blanks, browser_set_range, browser_drag_drop, browser_reorder, browser_code_get/code_set, browser_timer_read, browser_progress_read, browser_captions, browser_definitions, browser_math_extract, browser_required_fields, browser_form_validate, browser_answer_key_scan.

**Testers / security (authorized):** browser_tech_detect, browser_globals_list, browser_comments_extract, browser_hidden_inputs, browser_inline_handlers, browser_cookie_audit, browser_secrets_scan, browser_links_classify, browser_params, browser_perf, browser_third_party, browser_source_maps, browser_sri_audit, browser_iframe_audit/iframes, browser_cookie_consent, browser_hidden_elements, browser_console_errors, browser_websocket_frames, browser_headers_get, browser_robots, browser_sitemap, browser_security_txt, browser_broken_links, browser_redirect_chain, browser_cors_probe, browser_fetch, browser_storage_dump, browser_security_scan, browser_accessibility_tree, browser_validation_audit.

**General user (extract / summarize / read):** browser_emails, browser_phones, browser_dates, browser_prices, browser_extract_urls, browser_hashtags, browser_mentions, browser_numbers, browser_ip_addresses, browser_social_links, browser_contact_info, browser_summary_data, browser_toc, browser_outline, browser_schema_data (+product/recipe/event/job), browser_reviews, browser_lists_extract, browser_quotes, browser_code_blocks, browser_citations, browser_breadcrumbs, browser_pagination, browser_rss_find, browser_author, browser_publish_date, browser_main_image, browser_image_alts, browser_faq, browser_paragraphs, browser_headings, browser_word_freq, browser_reading_time, browser_lang_detect, browser_reader_view, browser_to_markdown, browser_entities, browser_login_detect, browser_newsletter_detect, browser_search_on_page, browser_detect_paywall, browser_remove_clutter, browser_focus_mode, browser_dark_mode, browser_font_size, browser_save_text/save_html/save_markdown, browser_tables_to_csv, browser_download_pdfs, browser_download_images, browser_favicon_save, browser_read_aloud, browser_compare_pages, browser_page_code, browser_snapshot.

**Utility:** browser_get_selection, browser_scroll_to_text, browser_mark_text/unmark, browser_table_search, browser_fonts_used, browser_colors_used, browser_meta_audit, browser_lazy_images, browser_external/internal/pdf/doc/video/audio_links, browser_price_stats, browser_text_stats, browser_json_scan, browser_element_info/element_text/get_value/get_attribute/get_styles/is_visible/count_selector/attr_values, browser_submit_form/reset_form/check_all/focus_element, browser_duplicate_content, browser_wait_gone, browser_clipboard_write/clipboard_read.


### Security & control
- **Password on the port:** by default any local process could connect to the port; set a password so only the genuine extension may. `browser_password action=set` generates one, stores it in the extension and a server-side `.token` file, and requires it on every reconnect. The agent can do this itself; it should save the password to its memory, tell you the password, and how to change it (`action=change`, or edit `server/.token` + the extension). `action=off` removes it. You can also set/change/remove the password directly in the **extension popup** (the "Пароль подключения" section) — the new password syncs to the server over the live connection.
- **Pause switch (in the extension):** the `ИИ-агент` toggle in the popup stops all agent commands — read, write and execute — **without** dropping the connection. Only you can turn it back on from the popup; the agent cannot un-pause itself.
### Browsing statistics
The extension records how long you spend on each site (active-tab time per domain, per day) into local storage, independently of the agent.
- **From the browser:** click the light-bulb icon → **Browser statistics** to open a page with totals, a bar chart with a Day / Week / Month / Year switch (Day is hourly and shows from what hour to what hour you were active), top sites, your time zone, and JSON/CSV export and import. Works even when the agent is off.
- **From the agent:** `browser_stats` returns totals, per-domain minutes/visits, today's breakdown, 60-day history and the time zone the data was collected in; `browser_stats_export` / `browser_stats_import` move it between devices; `browser_stats_reset` clears it.
## 4. Limitations and notes
- Internal pages (`browser://`, `chrome://`, the extension store) are not accessible.
- Debugger-based tools (`browser_eval`, all `browser_cdp_*`, `screenshot fullPage`, `console_logs`) show a yellow "is debugging this tab" bar. `browser_cdp_detach` removes it. Other tools work without it.
- JS runs only in the page context: the extension's isolated world forbids `eval` (Manifest V3).
- The server listens only on `127.0.0.1:17555`. By default there is no password, so any **local** program that connects to the port gets control of the browser. Set one with `browser_password` (the agent can do it itself and will tell you the password) or from the extension popup; then only this extension can connect. The popup's **pause switch** blocks every command from the agent until you switch it back. Change the port with `BROWSER_BRIDGE_PORT` (server) and the `WS_URL` constant in `extension/background.js`.
- Yandex Browser auto-translates pages: text from foreign sites may arrive in Russian. See "Auto-translation".
- `browser_ui_*` and `browser_translate_menu` are Windows-only and need the browser window on screen (not minimised). They move the real cursor for a fraction of a second.
- Discarded (sleeping) tabs come with `status: "unloaded"`; call `browser_activate_tab` first.
- Screenshots are saved to the system temp folder (`yx-bridge-shots`); change with `BROWSER_SHOT_DIR`.
- Only one agent can hold port 17555 at a time; the extension talks to whichever server started first.

## 5. Testing and debugging
```
cd server
node src/selftest.js          # offline: bridge + tool list
node test-auth.mjs            # offline: connection/password rules of the bridge (rogue clients, wrong password, spoofed replies)
node test-all.mjs             # live: every tool, in a new MINIMIZED window, never focuses it (safe while you work)
node test-live.mjs            # live run of DOM tools on example.com — activates a tab and FOCUSES the work window
node test-translate.mjs       # live: translation control, PDF, find_text, tables
node test-extras.mjs          # live: the 0.4.0 batch (history, bookmarks, downloads, network log, …)
node test-media.mjs           # live: images and YouTube frames
node test-session.mjs         # live: session save/load through the real MCP server
node src/cli.js list_tabs     # single command to the bridge
node src/cli.js get_page @args.json   # arguments from a file (Windows PowerShell mangles quotes in JSON)
```
Tests pick a spare window first (`work_window least_tabs`). After editing `extension/background.js` call
`browser_reload_extension` or click Reload on the extension card. Worker errors: extensions page → YX Bridge card → "Service worker" / "Errors".

## 6. Layout
```
extension/          Manifest V3 extension
  manifest.json
  background.js     WebSocket client + all commands
  notranslate.js    content script registered by browser_translation off
  popup.html/.js    status popup
  icon.png
server/
  src/server.js     MCP server (stdio) — tool list
  src/bridge.js     WebSocket bridge to the extension
  src/profile.js    browser profile file (translation settings), browser stop/start
  src/ui.js         UI Automation wrapper, translate-bubble logic
  src/uia.ps1       PowerShell: find/click/chain over the browser UI (saved with BOM — required)
  src/cli.js        manual calls
  src/selftest.js   offline test
  test-*.mjs        live tests
install.cmd → Install-YXBridge.ps1     automatic installation (Windows)
uninstall.cmd → Uninstall-YXBridge.ps1 automatic removal (Windows)
install.ps1 / install.sh                    server + registration only
build-zip.ps1                               build the distribution archive
AGENT-INSTALL.md                            instructions for an AI agent installing the package
LICENSE, NOTICE                             Apache 2.0, attribution
```

## 7. License
Copyright 2026 MRsuperkosmos. Created 12 September 2026.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this project except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 or in the `LICENSE` file. Attribution notices are in the `NOTICE` file.

In short: you may use, modify, distribute and embed this software in your own projects, including commercial and closed-source ones, provided that you keep the copyright and attribution notices, include the `NOTICE` file, and mark the files you have changed. The name "MRsuperkosmos" may not be used to endorse or promote derived products without prior written permission.

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

This tool drives your own browser and is subject to the terms of the websites you open.

---
---

# YX Bridge — Яндекс Браузер / Chromium ⇄ ИИ-агенты (MCP)

Расширение для браузера + локальный MCP-сервер. Даёт Claude Code (или любому агенту с поддержкой MCP)
доступ к открытым вкладкам: читать страницы, менять их код (DOM), кликать и печатать, выполнять JavaScript,
делать скриншоты, слать сырые команды DevTools Protocol, управлять автопереводом Яндекс Браузера,
нажимать кнопки в интерфейсе самого браузера. Работает в Яндекс Браузере и любом Chromium-браузере
(Chrome, Edge, Brave, Opera, Vivaldi).

```
Агент ──stdio──> server/src/server.js ──ws://127.0.0.1:17555──> extension/background.js ──> вкладки
                       └── файл профиля браузера, запуск/закрытие браузера, UI Automation (Windows)
```

Никаких аккаунтов и внешних серверов. Всё общение только внутри вашего компьютера. Необязательный локальный пароль закрывает порт для всех, кроме вашего расширения.

## 1. Установка

### Что нужно
- Node.js 18+ (https://nodejs.org, LTS) — установщик для Windows поставит сам, если нет
- Claude Code (CLI) или другой агент с поддержкой MCP
- Яндекс Браузер или другой Chromium-браузер

### Быстрый способ: один запуск (Windows)
1. Распакуйте архив в постоянную папку, например `C:\tools\yx-bridge`.
2. Двойной клик по **`install.cmd`**.

Установщик сам: поставит Node.js через winget, если его нет; установит зависимости сервера;
пропишет MCP-сервер в Claude Code; откроет в браузере **новое окно** со страницей расширений,
включит режим разработчика, нажмёт «Загрузить распакованное расширение», введёт путь и подтвердит;
закроет служебное окно; проверит связь. Ваши открытые вкладки не трогаются.
Работает с Яндекс Браузером, Chrome и Edge (`install.cmd -Browser chrome`).

Удаление: двойной клик по **`uninstall.cmd`** снимает регистрацию в Claude Code и удаляет
расширение из браузера (карточка → «Удалить» → подтверждение), тоже автоматически.
Папку проекта после этого можно просто удалить.

Ключи: `-NoBrowser` (только сервер и регистрация), `-NoNode` (не ставить Node.js).
Для macOS/Linux есть `install.sh`, но расширение там загружается вручную (см. ниже).

### Установка руками ИИ-агента
Отдайте архив любому агенту и скажите: «установи по AGENT-INSTALL.md». Файл `AGENT-INSTALL.md`
написан для агента: он запускает установщик, находит свой конфиг (Claude Code, Cursor, OpenCode, Codex,
Gemini CLI, Windsurf, Cline, Claude Desktop, VS Code Copilot, Zed) и прописывает сервер сам.

### Ручной способ
1. **Распаковать** в постоянную папку (`C:\tools\yx-bridge` или `~/yx-bridge`). Потом не перемещать:
   путь прописывается в конфиг агента и в браузер.
2. **Сервер + регистрация:** Windows: правой кнопкой по `install.ps1` → «Выполнить с помощью PowerShell»
   (или `powershell -ExecutionPolicy Bypass -File install.ps1`); macOS/Linux: `bash install.sh`.
   Вручную это то же самое, что:
   ```
   cd server
   npm install
   claude mcp add yx-bridge -s user -- node "<полный путь>/server/src/server.js"
   ```
   Самопроверка должна напечатать `mcp tools: 254 ...`.
3. **Загрузить расширение:** в адресной строке набрать `chrome://extensions` (в Яндекс Браузере именно так;
   `browser://extensions` открывает каталог Яндекса), включить **«Режим разработчика»** (справа вверху),
   нажать **«Загрузить распакованное расширение»**, выбрать папку **`extension`**. Появится карточка
   «YX Bridge» и оранжевая иконка-лампочка на панели. Кружок в её углу показывает состояние: зелёный — связь
   с сервером есть, красный — сервер ещё не запущен (запускается вместе с агентом), жёлтый — вы поставили агента на паузу.
4. **Перезапустить агента.** Появятся инструменты `browser_*`. Проверка: «покажи список открытых вкладок».

## 2. Использование

Просто говорите агенту, что нужно:
- «Прочитай открытую вкладку и перескажи»
- «Найди на странице все ссылки на PDF»
- «Убери с этой страницы баннер cookies и рекламу»
- «Заполни форму: имя Иван, email …, нажми отправить»
- «Сделай скриншот всей страницы»
- «Выполни на странице `return window.__APP_STATE__`»
- «Вытащи таблицу с этой страницы в CSV»
- «Открой 3 вкладки с этими ссылками и собери заголовки»
- «Посмотри фотки на этой странице» / «Посмотри видео и расскажи, что там»

Во всех инструментах `tabId` необязателен: без него берётся активная вкладка. Id даёт `browser_list_tabs`.

Если вы работаете в браузере параллельно с агентом, попросите его «работать во втором окне»: он вызовет
`browser_work_window least_tabs`, и все его вкладки будут открываться в отдельном окне, не выдёргивая фокус.

Интерфейс расширения (попап и страница статистики) по умолчанию **на английском**, с переключателем **EN/RU** в углу, выбор запоминается.

**Иконка расширения:** клик по лампочке — статус соединения, число выполненных команд, вкладки с подключённым
отладчиком, кнопка «Переподключить», **переключатель паузы** (останавливает всю передачу данных агенту, пока вы
его не вернёте) и **пароль подключения** (показан точками, есть показать/копировать, сменить или снять).

## 3. Функции (254 инструмента)

### Вкладки
| Инструмент | Что делает |
|---|---|
| `browser_status` | Подключено ли расширение, версия, к каким вкладкам прицеплен отладчик |
| `browser_list_tabs` | Все вкладки: id, окно, url, заголовок, активная ли |
| `browser_active_tab` | Текущая вкладка |
| `browser_open_tab` | Открыть новую вкладку (в рабочем окне, если задано) |
| `browser_close_tab` | Закрыть вкладку |
| `browser_activate_tab` | Сделать вкладку активной; `focusWindow=false` не выдёргивает ваше окно |
| `browser_navigate` | Перейти по url и дождаться загрузки |
| `browser_reload` | Перезагрузить (опция: без кэша) |
| `browser_back` | Назад по истории |

### Чтение
| Инструмент | Что делает |
|---|---|
| `browser_get_page` | url, заголовок и весь видимый текст; `original=true` — непереведённый HTML заново |
| `browser_get_html` | HTML документа или элемента по CSS-селектору |
| `browser_query` | Поиск элементов по селектору: тег, id, класс, текст, href/src/value, координаты, видимость, атрибуты |
| `browser_find_text` | Поиск подстроки в тексте страницы, счётчик и фрагменты с контекстом |
| `browser_links` | Все уникальные ссылки с текстом |
| `browser_forms` | Формы и их поля (пароли скрыты) |
| `browser_tables` | HTML-таблицы как массивы строк, заголовки из `<thead>` |
| `browser_wait_for` | Ждать появления селектора и/или текста |
| `browser_screenshot` | Скриншот вкладки; `fullPage=true` — вся страница. Сохраняет файл и показывает картинку |
| `browser_pdf` | Сохранить страницу в PDF |
| `browser_console_logs` | console.log/warn/error и необработанные ошибки страницы |

### Изменение страницы
| Инструмент | Что делает |
|---|---|
| `browser_click` | Клик по N-му элементу селектора |
| `browser_type` | Ввод текста в input/textarea/contenteditable; `clear`, `submit` |
| `browser_select` | Выбор пункта в `<select>` по значению или тексту |
| `browser_set_html` | Заменить HTML элемента (`inner`/`outer`), дописать (`append`/`prepend`) или сменить текст |
| `browser_set_attr` | Поставить или удалить атрибут |
| `browser_set_style` | Инлайн-стили |
| `browser_remove` | Удалить элементы (баннеры, попапы) |
| `browser_inject_css` | Добавить свой CSS |
| `browser_scroll` | Прокрутка окна или к элементу |

### JavaScript
| Инструмент | Что делает |
|---|---|
| `browser_eval` | Выполнить JS в контексте страницы (видит её глобалы и фреймворки, обходит CSP). Пишите `return …`, можно `await` |

### Окна и вкладки, расширенно
| Инструмент | Что делает |
|---|---|
| `browser_work_window` | Назначить агенту «рабочее окно», чтобы не мешать вашему: `least_tabs` берёт другое окно с наименьшим числом вкладок, `new` создаёт новое, число = windowId, `clear` сбрасывает. Пока задано, новые вкладки открываются там, а инструменты без tabId работают с активной вкладкой этого окна |
| `browser_windows` | Все окна с вкладками |
| `browser_window_new` / `browser_window_close` / `browser_window_focus` | Новое окно (в т.ч. инкогнито), закрыть, сфокусировать или развернуть |
| `browser_tab_update` | Закрепить, заглушить звук, сменить url, активировать |
| `browser_tab_duplicate` | Дублировать вкладку |
| `browser_find_tabs` | Найти вкладки по regex url/заголовка |
| `browser_open_urls` / `browser_close_tabs` | Открыть список ссылок; закрыть пачку по id или regex |
| `browser_zoom` | Масштаб вкладки |

### История, закладки, загрузки, куки, сессии
| Инструмент | Что делает |
|---|---|
| `browser_history_search` / `browser_history_delete_url` | Поиск по истории за N дней; удалить адрес из истории |
| `browser_bookmarks_search` / `browser_bookmarks_tree` / `browser_bookmark_add` / `browser_bookmark_remove` | Закладки |
| `browser_download` / `browser_downloads_list` | Скачать файл силами браузера (с его куками) в папку Загрузки; список загрузок |
| `browser_cookies_get` / `browser_cookie_set` / `browser_cookie_remove` | Куки по url или домену. Значения открытые, это секреты |
| `browser_clear_data` | Очистить кэш, куки, localStorage и т.д., можно только для указанных сайтов |
| `browser_recent_closed` / `browser_restore_session` | Недавно закрытые вкладки и их восстановление |
| `browser_session_save` / `browser_session_load` | Сохранить все окна и вкладки в JSON-файл; открыть их снова новыми окнами (закреплённые восстанавливаются) |

### Для пользователя
| Инструмент | Что делает |
|---|---|
| `browser_notify` | Системное уведомление из браузера |
| `browser_speak` | Озвучить текст встроенным синтезатором речи |
| `browser_search` | Поиск в поисковике браузера по умолчанию |

### Работа со страницей, расширенно
| Инструмент | Что делает |
|---|---|
| `browser_fill_form` | Заполнить несколько полей разом: inputs, select, чекбоксы, contenteditable, и отправить |
| `browser_extract` | Структурный парсинг: `{имя: селектор или {selector, attr, all, html}}` |
| `browser_storage` | localStorage / sessionStorage страницы: get, set, remove, clear, keys |
| `browser_meta` | Метаданные: canonical, favicon, OpenGraph, все meta, JSON-LD, заголовки |
| `browser_article` | Основной текст статьи без меню и футеров |
| `browser_hover` | Наведение курсора для выпадающих меню и подсказок |
| `browser_press_key` | Нажатие клавиши на элементе без отладчика |
| `browser_highlight` | Обвести элементы рамкой для проверки селектора |
| `browser_scroll_bottom` | Докрутить бесконечную ленту до конца |
| `browser_element_screenshot` | Скриншот одного элемента |

### Для учеников (электронные задания)
| Инструмент | Что делает |
|---|---|
| `browser_quiz_extract` | Разобрать тест: вопросы и поля ответов (группы radio/checkbox с подписями вариантов, текстовые поля, select) |
| `browser_choose` | Выбрать вариант radio/checkbox по видимому тексту подписи |
| `browser_math_extract` | Извлечь формулы: MathML, LaTeX/TeX (MathJax/KaTeX), встроенные `$…$` / `\(…\)` |

### Для тестировщиков и безопасности (с разрешения)
| Инструмент | Что делает |
|---|---|
| `browser_fetch` | HTTP-запрос из контекста страницы (её куки и origin): статус, заголовки, тело. Проверка API, повтор запросов |
| `browser_iframes` | Список iframe: src, origin, свой ли origin, sandbox |
| `browser_storage_dump` | Дамп localStorage, sessionStorage, JS-куки и все куки URL (с флагами). Чувствительно |
| `browser_security_scan` | Пассивный обзор: CSP, HSTS/X-Frame-Options и др., встроенные и внешние скрипты и их origin, формы (CSRF-токен, https-действие), смешанный контент |
| `browser_accessibility_tree` | Дерево доступности страницы (роли, имена, значения) — компактная семантическая карта |
| `browser_outline` | Быстрый обзор для пересказа: заголовок, дерево заголовков, ARIA-ориентиры, счётчики элементов |
| `browser_page_code` | Код страницы: отрисованный HTML, встроенные скрипты и стили, ссылки на внешние |

### Выкачать со страницы всё
| Инструмент | Что делает |
|---|---|
| `browser_snapshot` | Скачать страницу целиком в папку: page.html, text.txt, article.txt, meta.json, outline.json, links.json, media.json, screenshot.png (вся страница), файлы встроенного кода + code.json, и все картинки в images/. Инструмент «выжать всё» |
### Фото, видео, аудио на странице
| Инструмент | Что делает |
|---|---|
| `browser_media_list` | Каталог всех медиа: картинки в лучшем разрешении (srcset, picture, lazy-атрибуты, фоновые), `<video>` с источниками, постером и длительностью, `<audio>`, встроенные плееры YouTube/VK/Rutube, прямые ссылки на файлы |
| `browser_image_view` | Скачать картинку изнутри страницы (с её куками, работают закрытые галереи), уменьшить и показать агенту как изображение. Копия сохраняется на диск |
| `browser_media_download` | Скачать список файлов силами браузера в `Загрузки/yx-bridge/<сайт>/` |
| `browser_video_control` | Управление плеером: play, pause, seek, mute, скорость, громкость, полный экран, info |
| `browser_video_frames` | Кадры из видео в заданные секунды как изображения для агента. Работает с YouTube, VK, Rutube и любым HTML5-плеером. В фоновом окне сам включает эмуляцию видимости |
| `browser_keep_visible` | Заставить фоновую или перекрытую вкладку считать себя видимой и в фокусе: плееры, таймеры и ленивая подгрузка не замирают, окно на передний план не выдёргивается |

«Посмотри фотки на этой странице» = `browser_media_list`, затем `browser_image_view` по нужным URL.
«Посмотри видео» = `browser_video_frames` (кадры) плюс `browser_get_page` или `browser_article` для описания и субтитров.
Видео с YouTube и подобных приходит потоком (blob/MSE), файлом его не скачать, только кадры. Проверено 12.09.2026: кадры с YouTube снимаются (640×360, 5-я и 20-я секунда).
Плееры-заглушки, которые создают `<video>` только после клика (например, Wikimedia Commons), нужно сначала запустить `browser_click` по кнопке Play. Если сайт блокирует автозапуск со звуком, инструмент сам включает mute.
Картинки качаются из фонового воркера расширения, поэтому CORS не мешает; куки пользователя прикладываются. Если сервер требует Referer и отвечает 403, идёт запасной запрос из контекста страницы.

### Эмуляция и сеть (через DevTools)
| Инструмент | Что делает |
|---|---|
| `browser_set_viewport` | Эмуляция размера экрана и мобильного устройства |
| `browser_set_user_agent` | Подмена User-Agent и языка |
| `browser_geolocation` | Подмена геолокации |
| `browser_network_start` / `browser_network_log` / `browser_network_stop` | Запись сетевых запросов: url, метод, статус, тип, размер |
| `browser_response_body` | Тело последнего ответа по regex адреса, удобно для JSON API |
| `browser_block_urls` | Блокировка запросов по шаблонам |
| `browser_dialogs` | Автоответ на alert/confirm/prompt |

### Автоперевод Яндекс Браузера
Яндекс переводит страницы прямо в DOM и оригинал не хранит. Три уровня управления:

| Инструмент | Что делает |
|---|---|
| `browser_get_page original=true` | Без перезагрузки: повторно запрашивает HTML с куками страницы и отдаёт непереведённый текст (только серверный рендер) |
| `browser_translation` | `off` блокирует автоперевод для всех будущих загрузок (content script ставит пометку notranslate на DOMContentLoaded, Яндекс её уважает); `on` возвращает; `status` |
| `browser_translate_menu` | **Windows.** Открывает пузырь «Переведено» в панели браузера и нажимает как человек: `show_original`, `translate`, `translate_images`, `always_translate`, `never_offer` («Не предлагать перевод с …», то есть «никогда не переводить язык»), `never_this_site`, `change_language`, `status`. Меняет настоящие настройки браузера мгновенно, без перезапуска |
| `browser_translate_settings_get` | Читает настройки перевода из файла профиля: `alwaysTranslate`, `neverOfferFrom`, `neverTranslateSites`, `enabled` |
| `browser_translate_settings_set` | Правит файл профиля напрямую (любые языки и сайты списком). Браузер закрывается штатно, файл правится, браузер запускается снова, резервная копия рядом. Спрашивайте пользователя перед запуском |

### Интерфейс самого браузера (Windows, UI Automation)
| Инструмент | Что делает |
|---|---|
| `browser_ui_list` | Список элементов панели браузера, пузырей, меню, вкладок по regex имени/id/класса |
| `browser_ui_click` | Клик по элементу интерфейса браузера (Invoke/Toggle/Select, иначе мышью по центру) |
| `browser_ui_chain` | Цепочка шагов за один вызов: `click:` `wait:` `list:` `set:` `mouse:x,y` `key:ESC` `sleep:ms` `shot:file.png` |
| `browser_launch` | Запустить браузер, если закрыт |
| `browser_reload_extension` | Перезагрузить расширение после правок его кода |

### Низкий уровень (Chrome DevTools Protocol)
| Инструмент | Что делает |
|---|---|
| `browser_cdp` | Любая команда CDP: `DOM.*`, `Network.*`, `Emulation.*`, … |
| `browser_cdp_type` | Ввод текста настоящими событиями (для редакторов, игнорирующих value) |
| `browser_cdp_key` | Нажатие клавиши (Enter, Tab, Escape, стрелки; модификаторы 1=Alt 2=Ctrl 4=Meta 8=Shift) |
| `browser_cdp_click_xy` | Клик мышью по координатам |
| `browser_cdp_wheel` | Колесо мыши (запускает ленивую подгрузку лент) |
| `browser_cdp_detach` | Отцепить отладчик от вкладки |


### Ещё инструменты по типам пользователей (v0.8 — всего 254)
**Школьники (электронные задания):** browser_quiz_extract, browser_quiz_answer_all, browser_quiz_submit/next/prev, browser_choose, browser_click_text, browser_flashcards, browser_essay_write, browser_word_count, browser_fill_blanks, browser_set_range, browser_drag_drop, browser_reorder, browser_code_get/code_set, browser_timer_read, browser_progress_read, browser_captions, browser_definitions, browser_math_extract, browser_required_fields, browser_form_validate, browser_answer_key_scan.

**Тестировщики / безопасность (с разрешения):** browser_tech_detect, browser_globals_list, browser_comments_extract, browser_hidden_inputs, browser_inline_handlers, browser_cookie_audit, browser_secrets_scan, browser_links_classify, browser_params, browser_perf, browser_third_party, browser_source_maps, browser_sri_audit, browser_iframe_audit/iframes, browser_cookie_consent, browser_hidden_elements, browser_console_errors, browser_websocket_frames, browser_headers_get, browser_robots, browser_sitemap, browser_security_txt, browser_broken_links, browser_redirect_chain, browser_cors_probe, browser_fetch, browser_storage_dump, browser_security_scan, browser_accessibility_tree, browser_validation_audit.

**Обычный пользователь (извлечь / пересказать / читать):** browser_emails, browser_phones, browser_dates, browser_prices, browser_extract_urls, browser_hashtags, browser_mentions, browser_numbers, browser_ip_addresses, browser_social_links, browser_contact_info, browser_summary_data, browser_toc, browser_outline, browser_schema_data (+product/recipe/event/job), browser_reviews, browser_lists_extract, browser_quotes, browser_code_blocks, browser_citations, browser_breadcrumbs, browser_pagination, browser_rss_find, browser_author, browser_publish_date, browser_main_image, browser_image_alts, browser_faq, browser_paragraphs, browser_headings, browser_word_freq, browser_reading_time, browser_lang_detect, browser_reader_view, browser_to_markdown, browser_entities, browser_login_detect, browser_newsletter_detect, browser_search_on_page, browser_detect_paywall, browser_remove_clutter, browser_focus_mode, browser_dark_mode, browser_font_size, browser_save_text/save_html/save_markdown, browser_tables_to_csv, browser_download_pdfs, browser_download_images, browser_favicon_save, browser_read_aloud, browser_compare_pages, browser_page_code, browser_snapshot.

**Утилиты:** browser_get_selection, browser_scroll_to_text, browser_mark_text/unmark, browser_table_search, browser_fonts_used, browser_colors_used, browser_meta_audit, browser_lazy_images, browser_external/internal/pdf/doc/video/audio_links, browser_price_stats, browser_text_stats, browser_json_scan, browser_element_info/element_text/get_value/get_attribute/get_styles/is_visible/count_selector/attr_values, browser_submit_form/reset_form/check_all/focus_element, browser_duplicate_content, browser_wait_gone, browser_clipboard_write/clipboard_read.


### Безопасность и управление
- **Пароль на порт:** по умолчанию к порту может подключиться любая локальная программа; поставьте пароль, чтобы подключалось только настоящее расширение. `browser_password action=set` генерирует пароль, кладёт его в расширение и в серверный файл `.token` и требует при каждом переподключении. Агент может сделать это сам; он сохранит пароль себе в память, сообщит его вам и как менять (`action=change` или правка `server/.token` и расширения). `action=off` убирает пароль. Пароль можно поставить, сменить или снять и прямо в **попапе расширения** (раздел «Пароль подключения») — новый пароль синхронизируется с сервером по текущему соединению.
- **Кнопка паузы (в расширении):** переключатель `ИИ-агент` в попапе останавливает все команды агента — чтение, запись и исполнение — **не разрывая** соединение. Включить обратно можете только вы из попапа; агент сам себя разблокировать не может.
### Статистика браузера
Расширение само считает, сколько времени вы проводите на каждом сайте (время активной вкладки по доменам, по дням) и хранит это локально, независимо от агента.
- **Из браузера:** клик по иконке-лампочке → **Статистика браузера** открывает страницу с итогами, графиком с переключателем День / Неделя / Месяц / Год (День — по часам, видно, с какого по какой час вы сидели), топом сайтов, вашим часовым поясом и экспортом/импортом в JSON и CSV. Работает, даже когда агент выключен.
- **Из агента:** `browser_stats` отдаёт итоги, минуты и визиты по доменам, разбивку за сегодня, историю за 60 дней и часовой пояс, в котором собраны данные; `browser_stats_export` / `browser_stats_import` переносят её между устройствами; `browser_stats_reset` очищает.
## 4. Ограничения и особенности
- Внутренние страницы (`browser://`, `chrome://`, магазин расширений) недоступны.
- Инструменты через отладчик (`browser_eval`, все `browser_cdp_*`, `screenshot fullPage`, `console_logs`) показывают жёлтую полосу «Расширение начало отладку». Убирается `browser_cdp_detach`. Остальные работают без неё.
- JS выполняется только в контексте страницы: изолированный мир расширения запрещает `eval` (Manifest V3).
- Сервер слушает только `127.0.0.1:17555`. По умолчанию пароля нет, поэтому любая **локальная** программа, подключившись к порту, получит управление браузером. Поставьте пароль инструментом `browser_password` (агент сделает это сам и сообщит вам пароль) или из поп-апа расширения, тогда подключится только это расширение. **Переключатель паузы** в поп-апе блокирует все команды агента, пока вы его не вернёте. Порт меняется переменной `BROWSER_BRIDGE_PORT` (сервер) и константой `WS_URL` в `extension/background.js`.
- Яндекс Браузер автоматически переводит страницы: текст с иностранных сайтов может прийти по-русски. См. «Автоперевод».
- `browser_ui_*` и `browser_translate_menu` работают только на Windows и требуют, чтобы окно браузера было видно на экране (не свёрнуто). Они двигают настоящий курсор на долю секунды.
- Выгруженные (спящие) вкладки приходят со `status: "unloaded"`; сначала `browser_activate_tab`.
- Скриншоты сохраняются во временную папку системы (`yx-bridge-shots`), путь меняется `BROWSER_SHOT_DIR`.
- Порт 17555 занимает один агент за раз; расширение работает с тем сервером, который стартовал первым.

## 5. Проверка и отладка
```
cd server
node src/selftest.js          # офлайн: мост + список инструментов
node test-auth.mjs            # оффлайн: правила подключения и пароля моста (чужие клиенты, неверный пароль, подделка ответов)
node test-all.mjs             # живой: все инструменты в новом СВЁРНУТОМ окне, фокус не трогает (безопасно во время работы)
node test-live.mjs            # живой прогон DOM-инструментов на example.com — активирует вкладку и ПЕРЕВОДИТ ФОКУС на рабочее окно
node test-translate.mjs       # живой: управление переводом, PDF, поиск текста, таблицы
node test-extras.mjs          # живой: партия 0.4.0 (история, закладки, загрузки, сетевой лог, …)
node test-media.mjs           # живой: картинки и кадры с YouTube
node test-session.mjs         # живой: сохранение/восстановление сессии через настоящий MCP-сервер
node src/cli.js list_tabs     # одиночная команда мосту
node src/cli.js get_page @args.json   # аргументы из файла (Windows PowerShell ломает кавычки в JSON)
```
Тесты сначала выбирают свободное окно (`work_window least_tabs`). После правок `extension/background.js`
вызовите `browser_reload_extension` или нажмите «Обновить» на карточке. Ошибки воркера: страница
расширений → карточка YX Bridge → «Service worker» / «Ошибки».

## 6. Структура
```
extension/          расширение Manifest V3
  manifest.json
  background.js     WebSocket-клиент + все команды
  notranslate.js    content script, регистрируется при browser_translation off
  popup.html/.js    попап статуса
  icon.png
server/
  src/server.js     MCP-сервер (stdio) — список инструментов
  src/bridge.js     WebSocket-мост к расширению
  src/profile.js    файл профиля браузера (настройки перевода), закрытие/запуск браузера
  src/ui.js         обёртка над UI Automation, логика пузыря перевода
  src/uia.ps1       PowerShell: поиск/клик/цепочки по интерфейсу браузера (сохранён с BOM — обязательно)
  src/cli.js        ручные вызовы
  src/selftest.js   офлайн-тест
  test-*.mjs        живые тесты
install.cmd → Install-YXBridge.ps1     автоматическая установка (Windows)
uninstall.cmd → Uninstall-YXBridge.ps1 автоматическое удаление (Windows)
install.ps1 / install.sh                    только сервер + регистрация
build-zip.ps1                               сборка архива для передачи
AGENT-INSTALL.md                            инструкция для ИИ-агента, устанавливающего пакет
LICENSE, NOTICE                             Apache 2.0, авторство
```

## 7. Лицензия
Copyright 2026 MRsuperkosmos. Создано 12 сентября 2026.

Распространяется под лицензией Apache License 2.0, полный текст в файле `LICENSE` (английский оригинал и справочный русский перевод), уведомление об авторстве в `NOTICE`.

Коротко: можно свободно использовать, менять, распространять и встраивать в свои проекты, включая коммерческие и закрытые, при условии сохранения уведомлений об авторстве, включения файла `NOTICE` и пометки изменённых файлов. Имя «MRsuperkosmos» нельзя использовать для одобрения или продвижения производных продуктов без письменного разрешения.

Программное обеспечение предоставляется «как есть», без каких-либо гарантий. Точные формулировки прав и ограничений — в Лицензии.

Инструмент управляет вашим собственным браузером и подчиняется правилам сайтов, которые вы открываете.
