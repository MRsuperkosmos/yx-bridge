# YX Bridge — reference of all 254 tools / справочник всех 254 инструментов

> Each tool: **name** — English description / русское описание.
> Каждый инструмент: **имя** — English description / русское описание.
> `tabId` is optional everywhere (active tab by default). / `tabId` везде необязателен (по умолчанию активная вкладка).

## Tabs & windows / Вкладки и окна
1. **browser_status** — Is the extension connected; version and tabs with the debugger attached. / Подключено ли расширение; версия и вкладки с отладчиком.
2. **browser_list_tabs** — List all open tabs (id, window, url, title, active). / Все открытые вкладки (id, окно, url, заголовок, активная).
3. **browser_active_tab** — Return the currently active tab. / Текущая активная вкладка.
4. **browser_open_tab** — Open a new tab with a URL. / Открыть новую вкладку по адресу.
5. **browser_open_urls** — Open several URLs at once (background by default). / Открыть сразу несколько адресов (по умолчанию в фоне).
6. **browser_close_tab** — Close a tab by id. / Закрыть вкладку по id.
7. **browser_close_tabs** — Close many tabs by id list and/or URL/title regex. / Закрыть много вкладок по списку id или regex.
8. **browser_activate_tab** — Make a tab active; focusWindow=false keeps your window in front. / Сделать вкладку активной; focusWindow=false не выдёргивает ваше окно.
9. **browser_navigate** — Navigate a tab to a URL and wait for load. / Перейти по адресу и дождаться загрузки.
10. **browser_reload** — Reload a tab (optionally bypass cache). / Перезагрузить вкладку (можно без кэша).
11. **browser_back** — Go back in a tab's history. / Назад по истории вкладки.
12. **browser_find_tabs** — Find tabs whose URL or title matches a regex. / Найти вкладки по regex адреса или заголовка.
13. **browser_tab_update** — Pin/mute/activate or change a tab's URL. / Закрепить, заглушить, активировать или сменить адрес.
14. **browser_tab_duplicate** — Duplicate a tab. / Дублировать вкладку.
15. **browser_zoom** — Get or set a tab's zoom factor. / Узнать или задать масштаб вкладки.
16. **browser_windows** — List all windows with their tabs. / Все окна с их вкладками.
17. **browser_window_new** — Open a new window (incognito/size/state options). / Новое окно (инкогнито, размер, состояние).
18. **browser_window_close** — Close a window and all its tabs. / Закрыть окно со всеми вкладками.
19. **browser_window_focus** — Focus a window; optionally set its state. / Сфокусировать окно; можно задать состояние.
20. **browser_work_window** — Pick a "work window" so the agent doesn't disturb yours. / Выбрать «рабочее окно», чтобы не мешать вашему.
21. **browser_launch** — Start Yandex Browser if it is not running. / Запустить Яндекс Браузер, если закрыт.
22. **browser_reload_extension** — Reload the YX Bridge extension itself. / Перезагрузить само расширение YX Bridge.
23. **browser_keep_visible** — Make a background tab behave as visible/focused (players, timers keep running). / Заставить фоновую вкладку считать себя видимой (плееры, таймеры работают).

## Read the page / Чтение страницы
24. **browser_get_page** — URL, title and visible text; original=true re-fetches untranslated HTML. / Адрес, заголовок и видимый текст; original=true — непереведённый HTML.
25. **browser_get_html** — HTML of the document or of a selector. / HTML документа или элемента по селектору.
26. **browser_query** — querySelectorAll: tag, id, class, text, links, rect, visibility, attrs. / querySelectorAll: тег, id, класс, текст, ссылки, координаты, атрибуты.
27. **browser_find_text** — Search visible text for a substring with context. / Поиск подстроки в тексте с контекстом.
28. **browser_links** — List unique links (href + text). / Уникальные ссылки (адрес + текст).
29. **browser_forms** — List forms and fields (passwords masked). / Формы и их поля (пароли скрыты).
30. **browser_tables** — Extract HTML tables as arrays of rows. / HTML-таблицы как массивы строк.
31. **browser_meta** — Metadata: canonical, favicon, OpenGraph, all meta, JSON-LD, outline. / Метаданные: canonical, favicon, OpenGraph, meta, JSON-LD.
32. **browser_article** — Main article text, menus/footers stripped. / Основной текст статьи без меню и футеров.
33. **browser_outline** — Title, heading tree, ARIA landmarks, element counts. / Заголовок, дерево заголовков, ориентиры, счётчики.
34. **browser_page_code** — Rendered HTML + inline scripts/styles + external URLs. / Отрисованный HTML, встроенные скрипты и стили, внешние ссылки.
35. **browser_console_logs** — console.log/warn/error and uncaught exceptions. / Логи консоли и необработанные ошибки.
36. **browser_wait_for** — Wait until a selector and/or text appears. / Ждать появления селектора или текста.
37. **browser_wait_gone** — Wait until elements disappear (spinners, loaders). / Ждать исчезновения элементов (спиннеры, загрузчики).

## Snapshots & media reading / Снимки и чтение медиа
38. **browser_screenshot** — Screenshot a tab; fullPage=true for the whole page. / Скриншот вкладки; fullPage=true — вся страница.
39. **browser_element_screenshot** — Screenshot of one element via CDP. / Скриншот одного элемента.
40. **browser_pdf** — Print the page to a PDF file. / Сохранить страницу в PDF.
41. **browser_media_list** — Catalogue all images/videos/audio/embeds/media links. / Каталог всех картинок, видео, аудио, встроенных плееров, ссылок.
42. **browser_image_view** — Fetch an in-page image (with cookies) and show it to the agent. / Скачать картинку изнутри страницы и показать агенту.
43. **browser_video_frames** — Grab frames from a video at given seconds as images. / Кадры из видео в заданные секунды как изображения.
44. **browser_video_control** — Control a <video>: play, pause, seek, mute, speed, volume, fullscreen, info. / Управление видео: play, pause, перемотка, звук, скорость, полный экран.
45. **browser_captions** — Extract video captions/subtitles cues and tracks. / Субтитры видео: активные дорожки и элементы track.
46. **browser_snapshot** — Dump a whole page to a folder (html, text, media, screenshot, code, images). / Выкачать страницу целиком в папку (html, текст, медиа, скриншот, код, картинки).

## Change the page (DOM) / Изменение страницы (DOM)
47. **browser_click** — Click the Nth element matching a selector. / Клик по N-му элементу селектора.
48. **browser_type** — Type text into an input/textarea/contenteditable. / Ввод текста в поле или редактируемый блок.
49. **browser_select** — Choose a <select> option by value or text. / Выбор пункта в списке по значению или тексту.
50. **browser_fill_form** — Fill several fields at once ({selectorOrName: value}) and optionally submit. / Заполнить несколько полей разом и при желании отправить.
51. **browser_set_html** — Replace or extend an element's HTML. / Заменить или дописать HTML элемента.
52. **browser_set_attr** — Set or remove an attribute. / Поставить или удалить атрибут.
53. **browser_set_style** — Apply inline CSS styles. / Инлайн-стили.
54. **browser_remove** — Remove matching elements from the DOM. / Удалить элементы из DOM.
55. **browser_inject_css** — Inject a CSS stylesheet. / Добавить свою таблицу стилей.
56. **browser_scroll** — Scroll by pixels or to an element. / Прокрутка на пиксели или к элементу.
57. **browser_scroll_bottom** — Scroll to the bottom until the page stops growing. / Докрутить до конца бесконечной ленты.
58. **browser_highlight** — Draw an outline around elements. / Обвести элементы рамкой.
59. **browser_hover** — Hover an element to reveal menus/tooltips. / Навести курсор для меню и подсказок.
60. **browser_press_key** — Dispatch a key event on an element. / Нажатие клавиши на элементе.
61. **browser_focus_element** — Focus an element and scroll it into view. / Сфокусировать элемент и показать его.
62. **browser_submit_form** — Submit a form. / Отправить форму.
63. **browser_reset_form** — Reset a form to defaults. / Сбросить форму.
64. **browser_check_all** — Check/uncheck all checkboxes matching a selector. / Отметить/снять все чекбоксы по селектору.
65. **browser_search_on_page** — Type a query into the page's own search box and submit. / Ввести запрос в поиск на странице и отправить.
66. **browser_mark_text** — Highlight all occurrences of a text with <mark>. / Подсветить все вхождения текста.
67. **browser_unmark** — Remove highlights added by mark_text. / Убрать подсветку.
68. **browser_scroll_to_text** — Scroll to the first occurrence of a text. / Прокрутить к первому вхождению текста.
69. **browser_remove_clutter** — Remove ads/banners/popups/sidebars. / Убрать рекламу, баннеры, попапы, сайдбары.
70. **browser_focus_mode** — Declutter for distraction-free reading. / Очистить для чтения без отвлечений.
71. **browser_dark_mode** — Toggle a dark-mode filter on the page. / Включить/выключить тёмный фильтр страницы.
72. **browser_font_size** — Enlarge/shrink the page font by percent. / Увеличить/уменьшить шрифт страницы.

## Run code & DevTools / Выполнение кода и DevTools
73. **browser_eval** — Run JavaScript in the page context and return the result. / Выполнить JavaScript в контексте страницы.
74. **browser_fetch** — HTTP request from the page context (site cookies): status, headers, body. / HTTP-запрос из контекста страницы: статус, заголовки, тело.
75. **browser_cdp** — Send a raw Chrome DevTools Protocol command. / Любая команда протокола DevTools.
76. **browser_cdp_type** — Type with real input events (Slate/Draft editors). / Ввод настоящими событиями (для сложных редакторов).
77. **browser_cdp_key** — Press a key via CDP. / Нажать клавишу через CDP.
78. **browser_cdp_click_xy** — Real mouse click at coordinates. / Клик мышью по координатам.
79. **browser_cdp_wheel** — Real mouse-wheel scroll. / Прокрутка колесом мыши.
80. **browser_cdp_detach** — Detach the debugger (removes the debug bar). / Отцепить отладчик (убрать полосу отладки).

## Students / Школьники
81. **browser_quiz_extract** — Scan a test page for questions and answer inputs. / Разобрать тест: вопросы и поля ответов.
82. **browser_quiz_answer_all** — Answer many quiz questions at once. / Ответить сразу на много вопросов.
83. **browser_quiz_submit** — Click the submit/check/finish button. / Нажать отправить/проверить/завершить.
84. **browser_quiz_next** — Click the "next question" button. / Нажать «следующий вопрос».
85. **browser_quiz_prev** — Click the "previous question" button. / Нажать «предыдущий вопрос».
86. **browser_click_text** — Click a button/link by its visible text. / Клик по кнопке/ссылке по видимому тексту.
87. **browser_choose** — Pick a radio/checkbox by its label text. / Выбрать вариант по тексту подписи.
88. **browser_flashcards** — Extract flashcards (term/definition pairs). / Извлечь карточки (термин/определение).
89. **browser_essay_write** — Write a long text into a textarea/contenteditable. / Написать длинный текст в поле ответа.
90. **browser_word_count** — Count words/chars/sentences/paragraphs. / Счётчик слов, знаков, предложений, абзацев.
91. **browser_fill_blanks** — Fill inputs in order (fill-in-the-blank). / Заполнить пропуски по порядку.
92. **browser_set_range** — Set a range slider value. / Задать значение ползунку.
93. **browser_drag_drop** — HTML5 drag-and-drop (matching/ordering). / Перетаскивание (соответствия, порядок).
94. **browser_reorder** — Reorder a container's children (sortable). / Переставить элементы в нужный порядок.
95. **browser_code_get** — Read code from Monaco/CodeMirror/Ace/textarea. / Прочитать код из редактора Monaco/CodeMirror/Ace.
96. **browser_code_set** — Write code into an in-page editor. / Записать код в редактор на странице.
97. **browser_timer_read** — Read a countdown/exam timer. / Прочитать таймер обратного отсчёта.
98. **browser_progress_read** — Read progress bars (value, max, percent). / Прочитать прогресс-бары.
99. **browser_definitions** — Extract term/definition pairs from <dl>. / Извлечь пары термин/определение.
100. **browser_required_fields** — List required fields still empty/invalid. / Обязательные незаполненные поля.
101. **browser_form_validate** — Report HTML5 validity and invalid fields. / Проверить валидность формы и ошибки.
102. **browser_math_extract** — Extract formulas (MathML, LaTeX/TeX, inline). / Извлечь формулы (MathML, LaTeX).
103. **browser_answer_key_scan** — Scan the DOM for answers leaked in data-* attributes. / Найти ответы, утёкшие в data-атрибуты.

## Testers / security / Тестировщики и безопасность
104. **browser_tech_detect** — Detect frameworks, libraries, CMS, analytics, CDNs. / Определить фреймворки, библиотеки, CMS, аналитику.
105. **browser_globals_list** — List custom JS globals the page added. / Список глобальных переменных страницы.
106. **browser_comments_extract** — Extract HTML comments (may leak info). / Извлечь HTML-комментарии.
107. **browser_hidden_inputs** — List hidden inputs and their values (tokens, ids). / Скрытые поля и их значения.
108. **browser_inline_handlers** — List inline event handlers (XSS/DOM sinks). / Инлайн-обработчики событий (потенциальные XSS-точки).
109. **browser_cookie_audit** — Which cookies are visible to JavaScript (no HttpOnly). / Какие куки видны JS (без HttpOnly).
110. **browser_secrets_scan** — Scan HTML/storage/cookies for exposed secrets. / Поиск утёкших секретов в HTML, хранилищах, куках.
111. **browser_links_classify** — Classify links: internal/external/mailto/tel/anchor. / Классифицировать ссылки по типам.
112. **browser_params** — URL query params, hash, all form field names/types. / Параметры адреса, хэш, поля форм.
113. **browser_perf** — Performance: TTFB, load, protocol, resource sizes. / Производительность: TTFB, загрузка, размеры ресурсов.
114. **browser_third_party** — Third-party origins and known trackers. / Сторонние домены и известные трекеры.
115. **browser_source_maps** — Script URLs and sourceMappingURL references. / Ссылки на скрипты и .map файлы.
116. **browser_sri_audit** — Third-party scripts/styles without Subresource Integrity. / Внешние ресурсы без SRI.
117. **browser_iframe_audit** — Audit iframes (cross-origin, sandbox, allow). / Аудит iframe (origin, sandbox).
118. **browser_iframes** — List iframes: src, origin, same-origin, sandbox, size. / Список iframe: src, origin, sandbox, размер.
119. **browser_cookie_consent** — Detect a cookie-consent/GDPR banner. / Обнаружить баннер согласия на куки.
120. **browser_hidden_elements** — List hidden elements that still carry text. / Скрытые элементы с текстом.
121. **browser_console_errors** — Only console errors and uncaught exceptions. / Только ошибки консоли и исключения.
122. **browser_websocket_frames** — Record/read WebSocket frames via CDP. / Записывать и читать кадры WebSocket.
123. **browser_security_scan** — Passive security overview (CSP, headers, forms, mixed content). / Пассивный обзор безопасности (CSP, заголовки, формы).
124. **browser_accessibility_tree** — The page's accessibility (AX) tree. / Дерево доступности страницы.
125. **browser_validation_audit** — HTML/a11y issues: dup ids, empty links, heading skips, missing alt. / Ошибки HTML/доступности.
126. **browser_storage_dump** — Dump localStorage, sessionStorage, cookies (with flags). / Дамп хранилищ и куков.
127. **browser_headers_get** — Response status and headers of a URL. / Статус и заголовки ответа URL.
128. **browser_robots** — Fetch and parse /robots.txt. / Скачать и разобрать robots.txt.
129. **browser_sitemap** — Fetch sitemap.xml and list its URLs. / Скачать sitemap.xml и список адресов.
130. **browser_security_txt** — Fetch /.well-known/security.txt. / Скачать security.txt.
131. **browser_broken_links** — Check page links, report 4xx/5xx/failed. / Проверить ссылки, найти битые.
132. **browser_redirect_chain** — Follow a URL's redirects and report hops. / Проследить редиректы адреса.
133. **browser_cors_probe** — Report a URL's CORS response headers. / Проверить CORS-заголовки адреса.

## Extract & summarize / Извлечение и сводки
134. **browser_emails** — Extract email addresses. / Извлечь адреса почты.
135. **browser_phones** — Extract phone numbers. / Извлечь телефоны.
136. **browser_dates** — Extract dates. / Извлечь даты.
137. **browser_prices** — Extract prices with currency. / Извлечь цены с валютой.
138. **browser_extract_urls** — Extract all http(s) URLs. / Извлечь все адреса http(s).
139. **browser_hashtags** — Extract #hashtags. / Извлечь хэштеги.
140. **browser_mentions** — Extract @mentions. / Извлечь упоминания @.
141. **browser_numbers** — Extract numbers/statistics. / Извлечь числа и статистику.
142. **browser_ip_addresses** — Extract IPv4 addresses. / Извлечь IPv4-адреса.
143. **browser_social_links** — Find social-network links. / Найти ссылки на соцсети.
144. **browser_contact_info** — Emails, phones, socials, postal address in one call. / Почты, телефоны, соцсети, адрес — одним вызовом.
145. **browser_summary_data** — Everything to summarize a page (title, desc, headings, paras). / Всё для сводки страницы.
146. **browser_toc** — Table of contents from headings. / Оглавление по заголовкам.
147. **browser_schema_data** — Structured data (JSON-LD + microdata). / Структурированные данные (JSON-LD, микроразметка).
148. **browser_product_extract** — Product schema (name, price, availability, rating). / Данные товара (цена, наличие, рейтинг).
149. **browser_recipe_extract** — Recipe schema (ingredients, steps, time). / Данные рецепта (ингредиенты, шаги, время).
150. **browser_event_extract** — Event schema (date, place, tickets). / Данные события (дата, место, билеты).
151. **browser_job_extract** — Job-posting schema (title, salary, company). / Данные вакансии (зарплата, компания).
152. **browser_reviews** — Reviews and ratings. / Отзывы и рейтинги.
153. **browser_lists_extract** — Meaningful <ul>/<ol> lists and items. / Осмысленные списки и их пункты.
154. **browser_quotes** — Extract quotes (blockquote, q). / Извлечь цитаты.
155. **browser_code_blocks** — Extract code blocks with language. / Извлечь блоки кода с языком.
156. **browser_citations** — Extract citations/references. / Извлечь ссылки и сноски.
157. **browser_breadcrumbs** — Extract breadcrumb items. / Извлечь «хлебные крошки».
158. **browser_pagination** — Find next/previous page links. / Найти ссылки на след./пред. страницу.
159. **browser_rss_find** — Find RSS/Atom feed links. / Найти ленты RSS/Atom.
160. **browser_author** — Extract the article author. / Извлечь автора статьи.
161. **browser_publish_date** — Extract published/modified dates. / Извлечь даты публикации/правки.
162. **browser_main_image** — The page's main image. / Главная картинка страницы.
163. **browser_image_alts** — Images with alt text; count missing alt. / Картинки с alt; сколько без alt.
164. **browser_faq** — Extract FAQ question/answer pairs. / Извлечь вопросы-ответы FAQ.
165. **browser_paragraphs** — Extract paragraphs longer than N chars. / Извлечь абзацы длиннее N знаков.
166. **browser_headings** — Extract all headings h1–h6. / Извлечь все заголовки h1–h6.
167. **browser_word_freq** — Top words by frequency (stopwords removed). / Топ слов по частоте (без стоп-слов).
168. **browser_reading_time** — Estimate reading time. / Оценка времени чтения.
169. **browser_lang_detect** — Detect the page's language. / Определить язык страницы.
170. **browser_reader_view** — Clean reader view as structured text. / Режим чтения: чистый структурированный текст.
171. **browser_to_markdown** — Convert main content to Markdown. / Конвертировать содержимое в Markdown.
172. **browser_entities** — Likely named entities with counts. / Вероятные имена собственные с частотой.
173. **browser_login_detect** — Detect a login form and its fields. / Обнаружить форму входа и её поля.
174. **browser_newsletter_detect** — Detect a newsletter/subscribe form. / Обнаружить форму подписки.
175. **browser_detect_paywall** — Detect a likely paywall. / Обнаружить платную стену.
176. **browser_extract** — Structured scraping by a selector spec. / Структурный парсинг по схеме селекторов.

## Save & download / Сохранение и загрузка
177. **browser_save_text** — Save visible text to a .txt file. / Сохранить видимый текст в .txt.
178. **browser_save_html** — Save full HTML to an .html file. / Сохранить весь HTML в .html.
179. **browser_save_markdown** — Convert to Markdown and save .md. / Сохранить страницу в .md.
180. **browser_tables_to_csv** — Export every table to CSV files. / Экспорт всех таблиц в CSV.
181. **browser_download** — Download a URL through the browser (its cookies). / Скачать адрес силами браузера (с куками).
182. **browser_download_pdfs** — Download all PDF links on the page. / Скачать все PDF-ссылки страницы.
183. **browser_download_images** — Download all images (a whole gallery). / Скачать все картинки (галерею целиком).
184. **browser_media_download** — Download media files by URL. / Скачать медиа-файлы по адресам.
185. **browser_favicon_save** — Download the page's favicon. / Скачать favicon страницы.
186. **browser_compare_pages** — Diff two URLs' readable text. / Сравнить читаемый текст двух адресов.

## Utility on elements / Утилиты по элементам
187. **browser_get_selection** — Text the user has selected. / Текст, выделенный пользователем.
188. **browser_element_info** — Full info about one element (tag, text, rect, styles, attrs). / Полная информация об элементе.
189. **browser_element_text** — Full text of the first matching element. / Полный текст первого элемента по селектору.
190. **browser_get_value** — Value/checked state of an input. / Значение/состояние поля.
191. **browser_get_attribute** — One attribute value of an element. / Значение атрибута элемента.
192. **browser_attr_values** — Values of one attribute across all matches. / Значения атрибута у всех совпадений.
193. **browser_get_styles** — Computed CSS styles of an element. / Вычисленные стили элемента.
194. **browser_is_visible** — Whether an element is visible / in viewport. / Виден ли элемент и в области видимости ли.
195. **browser_count_selector** — Count elements matching a selector. / Сколько элементов по селектору.
196. **browser_table_search** — Search all tables for rows containing text. / Поиск строк по всем таблицам.
197. **browser_duplicate_content** — Find duplicated paragraphs. / Найти повторяющиеся абзацы.
198. **browser_fonts_used** — Font families used on the page. / Используемые шрифты.
199. **browser_colors_used** — Most-used text/background colors. / Самые частые цвета текста и фона.
200. **browser_meta_audit** — SEO/meta audit (viewport, robots, canonical…). / SEO-аудит мета-тегов.
201. **browser_lazy_images** — Lazy vs eager image counts. / Ленивые и обычные картинки.
202. **browser_price_stats** — Price stats: min, max, median, average. / Статистика цен: мин, макс, медиана, среднее.
203. **browser_text_stats** — Readability (words, sentences, Flesch score). / Читаемость (слова, предложения, Flesch).
204. **browser_json_scan** — Find embedded JSON / app-state objects. / Найти встроенный JSON и состояние приложения.
205. **browser_external_links** — List external links. / Внешние ссылки.
206. **browser_internal_links** — List internal links. / Внутренние ссылки.
207. **browser_pdf_links** — List PDF links. / Ссылки на PDF.
208. **browser_doc_links** — List document links (doc/xls/ppt/csv/txt). / Ссылки на документы.
209. **browser_video_links** — List video-file links. / Ссылки на видеофайлы.
210. **browser_audio_links** — List audio-file links. / Ссылки на аудиофайлы.
211. **browser_clipboard_write** — Copy text to the clipboard. / Скопировать текст в буфер обмена.
212. **browser_clipboard_read** — Read clipboard text (may be blocked). / Прочитать буфер обмена (может быть заблокировано).

## Emulation & network / Эмуляция и сеть
213. **browser_set_viewport** — Emulate a device viewport (mobile, size). / Эмуляция экрана устройства (мобильный, размер).
214. **browser_set_user_agent** — Override User-Agent/Accept-Language. / Подмена User-Agent и языка.
215. **browser_geolocation** — Override geolocation or clear it. / Подмена геолокации.
216. **browser_network_start** — Start recording network requests. / Начать запись сетевых запросов.
217. **browser_network_log** — Read recorded requests (filter by regex). / Прочитать записанные запросы.
218. **browser_network_stop** — Stop recording network requests. / Остановить запись запросов.
219. **browser_response_body** — Body of the latest response matching a regex. / Тело последнего ответа по regex.
220. **browser_block_urls** — Block requests matching URL patterns. / Блокировать запросы по шаблонам.
221. **browser_dialogs** — Auto-handle alert/confirm/prompt. / Автоответ на alert/confirm/prompt.

## User-facing & browser data / Для пользователя и данные браузера
222. **browser_notify** — Desktop notification from the browser. / Системное уведомление из браузера.
223. **browser_speak** — Read text aloud (text-to-speech). / Озвучить текст синтезатором речи.
224. **browser_read_aloud** — Read the article aloud. / Прочитать статью вслух.
225. **browser_search** — Search with the default search engine. / Поиск в поисковике по умолчанию.
226. **browser_history_search** — Search browsing history. / Поиск по истории.
227. **browser_history_delete_url** — Remove a URL from history. / Удалить адрес из истории.
228. **browser_bookmarks_search** — Search bookmarks. / Поиск закладок.
229. **browser_bookmarks_tree** — Full bookmarks tree. / Дерево закладок целиком.
230. **browser_bookmark_add** — Add a bookmark. / Добавить закладку.
231. **browser_bookmark_remove** — Remove a bookmark. / Удалить закладку.
232. **browser_downloads_list** — List recent downloads. / Список последних загрузок.
233. **browser_cookies_get** — Read cookies for a URL/domain. / Прочитать куки по адресу/домену.
234. **browser_cookie_set** — Set a cookie. / Поставить куку.
235. **browser_cookie_remove** — Delete a cookie. / Удалить куку.
236. **browser_clear_data** — Clear browsing data (cache, cookies, storage…). / Очистить данные браузера (кэш, куки, хранилища).
237. **browser_storage** — Read/write page localStorage/sessionStorage. / Читать и писать localStorage/sessionStorage.
238. **browser_recent_closed** — Recently closed tabs/windows. / Недавно закрытые вкладки и окна.
239. **browser_restore_session** — Reopen a recently closed tab/window. / Восстановить недавно закрытое.
240. **browser_session_save** — Save all windows/tabs to a JSON file. / Сохранить все окна и вкладки в JSON.
241. **browser_session_load** — Reopen a saved session. / Открыть сохранённую сессию.

## Translation (Yandex) / Перевод (Яндекс)
242. **browser_translation** — Control auto-translation (off/on/status). / Управление автопереводом (off/on/status).
243. **browser_translate_settings_get** — Read translation settings from the profile. / Прочитать настройки перевода из профиля.
244. **browser_translate_settings_set** — Change translation settings (restarts the browser). / Изменить настройки перевода (перезапуск браузера).
245. **browser_translate_menu** — Drive the translate bubble like a human (Windows). / Нажимать пузырь перевода как человек (Windows).

## Browser UI automation (Windows) / Интерфейс браузера (Windows)
246. **browser_ui_list** — List browser UI controls via UI Automation. / Список элементов интерфейса браузера.
247. **browser_ui_click** — Click a browser UI control by regex. / Клик по элементу интерфейса браузера.
248. **browser_ui_chain** — Run a sequence of UI steps in one call. / Цепочка шагов по интерфейсу за один вызов.

## Statistics / Статистика
249. **browser_stats** — Browsing statistics: totals, per-domain time, top sites, per-day. / Статистика: итоги, время по доменам, топ сайтов, по дням.
250. **browser_stats_reset** — Clear all recorded browsing statistics. / Очистить всю статистику.
251. **browser_stats_export** — Export statistics to JSON (re-importable) and CSV (shareable). / Экспорт статистики в JSON (импортируемый) и CSV (для друзей).
252. **browser_stats_import** — Import statistics from an exported JSON (merge or replace). / Импорт статистики из JSON (объединить или заменить).

## Security & control / Безопасность и управление
253. **browser_password** — Manage the connection password that locks the local port; the agent can set it itself. / Пароль на порт, чтобы подключалось только своё расширение; агент может задать его сам.
254. **browser_jwt_decode** — Decode a JWT (header/payload, exp/iat) or scan the page's storage for JWTs. / Декодировать JWT (заголовок/содержимое, сроки) или найти JWT в хранилище страницы.
