// Comprehensive verification of the YX Bridge tools through the real MCP server.
// Runs in a MINIMIZED window; never focuses it, never uses the mouse/UI Automation.
import { spawn } from "node:child_process";
const proc = spawn(process.execPath, ["src/server.js"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", id = 0; const pending = new Map();
proc.stdout.on("data", (d) => { buf += d; const ls = buf.split("\n"); buf = ls.pop(); for (const l of ls) { try { const m = JSON.parse(l); pending.get(m.id)?.(m); pending.delete(m.id); } catch {} } });
const rpc = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
const tool = async (n, a = {}) => { const r = await rpc("tools/call", { name: n, arguments: a }); if (r.error) throw new Error(r.error.message); const c = r.result.content.find((x) => x.type === "text"); const t = c ? c.text : "{}"; try { return JSON.parse(t); } catch { return t; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; const fails = [];
async function T(name, a = {}, tabId) { try { await tool(name, tabId ? { tabId, ...a } : a); pass++; } catch (e) { fails.push(name + ": " + e.message.slice(0, 70)); } }
try {
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  // tool list sanity
  const list = await rpc("tools/list", {});
  console.log("tools listed:", list.result.tools.length);

  const win = await tool("browser_window_new", { url: "about:blank", state: "minimized" });
  await tool("browser_work_window", { mode: win.id });
  const wiki = (await tool("browser_open_tab", { url: "https://ru.wikipedia.org/wiki/HTML", active: true, windowId: win.id })).id;
  await tool("browser_wait_for", { tabId: wiki, selector: "#content", timeoutMs: 20000 });
  await tool("browser_keep_visible", { tabId: wiki });
  const form = (await tool("browser_open_tab", { url: "https://www.w3schools.com/html/html_forms.asp", active: false, windowId: win.id })).id;
  await tool("browser_wait_for", { tabId: form, selector: "input", timeoutMs: 20000 });
  await sleep(1000);

  console.log("\n== tabs/windows ==");
  for (const n of ["browser_status","browser_list_tabs","browser_active_tab","browser_windows"]) await T(n);
  await T("browser_find_tabs", { pattern: "wiki" });
  await T("browser_tab_update", { tabId: wiki, pinned: false });
  await T("browser_zoom", {}, wiki);

  console.log("== reading ==");
  for (const n of ["browser_get_page","browser_get_html","browser_links","browser_forms","browser_tables","browser_meta","browser_article","browser_outline","browser_console_logs"]) await T(n, {}, wiki);
  await T("browser_query", { selector: "a" }, wiki);
  await T("browser_find_text", { text: "HTML" }, wiki);
  await T("browser_pdf", {}, wiki);
  await T("browser_screenshot", { fullPage: true }, wiki);
  await tool("browser_cdp_detach", { tabId: wiki }).catch(()=>{});

  console.log("== change/DOM ==");
  await T("browser_query", { selector: "h1" }, wiki);
  await T("browser_set_attr", { selector: "h1", name: "data-x", value: "1" }, wiki);
  await T("browser_set_style", { selector: "h1", styles: { opacity: "1" } }, wiki);
  await T("browser_inject_css", { css: "body{}" }, wiki);
  await T("browser_scroll", { y: 200 }, wiki);
  await T("browser_highlight", { selector: "h1" }, wiki);
  await T("browser_hover", { selector: "a" }, wiki);
  await T("browser_press_key", { key: "End" }, wiki);
  await T("browser_element_screenshot", { selector: "h1" }, wiki);
  await tool("browser_cdp_detach", { tabId: wiki }).catch(()=>{});

  console.log("== JS/eval ==");
  await T("browser_eval", { code: "return document.title" }, wiki);
  await tool("browser_cdp_detach", { tabId: wiki }).catch(()=>{});

  console.log("== media ==");
  const media = await tool("browser_media_list", { tabId: wiki, limit: 20 });
  pass++;
  if (media.images && media.images[0]) await T("browser_image_view", { url: media.images.find(i=>i.width>=200)?.url || media.images[0].url, maxSide: 400 }, wiki);
  await T("browser_page_code", { maxChars: 100 }, wiki);

  console.log("== students ==");
  for (const n of ["browser_quiz_extract","browser_word_count","browser_required_fields","browser_form_validate","browser_definitions","browser_captions","browser_progress_read","browser_timer_read","browser_answer_key_scan","browser_math_extract","browser_code_get"]) await T(n, {}, form);
  await T("browser_choose", { label: "car" }, form);
  await T("browser_flashcards", {}, wiki);

  console.log("== testers ==");
  for (const n of ["browser_tech_detect","browser_globals_list","browser_comments_extract","browser_hidden_inputs","browser_inline_handlers","browser_cookie_audit","browser_secrets_scan","browser_links_classify","browser_params","browser_perf","browser_third_party","browser_source_maps","browser_sri_audit","browser_iframe_audit","browser_cookie_consent","browser_hidden_elements","browser_security_scan","browser_validation_audit","browser_iframes"]) await T(n, {}, wiki);
  await T("browser_console_errors", {}, wiki);
  await T("browser_accessibility_tree", { maxNodes: 20 }, wiki);
  await T("browser_robots", {}, wiki);
  await T("browser_sitemap", {}, wiki);
  await T("browser_security_txt", {}, wiki);
  await T("browser_headers_get", { url: "https://ru.wikipedia.org/wiki/HTML" }, wiki);
  await T("browser_redirect_chain", { url: "http://wikipedia.org" }, wiki);
  await T("browser_cors_probe", { url: "https://ru.wikipedia.org/w/api.php?format=json&action=query&meta=siteinfo" }, wiki);
  await T("browser_fetch", { url: "https://ru.wikipedia.org/w/api.php?format=json&action=query&meta=siteinfo", maxChars: 100 }, wiki);
  await T("browser_storage_dump", {}, wiki);
  await tool("browser_cdp_detach", { tabId: wiki }).catch(()=>{});

  console.log("== user extract ==");
  for (const n of ["browser_emails","browser_phones","browser_dates","browser_prices","browser_extract_urls","browser_hashtags","browser_mentions","browser_numbers","browser_ip_addresses","browser_social_links","browser_summary_data","browser_toc","browser_schema_data","browser_product_extract","browser_lists_extract","browser_quotes","browser_code_blocks","browser_citations","browser_breadcrumbs","browser_pagination","browser_rss_find","browser_author","browser_publish_date","browser_main_image","browser_image_alts","browser_faq","browser_paragraphs","browser_headings","browser_word_freq","browser_reading_time","browser_lang_detect","browser_reader_view","browser_to_markdown","browser_entities","browser_login_detect","browser_newsletter_detect","browser_detect_paywall"]) await T(n, {}, wiki);
  await T("browser_contact_info", {}, wiki);

  console.log("== user productivity ==");
  await T("browser_dark_mode", { on: true }, wiki);
  await T("browser_dark_mode", { on: false }, wiki);
  await T("browser_font_size", { percent: 110 }, wiki);
  await T("browser_save_text", {}, wiki);
  await T("browser_save_html", {}, wiki);
  await T("browser_save_markdown", {}, wiki);
  await T("browser_tables_to_csv", {}, wiki);
  await T("browser_favicon_save", {}, wiki);

  console.log("== utility ==");
  for (const n of ["browser_get_selection","browser_fonts_used","browser_colors_used","browser_meta_audit","browser_lazy_images","browser_external_links","browser_internal_links","browser_pdf_links","browser_doc_links","browser_video_links","browser_audio_links","browser_price_stats","browser_text_stats","browser_json_scan","browser_duplicate_content"]) await T(n, {}, wiki);
  await T("browser_scroll_to_text", { text: "HTML" }, wiki);
  await T("browser_mark_text", { text: "HTML" }, wiki);
  await T("browser_unmark", {}, wiki);
  await T("browser_table_search", { query: "HTML" }, wiki);
  await T("browser_element_info", { selector: "h1" }, wiki);
  await T("browser_attr_values", { selector: "a", attr: "href" }, wiki);
  await T("browser_count_selector", { selector: "a" }, wiki);
  await T("browser_element_text", { selector: "h1" }, wiki);
  await T("browser_get_attribute", { selector: "h1", attr: "class" }, wiki);
  await T("browser_get_value", { selector: "input" }, form);
  await T("browser_is_visible", { selector: "h1" }, wiki);
  await T("browser_get_styles", { selector: "h1" }, wiki);
  await T("browser_focus_element", { selector: "input" }, form);
  await T("browser_check_all", { checked: false }, form);
  await T("browser_reset_form", {}, form);
  await T("browser_clipboard_write", { text: "yx" }, wiki);

  console.log("== emulation/network ==");
  await T("browser_set_viewport", { width: 390, height: 800, mobile: true }, wiki);
  await T("browser_set_viewport", { width: 0 }, wiki);
  await T("browser_set_user_agent", { userAgent: "yx-test" }, wiki);
  await T("browser_geolocation", { latitude: 52, longitude: 4 }, wiki);
  await T("browser_geolocation", { clear: true }, wiki);
  await T("browser_network_start", {}, wiki);
  await tool("browser_reload", { tabId: wiki }); await sleep(2000);
  await T("browser_network_log", { limit: 3 }, wiki);
  await T("browser_response_body", { urlPattern: "HTML" }, wiki);
  await T("browser_network_stop", {}, wiki);
  await T("browser_block_urls", { patterns: [] }, wiki);
  await T("browser_dialogs", { mode: "off" }, wiki);
  await tool("browser_cdp_detach", { tabId: wiki }).catch(()=>{});

  console.log("== translation/stats/session ==");
  await T("browser_translation", { mode: "status" }, wiki);
  await T("browser_translate_settings_get", {});
  await T("browser_stats", {});
  await T("browser_stats", { from: "2026-09-01", to: "2026-09-12" });
  const saved = await tool("browser_session_save", { windowId: win.id }); pass++;
  await T("browser_bookmarks_search", { query: "x" });
  await T("browser_history_search", { text: "wiki", maxResults: 3 });
  await T("browser_recent_closed", { max: 2 });
  await T("browser_downloads_list", { limit: 2 });
  await T("browser_cookies_get", { domain: "wikipedia.org" });

  await tool("browser_window_close", { windowId: win.id });
  console.log("\nRESULT: passed " + pass + ", failed " + fails.length);
  if (fails.length) console.log("FAILURES:\n - " + fails.join("\n - "));
} catch (e) { console.error("FATAL:", e.message); process.exitCode = 1; }
finally { proc.kill(); }
