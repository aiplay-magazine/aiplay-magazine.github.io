// Shelf: renders issues.json (written by scripts/publish_issue.mjs) as covers on a ledge.
(async () => {
  const shelf = document.getElementById("shelf");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const mb = (bytes) => `${Math.round(bytes / 1e6)} МБ`;
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };

  let issues = [];
  try {
    const res = await fetch("issues.json", { cache: "no-cache" });
    issues = (await res.json()).issues || [];
  } catch {
    shelf.outerHTML = `<p class="empty">Не удалось загрузить список номеров.</p>`;
    return;
  }
  if (!issues.length) {
    shelf.outerHTML = `<p class="empty">Первый номер скоро появится на полке.</p>`;
    return;
  }

  shelf.style.setProperty("--page-ratio", issues[0].page_size[1] / issues[0].page_size[0]);
  shelf.innerHTML = issues.map((it, i) => `
    <article class="issue">
      <a class="cover-link" href="${esc(it.reader)}" aria-label="Листать выпуск ${esc(it.id)}">
        <img src="${esc(it.cover)}" width="720" height="${Math.round(720 * it.page_size[1] / it.page_size[0])}"
             alt="Обложка выпуска ${esc(it.id)} «${esc(it.title)}»" ${i > 3 ? 'loading="lazy"' : ""}>
        ${i === 0 ? '<span class="badge">НОВЫЙ</span>' : ""}
      </a>
      <div class="caption">
        <div class="mono">Выпуск ${esc(it.id)} · ${esc(it.date_label)}</div>
        <h2 class="issue-title">${esc(it.title)}</h2>
        <p class="issue-theme">${esc(it.theme)}</p>
        <p class="issue-meta mono">${it.pages} ${plural(it.pages, "полоса", "полосы", "полос")} · A4</p>
        <div class="issue-actions">
          <a class="btn btn--solid" href="${esc(it.reader)}">Листать</a>
          <a class="btn" href="${esc(it.pdf.url)}" download>PDF <small>${mb(it.pdf.bytes)}</small></a>
        </div>
      </div>
    </article>`).join("");
})();
