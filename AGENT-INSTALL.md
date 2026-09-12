> This document is provided in two languages: **English** first, then **Русский** (same content).
> Этот документ приведён на двух языках: сначала **английский**, затем **русский** (то же содержание).

---

# YX Bridge — instructions for an AI agent installing this package

You are an AI coding agent (Claude Code, Cursor, OpenCode, Codex, Gemini CLI, Cline, Windsurf, or similar)
and the user has handed you this archive. Install it end to end without asking the user to click anything,
unless a step below says otherwise. Report each step's outcome.

## 0. Requirements
- Windows for the fully automatic path (the browser extension is loaded via UI Automation).
  macOS/Linux: server and registration are automatic, the extension needs one manual step (section 5).
- Node.js 18+ (the Windows installer installs it via winget if missing).
- A Chromium browser: Yandex Browser, Google Chrome or Microsoft Edge, running under the current user.

## 1. Unpack to a permanent folder
Extract the archive to a folder that will not move, e.g. `C:\tools\yx-bridge` or `~/yx-bridge`.
Do NOT leave it in a temp/downloads folder: the extension and the MCP registration point to this path.
Below, `<ROOT>` is that folder.

## 2. Run the installer (Windows)
```
set CLAUDE_BRIDGE_NOPAUSE=1
powershell -NoProfile -ExecutionPolicy Bypass -File "<ROOT>\Install-YXBridge.ps1"
```
Options: `-Browser yandex|chrome|edge` (default auto), `-NoBrowser` (skip extension), `-NoNode`.
The installer: installs Node if needed → `npm install` in `<ROOT>\server` → registers the MCP server in
Claude Code (`~/.claude.json`, key `yx-bridge`) → opens a NEW browser window on chrome://extensions,
enables Developer mode, clicks "Load unpacked", enters `<ROOT>\extension`, confirms, closes that window →
pings the extension. It prints a report; treat lines starting with `FAIL` as errors.

macOS/Linux: `bash "<ROOT>/install.sh"` (server + Claude Code registration only).

## 3. Register the MCP server in YOUR agent (skip if you are Claude Code)
The server is a stdio MCP server. Command: `node "<ROOT>/server/src/server.js"`.
Use forward slashes or escaped backslashes inside JSON. Pick your config:

**Cursor** — `~/.cursor/mcp.json` (or `<project>/.cursor/mcp.json`):
```json
{ "mcpServers": { "yx-bridge": { "command": "node", "args": ["<ROOT>/server/src/server.js"] } } }
```
**OpenCode** — `~/.config/opencode/opencode.json` (or `<project>/opencode.json`):
```json
{ "$schema": "https://opencode.ai/config.json",
  "mcp": { "yx-bridge": { "type": "local", "command": ["node", "<ROOT>/server/src/server.js"], "enabled": true } } }
```
**Codex CLI** — `~/.codex/config.toml`:
```toml
[mcp_servers.yx-bridge]
command = "node"
args = ["<ROOT>/server/src/server.js"]
```
**Gemini CLI** — `~/.gemini/settings.json`:
```json
{ "mcpServers": { "yx-bridge": { "command": "node", "args": ["<ROOT>/server/src/server.js"] } } }
```
**Windsurf** — `~/.codeium/windsurf/mcp_config.json`, **Cline / Roo Code** — their MCP settings JSON,
**Claude Desktop** — `claude_desktop_config.json`, **VS Code Copilot** — `.vscode/mcp.json` (`"servers"` key),
**Zed** — `settings.json` → `context_servers`: all use the same `command` + `args` shape as Cursor.

Merge into the existing file; do not overwrite other servers. Restart the agent afterwards.


## 4b. Set a connection password (recommended)
After the extension is connected, lock the local port so only it can connect:
call the tool `browser_password` with `action: "set"`. It returns a generated `password`.
You MUST then: (1) save that password to your own memory; (2) tell the user the password;
(3) tell the user they can change it later with `browser_password action=change`, or by editing
`<ROOT>/server/.token` and the extension's stored password. To remove it: `action: "off"`.
## 4. Verify
- `cd <ROOT>/server && node src/selftest.js` → must print `mcp tools: 111 ...`.
- After restarting the agent, call the tool `browser_status`. Expect `connected: true`.
  If `connected: false`: the browser must be running with the "YX Bridge" extension enabled
  (badge `on` on the orange "C" icon). Only one agent can hold port 17555 at a time.
- Optional live checks: `node test-live.mjs`, `node test-translate.mjs`, `node test-media.mjs` (they open
  their own tabs in a spare window and close them).

## 5. Manual fallback for the extension (only if step 2 reported FAIL, or on macOS/Linux)
Tell the user: open `chrome://extensions` (Yandex: type it in the address bar; `browser://extensions`
opens Yandex's catalog instead), turn on "Developer mode" (top right), click "Load unpacked",
choose `<ROOT>/extension`. That is the only step that cannot be automated outside Windows.

## 6. Uninstall
```
set CLAUDE_BRIDGE_NOPAUSE=1
powershell -NoProfile -ExecutionPolicy Bypass -File "<ROOT>\Uninstall-YXBridge.ps1"
```
Removes the Claude Code registration and removes the extension from the browser via UI Automation.
For other agents, delete the `yx-bridge` entry from their config yourself. Then delete `<ROOT>`.

## 7. Usage notes for the agent
- Read `README.md` for the 111 tools. `tabId` is optional everywhere (active tab by default).
- If the user is working in the browser at the same time, first call `browser_work_window mode=least_tabs`
  so your tabs open in a separate window and never steal focus.
- Tools that attach the DevTools debugger show a yellow "debugging" bar in the tab; `browser_cdp_detach` removes it.
- Cookie values and `browser_clear_data` are sensitive: confirm with the user before using them beyond cache.

License: Apache 2.0, Copyright 2026 MRsuperkosmos (see LICENSE, NOTICE).

---
---

# YX Bridge — инструкция для ИИ-агента, устанавливающего этот пакет

Ты ИИ-агент для работы с кодом (Claude Code, Cursor, OpenCode, Codex, Gemini CLI, Cline, Windsurf или
похожий), и пользователь передал тебе этот архив. Установи его целиком, не прося пользователя ничего
нажимать, кроме случаев, где ниже сказано иначе. Сообщай результат каждого шага.

## 0. Требования
- Windows для полностью автоматического пути (расширение загружается через UI Automation).
  macOS/Linux: сервер и регистрация автоматически, расширению нужен один ручной шаг (раздел 5).
- Node.js 18+ (установщик для Windows поставит через winget, если нет).
- Chromium-браузер: Яндекс Браузер, Google Chrome или Microsoft Edge, запущенный под текущим пользователем.

## 1. Распаковать в постоянную папку
Распакуй архив в папку, которая не будет перемещаться, например `C:\tools\yx-bridge` или `~/yx-bridge`.
НЕ оставляй во временной папке или в «Загрузках»: расширение и регистрация MCP указывают на этот путь.
Ниже `<ROOT>` — эта папка.

## 2. Запустить установщик (Windows)
```
set CLAUDE_BRIDGE_NOPAUSE=1
powershell -NoProfile -ExecutionPolicy Bypass -File "<ROOT>\Install-YXBridge.ps1"
```
Ключи: `-Browser yandex|chrome|edge` (по умолчанию auto), `-NoBrowser` (пропустить расширение), `-NoNode`.
Установщик: ставит Node при необходимости → `npm install` в `<ROOT>\server` → регистрирует MCP-сервер
в Claude Code (`~/.claude.json`, ключ `yx-bridge`) → открывает НОВОЕ окно браузера на chrome://extensions,
включает режим разработчика, нажимает «Загрузить распакованное расширение», вводит `<ROOT>\extension`,
подтверждает, закрывает это окно → проверяет связь с расширением. Печатает отчёт; строки, начинающиеся
с `FAIL`, считай ошибками.

macOS/Linux: `bash "<ROOT>/install.sh"` (только сервер + регистрация в Claude Code).

## 3. Прописать MCP-сервер в СВОЙ агент (пропусти, если ты Claude Code)
Сервер — stdio MCP-сервер. Команда: `node "<ROOT>/server/src/server.js"`.
Внутри JSON используй прямые слэши или экранированные обратные. Выбери свой конфиг:

**Cursor** — `~/.cursor/mcp.json` (или `<проект>/.cursor/mcp.json`):
```json
{ "mcpServers": { "yx-bridge": { "command": "node", "args": ["<ROOT>/server/src/server.js"] } } }
```
**OpenCode** — `~/.config/opencode/opencode.json` (или `<проект>/opencode.json`):
```json
{ "$schema": "https://opencode.ai/config.json",
  "mcp": { "yx-bridge": { "type": "local", "command": ["node", "<ROOT>/server/src/server.js"], "enabled": true } } }
```
**Codex CLI** — `~/.codex/config.toml`:
```toml
[mcp_servers.yx-bridge]
command = "node"
args = ["<ROOT>/server/src/server.js"]
```
**Gemini CLI** — `~/.gemini/settings.json`:
```json
{ "mcpServers": { "yx-bridge": { "command": "node", "args": ["<ROOT>/server/src/server.js"] } } }
```
**Windsurf** — `~/.codeium/windsurf/mcp_config.json`, **Cline / Roo Code** — их JSON настроек MCP,
**Claude Desktop** — `claude_desktop_config.json`, **VS Code Copilot** — `.vscode/mcp.json` (ключ `"servers"`),
**Zed** — `settings.json` → `context_servers`: везде та же форма `command` + `args`, что у Cursor.

Добавляй в существующий файл, не затирая другие серверы. После этого перезапусти агента.


## 4b. Поставить пароль на подключение (рекомендуется)
После подключения расширения закройте порт паролем, чтобы к нему могло подключиться только оно:
вызовите инструмент `browser_password` с `action: "set"`. Он вернёт сгенерированный `password`.
После этого ОБЯЗАТЕЛЬНО: (1) сохрани пароль себе в память; (2) сообщи пароль пользователю;
(3) скажи, что сменить его можно через `browser_password action=change` или правкой
`<ROOT>/server/.token` и сохранённого пароля в расширении. Убрать: `action: "off"`.
## 4. Проверить
- `cd <ROOT>/server && node src/selftest.js` → должно напечатать `mcp tools: 111 ...`.
- После перезапуска агента вызови инструмент `browser_status`. Ожидается `connected: true`.
  Если `connected: false`: браузер должен быть запущен с включённым расширением «YX Bridge»
  (бейдж `on` на оранжевой иконке «C»). Порт 17555 может держать только один агент за раз.
- Необязательные живые проверки: `node test-live.mjs`, `node test-translate.mjs`, `node test-media.mjs`
  (открывают свои вкладки в свободном окне и закрывают их).

## 5. Ручной запасной вариант для расширения (только если шаг 2 выдал FAIL или на macOS/Linux)
Скажи пользователю: открыть `chrome://extensions` (в Яндексе набрать именно так; `browser://extensions`
открывает каталог Яндекса), включить «Режим разработчика» (справа вверху), нажать «Загрузить распакованное
расширение», выбрать `<ROOT>/extension`. Это единственный шаг, который не автоматизируется вне Windows.

## 6. Удаление
```
set CLAUDE_BRIDGE_NOPAUSE=1
powershell -NoProfile -ExecutionPolicy Bypass -File "<ROOT>\Uninstall-YXBridge.ps1"
```
Снимает регистрацию в Claude Code и удаляет расширение из браузера через UI Automation.
Для других агентов удали запись `yx-bridge` из их конфига сам. Затем удали `<ROOT>`.

## 7. Заметки по использованию для агента
- Список 111 инструментов в `README.md`. `tabId` везде необязателен (по умолчанию активная вкладка).
- Если пользователь параллельно работает в браузере, сначала вызови `browser_work_window mode=least_tabs`,
  чтобы твои вкладки открывались в отдельном окне и не отбирали фокус.
- Инструменты, подключающие отладчик DevTools, показывают жёлтую полосу «отладка» во вкладке; `browser_cdp_detach` её снимает.
- Значения куков и `browser_clear_data` — чувствительные вещи: согласуй с пользователем, прежде чем идти дальше очистки кэша.

Лицензия: Apache 2.0, Copyright 2026 MRsuperkosmos (см. LICENSE, NOTICE).
