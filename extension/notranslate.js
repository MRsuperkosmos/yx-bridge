// YX Bridge
// Copyright 2026 MRsuperkosmos. Created 12 September 2026.
// Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.

// Регистрируется динамически (chrome.scripting.registerContentScripts) на document_end.
// Яндекс Браузер стирает пометки «не переводить» на старте документа, но уважает их,
// если они стоят к моменту DOMContentLoaded — проверено на Яндекс Браузере 26.8.
(function () {
  const h = document.documentElement;
  h.setAttribute("translate", "no");
  h.classList.add("notranslate");
  if (!document.querySelector('meta[name="google"][content="notranslate"]')) {
    const m = document.createElement("meta");
    m.name = "google";
    m.content = "notranslate";
    (document.head || h).prepend(m);
  }
})();
