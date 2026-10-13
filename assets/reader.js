// Issue reader with two views, switched in the top bar and remembered per browser:
//  - book: StPageFlip (vendor/page-flip, MIT) over the issue's WebP pages, sized in JS to fit the
//    stage exactly; two-page spreads when they fit, one page otherwise; pages load lazily around
//    the current spread. Zoom is our own layer over the stage (see "Zoom"): StPageFlip owns touch
//    gestures on the book.
//  - scroll: all pages in one column, scrolled natively; +/− widen the column, pinch is the
//    browser's own. Pages load as they approach the viewport.
// URL: read.html?issue=01#p12 (?view=scroll|book overrides the remembered view).
(async () => {
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), counter = $("counter"), scrub = $("scrub"), prevBtn = $("prev"), nextBtn = $("next");
  const zoomInBtn = $("zoom-in"), zoomOutBtn = $("zoom-out");
  const viewBtns = { book: $("view-book"), scroll: $("view-scroll") };
  const LOOK_BEHIND = 2, LOOK_AHEAD = 5, VIEW_KEY = "aiplay.view";

  const manifest = await (await fetch("issues.json", { cache: "no-cache" })).json();
  const params = new URLSearchParams(location.search);
  const issue = manifest.issues.find((i) => i.id === params.get("issue")) || manifest.issues[0];
  if (!issue) { location.replace("./"); return; }

  const N = issue.pages;
  const ratio = issue.page_size[0] / issue.page_size[1];
  const pad3 = (p) => String(p).padStart(3, "0");
  const pageUrl = (p) => issue.page_url.replace("{nnn}", pad3(p));
  const clampPage = (p) => Math.min(Math.max(Math.round(p) || 1, 1), N);

  document.title = `ИИГРА · Выпуск ${issue.id} — ${issue.title}`;
  $("issue-label").textContent = `Выпуск ${issue.id} · ${issue.date_label}`;
  $("issue-title").textContent = issue.title;
  $("pdf").href = issue.pdf.url;
  $("pdf-size").textContent = `${Math.round(issue.pdf.bytes / 1e6)} МБ`;
  stage.style.setProperty("--page-ar", `${issue.page_size[0]} / ${issue.page_size[1]}`);
  scrub.max = N;

  let view = null, current = 1;
  let pf = null, mode = null, size = null, pages = [], visible = [0]; // book view
  let sv = null; // scroll view: { el, col, s, base, io }

  // Shared position UI: counter, scrubber, prev/next, URL.
  function setPosition(first, last, atStart, atEnd) {
    current = first;
    counter.textContent = `${last && last !== first ? `${first}–${last}` : first} / ${N}`;
    scrub.value = first;
    prevBtn.disabled = atStart;
    nextBtn.disabled = atEnd;
    history.replaceState(null, "", `?issue=${issue.id}#p${first}`);
  }

  // ========== Book view ==========

  // Book order. In spread mode with an odd page count, a blank paper page goes before the back
  // cover so the back cover closes the book on its own (as in print). Entries: real page number or 0.
  const order = () => {
    const list = Array.from({ length: N }, (_, i) => i + 1);
    if (mode === "spread" && N % 2 === 1) list.splice(N - 1, 0, 0);
    return list;
  };
  const toBook = (p) => pages.indexOf(clampPage(p));

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
    visible = vis;
    const real = vis.map((k) => pages[k]).filter(Boolean);
    for (let k = vis[0] - LOOK_BEHIND; k <= vis[vis.length - 1] + LOOK_AHEAD; k++) load(k);
    setPosition(real[0] ?? pages[vis[0] - 1] ?? N, real[1], vis[0] === 0, vis[vis.length - 1] >= pages.length - 1);
  }

  function buildBook(startPage) {
    closeZoom();
    const m = measure();
    mode = m.mode; size = m;
    pages = order();

    // pf.destroy() removes its root element, so put the fresh book in place first.
    const old = $("book");
    const book = document.createElement("div");
    book.className = "book";
    if (old) old.after(book); else stage.prepend(book);
    if (pf) pf.destroy();
    old?.remove();
    book.id = "book";
    book.style.width = `${mode === "spread" ? 2 * m.pw : m.pw}px`;
    book.style.height = `${m.ph}px`;
    book.innerHTML = pages.map((p, i) => p
      ? `<div class="pg" data-i="${i}"><span class="ph">${pad3(p)}</span><img alt="Полоса ${p}" decoding="async"></div>`
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

  function destroyBook() {
    closeZoom();
    if (pf) { pf.destroy(); pf = null; } // also removes #book
    $("book")?.remove();
  }

  // ========== Scroll view ==========

  const scrollMax = () => Math.max(2, issue.page_size[0] / sv.base); // up to the image's own pixels

  function buildScroll(startPage) {
    $("book")?.remove(); // the empty placeholder from read.html when the page opens in this view
    const el = document.createElement("div");
    el.className = "scroll";
    el.tabIndex = -1; // focusable, so arrow keys and Page Up/Down scroll it
    el.innerHTML = `<div class="scroll-col">${Array.from({ length: N }, (_, i) =>
      `<div class="sp" data-p="${i + 1}"><span class="ph">${pad3(i + 1)}</span><img alt="Полоса ${i + 1}" decoding="async"></div>`).join("")}</div>`;
    stage.append(el);
    sv = { el, col: el.firstElementChild, s: 1, base: 0 };
    sv.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const img = en.target.querySelector("img");
        img.onload = () => en.target.classList.add("is-loaded");
        img.src = pageUrl(Number(en.target.dataset.p));
        sv.io.unobserve(en.target);
      }
    }, { root: el, rootMargin: "1500px 0px" });
    sv.col.querySelectorAll(".sp").forEach((n) => sv.io.observe(n));
    layoutScroll();
    scrollToPage(startPage);
    let raf = 0;
    el.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; trackScroll(); }); }, { passive: true });
    trackScroll();
    el.focus({ preventScroll: true });
  }

  function destroyScroll() {
    if (!sv) return;
    sv.io.disconnect();
    sv.el.remove();
    sv = null;
  }

  function layoutScroll() {
    const padX = parseFloat(getComputedStyle(stage).paddingLeft);
    sv.base = Math.min(stage.clientWidth - 2 * padX, 960);
    sv.s = Math.min(sv.s, scrollMax());
    sv.col.style.width = `${Math.round(sv.base * sv.s)}px`;
  }

  // Page geometry in scroll coordinates (pages are equal, so it's arithmetic). Fractional rects,
  // not offsetTop: rounded offsets drift by a pixel every few pages.
  function scrollGeom() {
    const a = sv.col.children[0].getBoundingClientRect(), b = sv.col.children[1]?.getBoundingClientRect();
    const top0 = a.top - sv.el.getBoundingClientRect().top + sv.el.scrollTop;
    return { top0, step: b ? b.top - a.top : a.height, h: a.height };
  }

  // The page lands one gap below the top edge, so the previous page ends just above the edge
  // (+1 px against fractional rounding; a padding-sized offset would leave a sliver of it showing).
  function scrollToPage(p, smooth = false) {
    const g = scrollGeom(), n = clampPage(p);
    sv.el.scrollTo({ top: n === 1 ? 0 : g.top0 + (n - 1) * g.step - (g.step - g.h) + 1, behavior: smooth ? "smooth" : "auto" });
  }

  // Current page = the one crossing a line 35% down the viewport (the last one at the very bottom).
  function trackScroll() {
    const el = sv.el, g = scrollGeom();
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    const p = atBottom ? N : clampPage(Math.floor((el.scrollTop + el.clientHeight * 0.35 - g.top0) / g.step) + 1);
    setPosition(p, null, p === 1, p === N);
  }

  // Keep the spot under the viewport center in place across a relayout (zoom, resize).
  function keepScrollAnchor(relayout) {
    const el = sv.el, g = scrollGeom();
    const yc = el.scrollTop + el.clientHeight / 2, idx = Math.floor((yc - g.top0) / g.step);
    const fy = (yc - g.top0 - idx * g.step) / g.h;
    const fx = (el.scrollLeft + el.clientWidth / 2 - sv.col.offsetLeft) / sv.col.offsetWidth;
    relayout();
    const g2 = scrollGeom();
    el.scrollTop = g2.top0 + idx * g2.step + fy * g2.h - el.clientHeight / 2;
    el.scrollLeft = sv.col.offsetLeft + fx * sv.col.offsetWidth - el.clientWidth / 2;
  }

  function scrollZoom(factor) {
    const s = Math.min(scrollMax(), Math.max(1, sv.s * factor));
    if (Math.abs(s - sv.s) < 0.001) return;
    keepScrollAnchor(() => { sv.s = s; layoutScroll(); });
    updateZoomButtons();
  }

  // ========== Zoom (book view) ==========
  // StPageFlip sets touch-action: pan-y on the book and preventDefaults touch moves, so the browser's
  // pinch-zoom never happens there. Instead: pinch, double tap, ctrl+wheel (trackpad pinch) or the
  // +/− buttons open the visible page(s) in a layer over the stage at full resolution. One finger or
  // the mouse pans; pinching back below 1×, −, ×, Esc or a double tap closes it. Touches are handled
  // on window in the capture phase so a pinch that starts on the book never reaches the library.
  // In the scroll view none of this runs: pinch and double tap are the browser's own.
  // dragStart: where a one-finger touch on the book began (for finishing slow drags, see onTouchEnd).
  let dragStart = null;
  // swallowRest: after a pinch closes the zoom, fingers still down are ignored until all lift.
  let zoom = null, gesture = null, swallowRest = false, touchesDown = 0, lastTap = { t: 0, x: 0, y: 0 };
  const maxScale = () => Math.max(2, issue.page_size[0] / size.pw); // up to the image's own pixels
  const stagePt = (c) => { const r = stage.getBoundingClientRect(); return { x: c.clientX - r.left, y: c.clientY - r.top }; };
  const inStage = (c) => { const r = stage.getBoundingClientRect(); return c.clientX >= r.left && c.clientX <= r.right && c.clientY >= r.top && c.clientY <= r.bottom; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const swallow = (e) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); };

  function openZoom() {
    const real = visible.map((k) => pages[k]).filter(Boolean);
    if (zoom || view !== "book" || !real.length) return zoom;
    const el = document.createElement("div");
    el.className = "zoom";
    el.innerHTML = `<div class="zoom-sheet">${real.map((p) => `<img src="${pageUrl(p)}" alt="Полоса ${p}" draggable="false">`).join("")}</div>
      <button class="btn zoom-close" aria-label="Закрыть увеличение">×</button>`;
    stage.append(el);
    const W = stage.clientWidth, H = stage.clientHeight, w = real.length * size.pw, h = size.ph;
    zoom = { el, sheet: el.firstElementChild, W, H, w, h, s: 1, tx: (W - w) / 2, ty: (H - h) / 2 };
    Object.assign(zoom.sheet.style, { width: `${w}px`, height: `${h}px` });
    el.querySelector(".zoom-close").onclick = closeZoom;
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("dblclick", (e) => { const p = stagePt(e); zoom.s > 1.05 ? closeZoom() : zoomAt(2.5, p.x, p.y, true); });
    applyZoom();
    return zoom;
  }

  function closeZoom() {
    if (!zoom) return;
    // A finger still down keeps targeting the element it touched; a removed element no longer
    // delivers its touch events to window. So hide the layer now and remove it after the last lift.
    if (touchesDown) { zoom.el.hidden = true; zoom.el.classList.add("is-closed"); }
    else zoom.el.remove();
    zoom = gesture = null;
    // A pinch that began on the book left the library mid-touch; end it without flipping. Its
    // delayed touch timer (~250 ms) can still fire, so repeat once when no finger is down.
    if (pf) pf.userStop({ x: 0, y: 0 }, true);
    setTimeout(() => { if (!zoom && !touchesDown && pf) pf.userStop({ x: 0, y: 0 }, true); }, 300);
    updateZoomButtons();
  }

  function applyZoom(animate = false) {
    const z = zoom, sw = z.w * z.s, sh = z.h * z.s;
    z.tx = sw <= z.W ? (z.W - sw) / 2 : Math.min(0, Math.max(z.W - sw, z.tx));
    z.ty = sh <= z.H ? (z.H - sh) / 2 : Math.min(0, Math.max(z.H - sh, z.ty));
    z.sheet.style.transition = animate ? "transform .2s ease" : "none";
    z.sheet.style.transform = `translate(${z.tx}px, ${z.ty}px) scale(${z.s})`;
    updateZoomButtons();
  }

  // Scale to s keeping the stage point (px, py) under the same spot of the page.
  function zoomAt(s, px, py, animate) {
    const z = zoom, cx = (px - z.tx) / z.s, cy = (py - z.ty) / z.s;
    z.s = Math.min(maxScale(), Math.max(1, s));
    z.tx = px - cx * z.s; z.ty = py - cy * z.s;
    applyZoom(animate);
  }

  function zoomStep(factor) {
    if (!zoom) { if (factor < 1 || !openZoom()) return; }
    const s = zoom.s * factor;
    if (s <= 1.01) closeZoom();
    else zoomAt(s, zoom.W / 2, zoom.H / 2, true);
  }

  function updateZoomButtons() {
    if (view === "scroll" && sv) {
      zoomOutBtn.disabled = sv.s <= 1.001;
      zoomInBtn.disabled = sv.s >= scrollMax() - 0.01;
    } else {
      zoomOutBtn.disabled = !zoom;
      zoomInBtn.disabled = !!zoom && zoom.s >= maxScale() - 0.01;
    }
  }

  function startGesture(touches) {
    const ts = [...touches].map(stagePt);
    gesture = ts.length >= 2
      ? { pinch: true, d0: dist(ts[0], ts[1]) || 1, s0: zoom.s, raw: zoom.s, m0: { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 }, t0: { x: zoom.tx, y: zoom.ty } }
      : { pinch: false, p0: ts[0], t0: { x: zoom.tx, y: zoom.ty }, moved: false };
  }

  // Double tap: returns true when this tap completes one.
  function isDoubleTap(p) {
    const now = Date.now(), hit = now - lastTap.t < 320 && dist(p, lastTap) < 30;
    lastTap = hit ? { t: 0, x: 0, y: 0 } : { t: now, ...p };
    return hit;
  }

  window.addEventListener("touchstart", (e) => {
    touchesDown = e.touches.length;
    // A fresh single touch means every earlier finger is up, whatever events were missed.
    if (e.touches.length === 1) swallowRest = false;
    if (swallowRest) { swallow(e); return; }
    if (view !== "book") return;
    if (!zoom) {
      dragStart = e.touches.length === 1 ? { x: e.touches[0].clientX } : null;
      if (e.touches.length === 2 && inStage(e.touches[0]) && inStage(e.touches[1]) && openZoom()) { swallow(e); startGesture(e.touches); }
      return;
    }
    if (!zoom.el.contains(e.target) || e.target.closest(".zoom-close")) return;
    swallow(e);
    startGesture(e.touches);
  }, { capture: true, passive: false });

  window.addEventListener("touchmove", (e) => {
    if (swallowRest) { swallow(e); return; }
    if (!zoom || !gesture) return;
    swallow(e);
    const ts = [...e.touches].map(stagePt), g = gesture;
    if (g.pinch && ts.length >= 2) {
      const m = { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 };
      g.raw = g.s0 * dist(ts[0], ts[1]) / g.d0;
      const s = Math.min(maxScale(), Math.max(1, g.raw));
      zoom.s = s;
      zoom.tx = m.x - (g.m0.x - g.t0.x) / g.s0 * s;
      zoom.ty = m.y - (g.m0.y - g.t0.y) / g.s0 * s;
      applyZoom();
    } else if (!g.pinch && ts.length === 1) {
      if (dist(ts[0], g.p0) > 8) g.moved = true;
      zoom.tx = g.t0.x + ts[0].x - g.p0.x;
      zoom.ty = g.t0.y + ts[0].y - g.p0.y;
      applyZoom();
    }
  }, { capture: true, passive: false });

  const onTouchEnd = (e) => {
    touchesDown = e.touches.length;
    if (!touchesDown) stage.querySelectorAll(".zoom.is-closed").forEach((el) => el.remove());
    if (swallowRest) { swallow(e); if (!e.touches.length) swallowRest = false; return; }
    if (view !== "book") return;
    if (!zoom) {
      const t = e.changedTouches[0];
      // One-page mode: on release the library decides by which side of the spine (the page's left
      // edge) the dragged corner is on — forward drags must reach the screen edge, backward drags turn
      // after a few pixels. Decide ourselves: turn only past a quarter of the page in the drag's
      // direction, and put the fold on the matching side of the spine just before the library sees the
      // lift. Direction follows the library: a drag starting in the left 40% of the page goes back.
      if (mode === "single" && pf && dragStart && t && e.touches.length === 0 && pf.getState() === "user_fold") {
        const block = document.querySelector("#book .stf__block").getBoundingClientRect();
        const back = dragStart.x - block.left <= 0.4 * size.pw, dx = t.clientX - dragStart.x;
        const turn = back ? dx > size.pw / 4 : dx < -size.pw / 4;
        // Forward: left of the spine = turned. Backward: the incoming page is turned once right of it.
        pf.userMove({ x: turn !== back ? -0.05 * size.pw : 1.05 * size.pw, y: t.clientY - block.top }, true);
      }
      if (e.touches.length === 0) dragStart = null;
      // Double tap on the page opens the zoom at that point.
      if (e.touches.length === 0 && t && inStage(t) && isDoubleTap(stagePt(t)) && openZoom()) {
        swallow(e);
        const p = stagePt(t);
        zoomAt(2.5, p.x, p.y, true);
      }
      return;
    }
    if (!gesture) return;
    swallow(e);
    const g = gesture;
    // Fingers lift one at a time: a pinch decides on the first lift.
    if (g.pinch && (g.raw < 0.9 || zoom.s <= 1.01)) { closeZoom(); swallowRest = e.touches.length > 0; return; }
    if (e.touches.length > 0) { startGesture(e.touches); gesture.moved = true; return; }
    gesture = null;
    if (g.pinch) return;
    if (!g.moved && isDoubleTap(g.p0)) zoom.s > 1.05 ? closeZoom() : zoomAt(2.5, g.p0.x, g.p0.y, true);
  };
  window.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
  window.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: false });

  // Mouse: drag to pan, wheel to zoom; ctrl+wheel (trackpad pinch) over the book opens the zoom.
  function onWheel(e) {
    e.preventDefault();
    const p = stagePt(e), s = zoom.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
    if (s <= 1.001 && e.deltaY > 0) closeZoom();
    else zoomAt(s, p.x, p.y);
  }
  stage.addEventListener("wheel", (e) => {
    if (view !== "book" || zoom || !e.ctrlKey || e.deltaY >= 0) return;
    e.preventDefault();
    if (openZoom()) onWheel(e);
  }, { passive: false });

  function onMouseDown(e) {
    if (e.button !== 0 || e.target.closest(".zoom-close")) return;
    e.preventDefault();
    const p0 = stagePt(e), t0 = { x: zoom.tx, y: zoom.ty };
    zoom.el.classList.add("is-dragging");
    const move = (ev) => { const p = stagePt(ev); zoom.tx = t0.x + p.x - p0.x; zoom.ty = t0.y + p.y - p0.y; applyZoom(); };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); zoom?.el.classList.remove("is-dragging"); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // ========== Views, navigation, keys ==========

  function setView(v) {
    if (v === view) return;
    const p = current;
    if (view === "book") destroyBook();
    else if (view === "scroll") destroyScroll();
    view = v;
    document.body.dataset.view = v;
    for (const [k, btn] of Object.entries(viewBtns)) btn.setAttribute("aria-pressed", String(k === v));
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode: just don't remember */ }
    if (v === "book") buildBook(p); else buildScroll(p);
    updateZoomButtons();
  }

  const goTo = (p) => {
    if (view === "scroll") return scrollToPage(p);
    closeZoom();
    pf.turnToPage(toBook(p));
    onPage(pf.getCurrentPageIndex());
  };
  const next = () => (view === "scroll" ? scrollToPage(current + 1, true) : (closeZoom(), pf.flipNext()));
  const prev = () => (view === "scroll" ? scrollToPage(current - 1, true) : (closeZoom(), pf.flipPrev()));
  const zoomBy = (f) => (view === "scroll" ? scrollZoom(f) : zoomStep(f));

  viewBtns.book.onclick = () => setView("book");
  viewBtns.scroll.onclick = () => setView("scroll");
  zoomInBtn.onclick = () => zoomBy(1.6);
  zoomOutBtn.onclick = () => zoomBy(1 / 1.6);
  prevBtn.onclick = prev;
  nextBtn.onclick = next;
  scrub.oninput = () => goTo(Number(scrub.value));

  document.addEventListener("keydown", (e) => {
    if (e.target === scrub || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "+" || k === "=") zoomBy(1.6);
    else if (k === "-") zoomBy(1 / 1.6);
    else if (k === "Escape") closeZoom();
    else if (k === "ArrowRight") next();
    else if (k === "ArrowLeft") prev();
    else if (k === "Home") goTo(1);
    else if (k === "End") goTo(N);
    // Space / Page Up / Page Down turn pages in the book; in the scroll view they scroll natively.
    else if (view === "book" && (k === "PageDown" || k === " ")) next();
    else if (view === "book" && k === "PageUp") prev();
    else return;
    e.preventDefault();
  });

  let t;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (view === "scroll") { keepScrollAnchor(layoutScroll); updateZoomButtons(); return; }
      const m = measure();
      if (m.mode !== mode || m.pw !== size.pw || m.ph !== size.ph) buildBook(current);
    }, 150);
  });

  // Editing #pN in the address bar is an in-page navigation, not a reload: follow it.
  window.addEventListener("hashchange", () => {
    const p = parseInt((location.hash.match(/^#p(\d+)$/) || [])[1]);
    if (p && p !== current) goTo(p);
  });

  let saved = null;
  try { saved = localStorage.getItem(VIEW_KEY); } catch { /* unavailable */ }
  current = clampPage(parseInt((location.hash.match(/^#p(\d+)$/) || [])[1]) || 1);
  setView((params.get("view") || saved) === "scroll" ? "scroll" : "book");
})();
