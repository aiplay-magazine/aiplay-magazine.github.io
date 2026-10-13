// Flipbook reader: StPageFlip (vendor/page-flip, MIT) over the issue's WebP pages.
// The book is sized in JS to fit the stage exactly; two-page spreads when they fit, one page otherwise.
// Pages load lazily around the current spread. URL: read.html?issue=01#p12.
(async () => {
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), counter = $("counter"), scrub = $("scrub"), prevBtn = $("prev"), nextBtn = $("next");
  const LOOK_BEHIND = 2, LOOK_AHEAD = 5;

  const manifest = await (await fetch("issues.json", { cache: "no-cache" })).json();
  const wanted = new URLSearchParams(location.search).get("issue");
  const issue = manifest.issues.find((i) => i.id === wanted) || manifest.issues[0];
  if (!issue) { location.replace("./"); return; }

  const N = issue.pages;
  const ratio = issue.page_size[0] / issue.page_size[1];
  const pageUrl = (p) => issue.page_url.replace("{nnn}", String(p).padStart(3, "0"));

  document.title = `ИИГРА · Выпуск ${issue.id} — ${issue.title}`;
  $("issue-label").textContent = `Выпуск ${issue.id} · ${issue.date_label}`;
  $("issue-title").textContent = issue.title;
  $("pdf").href = issue.pdf.url;
  $("pdf-size").textContent = `${Math.round(issue.pdf.bytes / 1e6)} МБ`;
  scrub.max = N;

  let pf = null, mode = null, size = null, pages = [], current = 1;

  // Book order. In spread mode with an odd page count, a blank paper page goes before the back
  // cover so the back cover closes the book on its own (as in print). Entries: real page number or 0.
  const order = () => {
    const list = Array.from({ length: N }, (_, i) => i + 1);
    if (mode === "spread" && N % 2 === 1) list.splice(N - 1, 0, 0);
    return list;
  };
  const toBook = (p) => pages.indexOf(Math.min(Math.max(p, 1), N));

  // Book indices visible together with index i (cover alone, then pairs [1,2], [3,4], …).
  const spreadOf = (i) => {
    if (mode === "single" || i === 0) return [i];
    const start = i - ((i - 1) % 2);
    return start + 1 < pages.length ? [start, start + 1] : [start];
  };

  function measure() {
    const cs = getComputedStyle(stage);
    const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const hSpread = Math.min(h, w / 2 / ratio), hSingle = Math.min(h, w / ratio);
    const m = hSpread >= 0.75 * hSingle ? "spread" : "single";
    const pw = Math.floor((m === "spread" ? hSpread : hSingle) * ratio);
    return { mode: m, pw, ph: Math.round(pw / ratio) };
  }

  function load(i) {
    const el = pages[i] && document.querySelector(`.pg[data-i="${i}"] img`);
    if (!el || el.src) return;
    el.onload = () => el.parentElement.classList.add("is-loaded");
    el.src = pageUrl(pages[i]);
  }

  function onPage(i) {
    const vis = spreadOf(i);
    const real = vis.map((k) => pages[k]).filter(Boolean);
    current = real[0] ?? pages[vis[0] - 1] ?? N;
    for (let k = vis[0] - LOOK_BEHIND; k <= vis[vis.length - 1] + LOOK_AHEAD; k++) load(k);
    counter.textContent = `${real.length > 1 ? `${real[0]}–${real[1]}` : real[0] ?? "—"} / ${N}`;
    scrub.value = current;
    prevBtn.disabled = vis[0] === 0;
    nextBtn.disabled = vis[vis.length - 1] >= pages.length - 1;
    history.replaceState(null, "", `?issue=${issue.id}#p${current}`);
  }

  function build(startPage) {
    const m = measure();
    mode = m.mode; size = m;
    pages = order();

    // pf.destroy() removes its root element, so put the fresh book in place first.
    const old = $("book");
    const book = document.createElement("div");
    book.className = "book";
    old.after(book);
    if (pf) pf.destroy();
    old.remove();
    book.id = "book";
    book.style.width = `${mode === "spread" ? 2 * m.pw : m.pw}px`;
    book.style.height = `${m.ph}px`;
    book.innerHTML = pages.map((p, i) => p
      ? `<div class="pg" data-i="${i}"><span class="ph">${String(p).padStart(3, "0")}</span><img alt="Полоса ${p}" decoding="async"></div>`
      : `<div class="pg pg--blank" data-i="${i}"></div>`).join("");

    pf = new St.PageFlip(book, {
      width: m.pw, height: m.ph, size: "stretch",
      // minWidth decides orientation inside the library: huge → portrait, tiny → landscape.
      minWidth: mode === "single" ? 1e5 : 1, maxWidth: 1e5, minHeight: 1, maxHeight: 1e5,
      autoSize: false, usePortrait: true, showCover: true, mobileScrollSupport: false,
      maxShadowOpacity: 0.5, flippingTime: 700, startPage: toBook(startPage),
    });
    pf.loadFromHTML(book.querySelectorAll(".pg"));
    book.style.minWidth = book.style.minHeight = "0";
    pf.on("flip", (e) => onPage(e.data));
    onPage(pf.getCurrentPageIndex());
  }

  const go = (p) => pf.turnToPage(toBook(p)) || onPage(pf.getCurrentPageIndex());
  prevBtn.onclick = () => pf.flipPrev();
  nextBtn.onclick = () => pf.flipNext();
  scrub.oninput = () => go(Number(scrub.value));
  document.addEventListener("keydown", (e) => {
    if (e.target === scrub || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || k === " ") pf.flipNext();
    else if (k === "ArrowLeft" || k === "PageUp") pf.flipPrev();
    else if (k === "Home") go(1);
    else if (k === "End") go(N);
    else return;
    e.preventDefault();
  });

  let t;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const m = measure();
      if (m.mode !== mode || m.pw !== size.pw || m.ph !== size.ph) build(current);
    }, 150);
  });

  const fromHash = parseInt((location.hash.match(/^#p(\d+)$/) || [])[1]);
  build(fromHash || 1);
})();
