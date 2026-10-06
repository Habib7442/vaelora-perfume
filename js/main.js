/* =========================================================================
   VAELORA — main.js
   Lenis + GSAP (ScrollTrigger, SplitText) setup and section choreography.
   Native scroll drives everything; Lenis only smooths wheel input on desktop.
   ========================================================================= */
(function () {
  'use strict';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const root = document.documentElement;

  /* ---------- Bail out gracefully if the CDN scripts failed ---------- */
  if (!window.gsap || !window.ScrollTrigger || !window.SplitText || !window.ImageSequence) {
    root.classList.remove('js');
    const pre = $('#preloader');
    if (pre) pre.remove();
    $$('.seq-static').forEach((img) => {
      img.src = img.id === 'heroStatic' ? 'assets/seq/hero-d/0150.webp' : 'assets/seq/notes-d/0150.webp';
      img.hidden = false;
    });
    return;
  }

  gsap.registerPlugin(ScrollTrigger, SplitText);
  ScrollTrigger.config({ ignoreMobileResize: true });
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  const BP = {
    isDesktop: '(min-width: 1024px)',
    isTablet: '(min-width: 768px) and (max-width: 1023px)',
    isMobile: '(max-width: 767px)',
    reduce: '(prefers-reduced-motion: reduce)',
    portrait: '(orientation: portrait)',
  };
  const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const startReduced = matchMedia(BP.reduce).matches;

  /* ---------- Capture mode (?capture=1) — frame-perfect recording by an external script ----
     Normal visitors never get here. With ?capture=1: no Lenis, GSAP time only advances when
     the recorder calls __captureStep, scrubs are instant, no snapping, no CSS transitions,
     no cursor/scrollbar, no preloader, every image and sequence frame preloaded. */
  const CAPTURE = new URLSearchParams(location.search).get('capture') === '1';
  const SCRUB = CAPTURE ? true : 0.5;
  let captureBase = 0;
  if (CAPTURE) {
    root.classList.add('is-capture');
    gsap.ticker.remove(gsap.updateRoot);      // the recorder drives time via gsap.updateRoot()
    gsap.ticker.lagSmoothing(0);
    captureBase = gsap.ticker.time;
  }

  /* ---------- Sequences ---------- */
  const SEQ = {
    hero:  { canvas: '#heroCanvas',  img: '#heroStatic',  d: ['assets/seq/hero-d', 150],  m: ['assets/seq/hero-m', 90] },
    notes: { canvas: '#notesCanvas', img: '#notesStatic', d: ['assets/seq/notes-d', 150], m: ['assets/seq/notes-m', 90] },
  };
  const seqs = {};   // key "hero-d" → ImageSequence (only the variant in use is kept alive)

  function getSeq(name, v) {
    const key = `${name}-${v}`;
    // Both variants draw into the same canvas, so drop the one we're not using.
    Object.keys(seqs).forEach((k) => {
      if (k.startsWith(name + '-') && k !== key) { seqs[k].destroy(); delete seqs[k]; }
    });
    if (!seqs[key]) {
      const [folder, frameCount] = SEQ[name][v];
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || '#E6EAE6';
      seqs[key] = new ImageSequence({
        canvas: $(SEQ[name].canvas), folder, frameCount, ext: 'webp',
        maxDpr: CAPTURE ? Math.min(window.devicePixelRatio || 1, 3) : v === 'm' ? 1 : 1.5,
        concurrency: v === 'm' ? 4 : 6,
        bg,
        // Hero: the canvas is the frame box (CSS vars from layoutHero) with a radial mask;
        // the frame is drawn transparent around its feathered edges.
        ...(name === 'hero' ? { fit: 'contain', transparent: true, feather: 0.14 } : {}),
        // Notes: same idea. Desktop frames get no top/bottom fade (the floating cap and the
        // base touch those edges in the source); CSS handles a short vertical soften.
        ...(name === 'notes' ? { fit: 'contain', transparent: true, feather: v === 'm' ? 0.06 : 0.1, featherY: v === 'm' ? 0.06 : 0 } : {}),
      });
    }
    return seqs[key];
  }

  function lastFrameSrc(name, v) {
    const [folder, count] = SEQ[name][v];
    return `${folder}/${String(count).padStart(4, '0')}.webp`;
  }

  /* ---------- Lenis (smooth wheel on desktop; native touch scroll) ---------- */
  let lenis = null;
  if (!startReduced && !CAPTURE && window.Lenis) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true, syncTouch: false, autoRaf: false });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  const lockScroll = (on) => {
    root.style.overflow = on ? 'hidden' : '';
    if (lenis) on ? lenis.stop() : lenis.start();
  };

  /* ---------- Splits created once ---------- */
  const heroSplit = SplitText.create('.hero__word-l, .hero__word-r', { type: 'chars', mask: 'chars' });
  const preSplit = SplitText.create('#preloaderWord', { type: 'chars', mask: 'chars' });

  /* =========================================================================
     NAV + MENU
     ========================================================================= */
  const nav = $('#nav');
  ScrollTrigger.create({
    start: 50, end: 'max',
    onToggle: (self) => nav.classList.toggle('is-scrolled', self.isActive),
  });

  const menu = $('#menu');
  const burger = $('#burger');
  const menuTl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } })
    .set(menu, { visibility: 'visible' })
    .to(menu, { opacity: 1, duration: 0.45, ease: 'power2.out' })
    .fromTo('.menu__links a span', { yPercent: 110 }, { yPercent: 0, duration: 0.9, stagger: 0.07 }, 0.1)
    .fromTo('.menu__foot', { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0.35);
  let menuOpen = false;

  function setMenu(open) {
    if (open === menuOpen) return;
    menuOpen = open;
    root.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.setAttribute('aria-hidden', String(!open));
    lockScroll(open);
    open ? menuTl.timeScale(1).play() : menuTl.timeScale(1.6).reverse();
  }
  burger.addEventListener('click', () => setMenu(!menuOpen));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  // Anchor links → smooth scroll (Lenis) or native
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = $(id);
      if (!target) return;
      e.preventDefault();
      const wasOpen = menuOpen;
      setMenu(false);
      const go = () => {
        // A pinned section's top lives inside its pin-spacer: scroll to the spacer.
        const el = target.parentElement && target.parentElement.classList.contains('pin-spacer') ? target.parentElement : target;
        const y = id === '#home' ? 0 : el.getBoundingClientRect().top + window.scrollY;
        if (lenis) lenis.scrollTo(y, { duration: 1.6 });
        else window.scrollTo({ top: y, behavior: startReduced ? 'auto' : 'smooth' });
      };
      wasOpen ? setTimeout(go, 350) : go();
    });
  });

  /* =========================================================================
     CAROUSEL (shared by motion + reduced-motion modes)
     ========================================================================= */
  const carousel = (() => {
    const wrap = $('#carousel');
    const ring = $('#carouselRing');
    const items = $$('.carousel__item', ring);
    const imgs = items.map((el) => $('img', el));
    const N = items.length;
    const STEP = 360 / N;
    const nameEl = $('#carName');
    const priceEl = $('#carPrice');
    const state = { scroll: 0, offset: 0 };
    const P = 1600;                 // same perspective the parent declares
    const TILT = (3 * Math.PI) / 180; // a whisper of camera tilt (≤4°): back rows sit a touch higher
    const shadow = $('#carShadow');
    const geo = { R: 400, h: 300, w: 240 };
    let front = -1;

    // Depth styling from c = cos(angle to the front): front 1 → sides 0 → back -1.
    const scaleAt = (c) => (c >= 0 ? 0.65 + 0.35 * c : 0.65 + 0.25 * c);  // 1 / 0.65 / 0.4
    const opacityAt = (c) => (c >= 0 ? 0.6 + 0.4 * c : 0.6 + 0.35 * c);   // 1 / 0.6 / 0.25
    const blurAt = (c) => 1 - c;                                           // 0 / 1 / 2 px

    // Item i at rotation `rot` on the cylinder rotateY(i·60°) translateZ(R), seen through a
    // 1600px perspective. y is the (tiny) tilt lift of the baseline for items further back.
    function place(i, rot) {
      const r = ((i * STEP - rot) * Math.PI) / 180, c = Math.cos(r);
      const p = P / (P + geo.R * (1 - c));
      return { c, x: geo.R * Math.sin(r) * p, y: -geo.R * (1 - c) * Math.sin(TILT) * p, s: scaleAt(c) };
    }

    function layout() {
      const vw = wrap.clientWidth || window.innerWidth;
      const vh = window.innerHeight;
      const mobile = matchMedia(BP.isMobile).matches, tablet = matchMedia(BP.isTablet).matches;
      // Front bottle height: desktop clamp(280px, 52vh, 560px) · tablet 45vh · mobile 40vh,
      // capped so heading (+48px) + bottles + caption (+32px) always fit one viewport.
      const stage = wrap.parentElement, cs = getComputedStyle(stage);
      const head = $('.section-head', stage), controls = $('.carousel__controls', stage);
      const room = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
        - head.offsetHeight - 48 - 32 - controls.offsetHeight;
      const want = mobile ? vh * 0.4 : tablet ? vh * 0.45 : Math.min(560, Math.max(280, vh * 0.52));
      const h = Math.max(120, Math.min(want, room));
      // Radius: side bottles (±60°) centred at ~24% / 76% of the width on desktop & tablet,
      // ~17% / 83% on phones. Solve R for that projected offset (the 1600px perspective pulls
      // the sides inward, so the cylinder radius itself ends up ≈ 34vw / 36vw / 48vw).
      const off = vw * (mobile ? 0.33 : 0.26);
      const R = (off * P) / (0.866 * P - 0.5 * off);
      Object.assign(geo, { R, h, w: h * 0.8 });
      wrap.style.setProperty('--cw', `${geo.w.toFixed(1)}px`);
      wrap.style.setProperty('--ch', `${h.toFixed(1)}px`);
      // The stage is top-aligned, so the pinned screen ends with a band of empty grey under the
      // caption. "Made for Every Moment" rises over that band (less 24px) so the gap between the
      // two sections stays ≈16vh. Not on phones (swipe carousel, no pin).
      const moment = $('.moment');
      const swipe = $('#ultimate').classList.contains('ultimate--swipe');
      const band = stage.getBoundingClientRect().bottom - controls.getBoundingClientRect().bottom;
      moment.style.marginTop = !swipe && !startReduced && band > 48 ? `${-Math.round(band - 24)}px` : '';
      render();
    }

    function render() {
      const rot = state.scroll + state.offset;
      let nearest = -1;
      for (let i = 0; i < N; i++) {
        const { c, x, y, s } = place(i, rot);
        const blur = blurAt(c);
        nearest = Math.max(nearest, c);
        items[i].style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
        items[i].style.zIndex = String(Math.round(((c + 1) / 2) * 100));   // depth-sorted: nearer on top
        items[i].style.opacity = opacityAt(c).toFixed(3);
        imgs[i].style.filter = blur > 0.02 ? `blur(${blur.toFixed(2)}px)` : 'none';
      }
      // the floor shadow belongs to a bottle that is actually at the front
      shadow.style.opacity = Math.pow(Math.max(0, nearest), 24).toFixed(3);
      const f = ((Math.round(rot / STEP) % N) + N) % N;
      if (f !== front) {
        front = f;
        nameEl.textContent = items[f].dataset.name;
        priceEl.textContent = `${items[f].dataset.price} · 100 ml`;
        items.forEach((el, i) => el.setAttribute('aria-hidden', String(i !== f)));
      }
    }

    function snapBy(steps) {
      const total = state.scroll + state.offset;
      const target = (Math.round(total / STEP) + steps) * STEP;
      gsap.to(state, {
        offset: target - state.scroll,
        duration: startReduced ? 0.01 : 0.9, ease: 'power3.out',
        onUpdate: render, overwrite: true,
      });
    }

    $('#carPrev').addEventListener('click', () => snapBy(-1));
    $('#carNext').addEventListener('click', () => snapBy(1));
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') snapBy(-1);
      if (e.key === 'ArrowRight') snapBy(1);
    });

    // Swipe / drag (horizontal only; vertical stays native thanks to touch-action: pan-y)
    let startX = 0, startY = 0, startOffset = 0, dragging = false, decided = false, pid = null;
    wrap.addEventListener('pointerdown', (e) => {
      pid = e.pointerId; startX = e.clientX; startY = e.clientY;
      startOffset = state.offset; dragging = false; decided = false;
    });
    wrap.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!decided && Math.hypot(dx, dy) > 8) {
        decided = true;
        dragging = Math.abs(dx) > Math.abs(dy);
        if (dragging) { gsap.killTweensOf(state); wrap.setPointerCapture(pid); }
      }
      if (dragging) { state.offset = startOffset - dx * (STEP / (items[0].offsetWidth * 1.2)); render(); }
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (dragging) snapBy(0);
      dragging = false;
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.tabIndex = 0;

    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 150); }, { passive: true });
    ScrollTrigger.addEventListener('refreshInit', layout);              // heading height can change
    if (document.fonts) document.fonts.addEventListener('loadingdone', layout);
    layout();

    return {
      setScroll(deg) { state.scroll = deg; render(); },
      layout,
    };
  })();

  /* =========================================================================
     MOBILE SWIPE CAROUSEL (≤767px) — replaces the 3D ring on phones.
     Built from the ring's own items (one source of truth), torn down by matchMedia.
     Native scroll-snap does the swiping; depth styling follows the scroll position.
     ========================================================================= */
  let swipeIndex = 0;               // remembered across rebuilds (rotation, resizes)

  function buildSwipeCarousel() {
    const section = $('#ultimate');
    const stage = $('.ultimate__stage', section);
    const head = $('.section-head', stage);
    const items = $$('.carousel__item');
    const make = (tag, cls, attrs = {}) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      return el;
    };
    const arrowSvg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

    const root = make('div', 'mcar');
    const track = make('div', 'mcar__track', { tabindex: '0', role: 'group', 'aria-roledescription': 'carousel', 'aria-label': 'The Ultimate Collection, swipe to browse' });
    const boxes = items.map((item, i) => {
      const src = $('img', item);
      const slide = make('figure', 'mcar__slide', { 'aria-roledescription': 'slide', 'aria-label': `${i + 1} of ${items.length}: ${item.dataset.name}` });
      const box = make('div', 'mcar__box');
      const img = make('img', '', {
        src: src.getAttribute('src'), srcset: src.getAttribute('srcset'), sizes: '72vw',
        alt: src.getAttribute('alt'), width: src.getAttribute('width'), height: src.getAttribute('height'),
        loading: i < 2 ? 'eager' : 'lazy', decoding: 'async', draggable: 'false',
      });
      box.appendChild(img); slide.appendChild(box); track.appendChild(slide);
      return box;
    });
    const caption = make('div', 'mcar__caption', { 'aria-live': 'polite' });
    const nameEl = make('p', 'mcar__name');
    const priceEl = make('p', 'mcar__price');
    caption.append(nameEl, priceEl);
    const nav = make('div', 'mcar__nav');
    const prev = make('button', 'mcar__arrow', { type: 'button', 'aria-label': 'Previous fragrance' });
    const next = make('button', 'mcar__arrow', { type: 'button', 'aria-label': 'Next fragrance' });
    prev.innerHTML = arrowSvg('M19 12H5M11 6l-6 6 6 6');
    next.innerHTML = arrowSvg('M5 12h14M13 6l6 6-6 6');
    const dotsWrap = make('div', 'mcar__dots');
    const dots = items.map((item, i) => {
      const d = make('button', 'mcar__dot', { type: 'button', 'aria-label': `Show ${item.dataset.name}` });
      d.addEventListener('click', () => goTo(i));
      dotsWrap.appendChild(d);
      return d;
    });
    nav.append(prev, dotsWrap, next);
    root.append(track, caption, nav);
    head.after(root);
    section.classList.add('ultimate--swipe');

    const N = items.length;
    let active = -1;
    let raf = 0;
    const slideW = () => track.firstElementChild.offsetWidth || 1;

    function setActive(i) {
      if (i === active) return;
      const first = active < 0;
      active = swipeIndex = i;
      dots.forEach((d, k) => { d.classList.toggle('is-active', k === i); d.toggleAttribute('aria-current', k === i); });
      prev.disabled = i === 0;
      next.disabled = i === N - 1;
      const write = () => {
        nameEl.textContent = items[i].dataset.name;
        priceEl.textContent = `${items[i].dataset.price} · 100 ml`;
      };
      if (first || startReduced) { write(); return; }
      gsap.timeline({ defaults: { overwrite: true } })            // crossfade: out, swap, in
        .to([nameEl, priceEl], { autoAlpha: 0, y: -6, duration: 0.15, ease: 'power1.in' })
        .add(write)
        .fromTo([nameEl, priceEl], { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.32, ease: 'power2.out', stagger: 0.04 });
    }

    // Bottle aspect (trimmed images: width/height attributes are the real glass ratio)
    const ratios = boxes.map((box) => { const im = box.firstElementChild; return (+im.getAttribute('width') || 4) / (+im.getAttribute('height') || 5); });

    // Depth without 3D: t = distance of each slide from the centre, in slide widths.
    // Active (t=0): scale 1, opacity 1, sharp. Neighbours (t>=1): scale .75, opacity .35, 1px blur.
    // A receding bottle also slides toward the inner edge of its slide, so the previous/next
    // bottles visibly peek ~14vw in from each side instead of sitting mostly off-screen.
    function update() {
      raf = 0;
      const W = slideW();
      const H = boxes[0].clientHeight || 1;
      const pos = track.scrollLeft / W;
      boxes.forEach((box, i) => {
        const t = Math.min(1, Math.abs(i - pos));
        const drawn = Math.min(W, H * ratios[i]);                       // bottle width at scale 1
        const shift = Math.max(0, (W - 0.75 * drawn) / 2 - 8) * t * Math.sign(pos - i);
        box.style.transform = `translateX(${shift.toFixed(1)}px) scale(${(1 - 0.25 * t).toFixed(3)})`;
        box.style.opacity = (1 - 0.65 * t).toFixed(3);
        box.style.filter = t > 0.02 ? `blur(${t.toFixed(2)}px)` : 'none';
      });
      setActive(Math.max(0, Math.min(N - 1, Math.round(pos))));
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };

    function goTo(i, instant) {
      i = Math.max(0, Math.min(N - 1, i));
      track.scrollTo({ left: i * slideW(), behavior: instant || startReduced ? 'auto' : 'smooth' });
    }
    const onPrev = () => goTo(active - 1);
    const onNext = () => goTo(active + 1);

    track.addEventListener('scroll', onScroll, { passive: true });
    prev.addEventListener('click', onPrev);
    next.addEventListener('click', onNext);
    // keep the same bottle centred when the slide width changes (rotation, resize)
    const ro = new ResizeObserver(() => { goTo(active < 0 ? swipeIndex : active, true); update(); });
    ro.observe(track);

    goTo(swipeIndex, true);
    update();

    return {
      head,
      track,
      update,
      destroy() {
        cancelAnimationFrame(raf);
        ro.disconnect();
        track.removeEventListener('scroll', onScroll);
        gsap.killTweensOf([nameEl, priceEl]);
        root.remove();
        section.classList.remove('ultimate--swipe');
      },
    };
  }

  /* =========================================================================
     Shared helpers
     ========================================================================= */
  function splitLines(el, vars) {
    return SplitText.create(el, {
      type: 'lines', mask: 'lines', autoSplit: true,
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 100, duration: 1.2, ease: 'expo.out', stagger: 0.12,
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
          ...vars,
        });
      },
    });
  }

  let heroIntro = null;     // built per-mode, played when the preloader leaves
  let setupDoneResolve;
  const setupDone = new Promise((r) => { setupDoneResolve = r; });   // deferred section setup finished
  let introPlayed = false;

  /* =========================================================================
     HERO LAYOUT — the frame is contain-fitted into a box below the nav, so the whole
     bottle (cap → reflection) is always visible. "VAE" / "LORA" sit either side of
     that box; when the sides are too narrow (phones, portrait tablets) the word
     stacks above the bottle instead. Writes CSS vars the stylesheet reads.
     ========================================================================= */
  const heroStage = $('.hero__stage');
  const wordR = $('.hero__word-r');
  const HINT_SPACE = 64;          // "Scroll to unveil" lives below the frame
  let activeHero = null;
  let heroStacked = false;
  let loraEm = 0;                 // width of "LORA" in em, measured once fonts are in

  function layoutHero() {
    const vw = heroStage.clientWidth;
    const vh = heroStage.clientHeight;
    const navH = nav.offsetHeight;
    const gap = Math.min(48, Math.max(16, vw * 0.025));
    const f = activeHero && activeHero.frames.find(Boolean);
    const aspect = f ? f.width / f.height : 9 / 16;
    if (!loraEm) {
      const prev = wordR.style.fontSize;
      wordR.style.fontSize = '100px';
      loraEm = wordR.offsetWidth / 100 || 3;
      wordR.style.fontSize = prev;
    }

    // Side-by-side layout: bottle (cap ≈6.5% → base ≈88% of the frame) ≈ 70% of vh. The visible
    // reflection fades out by ≈95% of the frame; that span (cap → reflection end) is centred
    // between the nav (+2vh) and a ≥6vh empty band at the bottom of the screen.
    const BOTTLE = 0.815, CAP = 0.065, REFL = 0.95;
    const roomTop = navH + vh * 0.02, roomBottom = vh * 0.94;
    const room = roomBottom - roomTop;
    let h = Math.min((vh * 0.7) / BOTTLE, room / (REFL - CAP));
    let w = Math.min(h * aspect, vw * 0.5);
    h = w / aspect;
    let top = roomTop + (room - (REFL - CAP) * h) / 2 - CAP * h;
    // Word: ~13% smaller than the display maximum, and each group keeps ≥6vw from its
    // screen edge (the gap to the frame is the same on both sides).
    const side = (vw - w) / 2 - gap - vw * 0.06;
    const megaPx = Math.min(208, Math.max(56, vw * 0.14)) * 0.87;
    let size = Math.min(megaPx, side / (loraEm * 1.02));
    const stacked = matchMedia(BP.isMobile).matches || size < 56;

    if (stacked) {
      size = Math.min(72, Math.max(35.2, vw * 0.12));
      top = navH + 6 + size + 12;
      const boxH = vh - top - HINT_SPACE;
      h = boxH;
      w = h * aspect;
      if (w > vw) { w = vw; h = w / aspect; top += (boxH - h) / 2; }
    }
    const x = (vw - w) / 2;

    heroStacked = stacked;
    heroStage.classList.toggle('hero--stacked', stacked);
    const set = (k, v) => heroStage.style.setProperty(k, `${Math.round(v * 10) / 10}px`);
    set('--frame-x', x); set('--frame-y', top); set('--frame-w', w); set('--frame-h', h);
    set('--word-size', size); set('--word-gap', gap);
    if (activeHero) activeHero.resize();   // canvas box just changed size
  }

  let lt;
  window.addEventListener('resize', () => { clearTimeout(lt); lt = setTimeout(layoutHero, 120); }, { passive: true });
  // The font stylesheet loads async, so fonts.ready can resolve before Italiana is even
  // requested: re-measure the word whenever any font finishes loading.
  if (document.fonts) {
    const remeasure = () => { loraEm = 0; layoutHero(); };
    document.fonts.ready.then(remeasure);
    document.fonts.addEventListener('loadingdone', remeasure);
  }

  /* =========================================================================
     NOTES LAYOUT — the whole frame is contain-fitted (nothing cropped by the page). At
     the start the box sits 40px below the heading; as the heading fades (0–20% of the
     pin) the box grows to ~80% of the viewport, centred. Labels point at ingredient
     anchors measured on the frames (fractions of the frame box).
     ========================================================================= */
  const notesStage = $('.notes__stage');
  const notesHead = $('.notes__head');
  const notesVisual = $('#notesVisual');
  const notesList = $('.notes__list');
  const NOTE_ANCHORS = {            // where each connector ends, as [x, y] of the frame
    '.note--top': [0.17, 0.30],     // lemon, upper left
    '.note--heart': [0.85, 0.33],   // peony, upper right
    '.note--base': [0.15, 0.75],    // sandalwood, lower left
  };
  const notesInit = { s: 1, y: 0 };
  let activeNotes = null;
  let notesStacked = false;
  let notesPhone = false;           // ≤767px: full-bleed width-fit canvas (~80svh), labels row under it, no ring
  let notesReduced = false;

  function layoutNotes() {
    const vw = notesStage.clientWidth;
    const vh = notesStage.clientHeight;
    const navH = nav.offsetHeight;
    const gutter = parseFloat(getComputedStyle(nav.firstElementChild).paddingLeft) || 16;
    notesStage.classList.toggle('notes--stacked', notesStacked);
    notesStage.classList.toggle('notes--phone', notesPhone);
    const f = activeNotes && activeNotes.frames.find(Boolean);
    const aspect = f ? f.width / f.height : (notesStacked ? 406 / 720 : 16 / 9);
    const startTop = notesHead.offsetTop + notesHead.offsetHeight + 40;   // ≥40px under the heading

    let x, y, w, h, bottom;
    if (notesPhone) {
      // Full-bleed: the 9:16 frame is drawn at the full screen width (fit 'width'), so no
      // frame edge can show at the sides. The canvas is ~80svh tall, starting right under the
      // nav, with the TOP / HEART / BASE row 20px below it, all inside the pinned 100svh.
      const listH = notesList.offsetHeight;
      y = navH;
      h = Math.min(vh * 0.8, vh - y - 20 - listH - 14);
      w = vw;
      bottom = y + h;
      notesList.style.top = `${Math.round(bottom + 20)}px`;
    } else if (notesStacked) {
      bottom = notesList.offsetTop - 16;
      const top = navH + 12;
      h = bottom - top; w = h * aspect;
      if (w > vw) { w = vw; h = w / aspect; }
      y = top + (bottom - top - h) / 2;
    } else {
      bottom = vh - 16;
      h = Math.min(vh * 0.8, vh - 2 * (navH + 8), (vw * 0.96) / aspect);
      w = h * aspect;
      y = (vh - h) / 2;
    }
    const h0 = Math.min(h, bottom - startTop);
    if (!notesPhone) notesList.style.top = '';
    if (notesReduced) {
      // No scroll story: keep the heading and use the starting box as the final one.
      h = h0; w = notesPhone ? vw : h * aspect; y = startTop;
      notesInit.s = 1; notesInit.y = 0;
    } else if (notesPhone) {
      // Phones: no scale-in (a shrunken canvas would show its edges again) — the canvas just
      // starts lower, clear of the heading, and rises into place as the heading fades.
      notesInit.s = 1;
      notesInit.y = Math.max(0, Math.min(startTop - y, vh - bottom));
    } else {
      notesInit.s = h0 / h;           // scale from the top centre…
      notesInit.y = startTop - y;     // …so the box's top sits under the heading
    }
    x = notesPhone ? 0 : (vw - w) / 2;

    const set = (el, k, v) => el.style.setProperty(k, `${Math.round(v * 10) / 10}px`);
    set(notesVisual, '--nv-x', x); set(notesVisual, '--nv-y', y);
    set(notesVisual, '--nv-w', w); set(notesVisual, '--nv-h', h);

    // Ring: big enough to orbit the ingredients, centred on the bottle, clear of the nav.
    const cy = y + h / 2;
    const ring = notesStacked
      // portrait frames: the bottle runs nearly top to bottom, so the orbit must be as tall
      // as the frame to stay clear of it (its sides simply run off the screen)
      ? Math.min(h * 1.02, 2 * (cy - navH - 4), 2 * (notesList.offsetTop - 4 - cy))
      // 16:9 frames: the ingredients reach ~42% of the frame width either side, so the orbit
      // brackets them at the sides; its top and bottom run off-screen behind nav and edge.
      : Math.min(w * 0.92, vw - 2 * gutter);
    set(notesVisual, '--ring-d', ring);
    const svg = $('.notes__ring', notesVisual), circle = $('circle', svg);
    const d = Math.round(ring);
    svg.setAttribute('viewBox', `0 0 ${d} ${d}`);
    circle.setAttribute('cx', d / 2); circle.setAttribute('cy', d / 2); circle.setAttribute('r', d / 2 - 0.5);

    $$('.note', notesList).forEach((el) => {
      if (notesStacked) { el.style.left = el.style.right = el.style.top = ''; return; }
      const sel = Object.keys(NOTE_ANCHORS).find((k) => el.matches(k));
      const [ax, ay] = NOTE_ANCHORS[sel];
      const px = x + ax * w, py = y + ay * h;
      const bodyW = $('.note__body', el).offsetWidth;
      const right = sel === '.note--heart';
      el.style.top = `${Math.round(py)}px`;
      el.style.left = right ? 'auto' : `${gutter}px`;
      el.style.right = right ? `${gutter}px` : 'auto';
      const lineW = right ? vw - gutter - bodyW - 12 - px : px - gutter - bodyW - 12;
      set(el, '--line-w', Math.max(24, lineW));
    });
    // Desktop / landscape tablet: the notes frame ends a band of empty grey above the stage
    // bottom. The next section rises over exactly that band (minus 6px), so the gap from the
    // frame to the Ultimate Collection heading stays ≈ 13–16vh. Phones / portrait tablets keep
    // their labels in that band, so no overlap there.
    const ult = document.getElementById('ultimate');
    const band = vh - (y + h);
    ult.style.marginTop = !notesStacked && !notesReduced && band > 12 ? `${-Math.round(band - 6)}px` : '';

    if (activeNotes) {
      // phone: width-fit, crop biased upward so the cap is kept; tiny 4% side safety fade
      activeNotes.fit = notesPhone ? 'width' : 'contain';
      activeNotes.focusY = 0.35;
      activeNotes.feather = notesPhone ? 0.04 : notesStacked ? 0.06 : 0.1;
      activeNotes.resize();
      activeNotes.setRect(null);            // forces a repaint with the new fit
    }
  }

  let nlt;
  window.addEventListener('resize', () => { clearTimeout(nlt); nlt = setTimeout(layoutNotes, 120); }, { passive: true });
  ScrollTrigger.addEventListener('refreshInit', layoutNotes);
  if (document.fonts) document.fonts.addEventListener('loadingdone', layoutNotes);

  /* =========================================================================
     RESPONSIVE CHOREOGRAPHY
     ========================================================================= */
  const mm = gsap.matchMedia();

  mm.add(BP, (ctx) => {
    const { isDesktop, isTablet, isMobile, reduce, portrait } = ctx.conditions;
    // Hero: both variants are portrait frames (-m is lighter, for phones).
    // Notes: portrait frames for phones and portrait tablets, landscape elsewhere.
    const heroV = isMobile && !CAPTURE ? 'm' : 'd';
    const v = isMobile || (isTablet && portrait) ? 'm' : 'd';
    const stacked = v === 'm';   // notes labels sit below the canvas
    const hero = getSeq('hero', heroV);
    const notes = getSeq('notes', v);
    activeHero = hero;
    hero.on('firstbatch', layoutHero);   // real frame aspect is known now
    // The stage (and the nav, while the hero is pinned) take the tone of the frame on screen.
    let heroOnScreen = true;
    hero.onBg = (rgb) => {
      root.style.setProperty('--hero-rgb', rgb);
      if (heroOnScreen) root.style.setProperty('--nav-rgb', rgb);
    };
    ctx.add(() => () => {
      hero.onBg = null;
      root.style.removeProperty('--hero-rgb');
      root.style.removeProperty('--nav-rgb');
    });
    layoutHero();
    activeNotes = notes;
    notesStacked = stacked;
    notesPhone = isMobile;
    notesReduced = reduce;
    notes.on('firstbatch', layoutNotes);
    layoutNotes();

    // The Ultimate Collection: swipe carousel on phones; the 3D ring stays on tablet/desktop.
    // Built in this matchMedia context so crossing 767px cleanly builds / removes it.
    let swipe = null;
    if (isMobile) {
      swipe = buildSwipeCarousel();
      ctx.add(() => () => swipe.destroy());
    }

    /* ---------------- Reduced motion: static frames, simple fades ---------------- */
    if (reduce) {
      setupDoneResolve();               // nothing is deferred in reduced-motion mode
      ['hero', 'notes'].forEach((name) => {
        const img = $(SEQ[name].img);
        img.src = lastFrameSrc(name, name === 'hero' ? heroV : v);
        img.hidden = false;
        $(SEQ[name].canvas).style.visibility = 'hidden';
      });
      // Opening composition only (word | bottle | hint): the side panels belong to the scroll story.
      gsap.set('.hero__aside, .hero__variants', { autoAlpha: 0 });
      $$('.section-head, .card, .art__text > *, .note, .moment__text > *, .bubble, .g-item, .footer__mark, .carousel__controls')
        .forEach((el) => {
          gsap.from(el, { autoAlpha: 0, duration: 0.6, ease: 'none', scrollTrigger: { trigger: el, start: 'top 92%', once: true } });
        });
      heroIntro = gsap.timeline({ paused: true })
        .fromTo('.nav, .hero__word, .seq-static, .hero__hint', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 });
      return () => {
        ['hero', 'notes'].forEach((name) => { $(SEQ[name].img).hidden = true; $(SEQ[name].canvas).style.visibility = ''; });
      };
    }

    hero.load();
    if (CAPTURE) notes.load();
    else notes.loadWhenNear($('#notes'), '100% 0px');

    // Everything below the hero is built in small separate tasks (while the preloader
    // is still up) so no single main-thread task blocks for long. Order is preserved,
    // which matters for pins: ScrollTrigger must see them top-to-bottom.
    let alive = true;
    const queue = [];
    const later = (fn) => queue.push(fn);
    const drain = () => {
      if (!alive) return;
      // The preloader refreshes on reveal; only re-measure here if it has already gone.
      if (!queue.length) { if (introPlayed) ScrollTrigger.refresh(); setupDoneResolve(); return; }
      ctx.add(queue.shift());
      setTimeout(drain, 0);
    };

    /* ---------------- HERO ---------------- */
    // The two word groups drift outward and fade out before the side content arrives.
    const drift = () => heroStage.clientWidth * (heroStacked ? 0.3 : 0.12);
    const heroProxy = { p: 0 };
    const heroTl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: '.hero', start: 'top top',
        end: isMobile ? '+=180%' : '+=250%',
        pin: true, scrub: SCRUB, anticipatePin: 1, invalidateOnRefresh: true,
        toggleClass: { targets: '.hero', className: 'is-active' },
        onToggle: (self) => {
          heroOnScreen = self.isActive;
          const tone = root.style.getPropertyValue('--hero-rgb');
          if (self.isActive && tone) root.style.setProperty('--nav-rgb', tone);
          else root.style.removeProperty('--nav-rgb');
        },
      },
    });
    // Hero → Signature Collection: the collection rises over the pinned hero for the hero's
    // last 15% (15% of the 250% / 180% pin), so its heading is already fading in as the
    // sequence ends and there is no empty screen between the two.
    gsap.set('.collection', { marginTop: isMobile ? '-27svh' : '-37.5svh' });
    $('.collection').classList.add('collection--curtain');
    ctx.add(() => () => $('.collection').classList.remove('collection--curtain'));
    heroTl
      .to(heroProxy, { p: 1, duration: 1, onUpdate: () => hero.setProgress(heroProxy.p) }, 0)
      .to('.hero__word-l', { x: () => -drift(), opacity: 0, duration: 0.28, ease: 'power1.in' }, 0)
      .to('.hero__word-r', { x: () => drift(), opacity: 0, duration: 0.28, ease: 'power1.in' }, 0)
      .to('.hero__hint', { autoAlpha: 0, duration: 0.05 }, 0)
      // The video zooms in at the end; ease the frame down a touch so the cap never
      // slides under the nav (side-by-side layout only — stacked has room above).
      .fromTo('#heroCanvas', { scale: 1 }, { scale: () => (heroStacked ? 1 : 0.9), transformOrigin: '50% 100%', duration: 0.3 }, 0.7)
      .fromTo('.hero__variants .variant', { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.1, stagger: 0.03, ease: 'power2.out' }, 0.3)
      .fromTo('.hero__aside', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.12, ease: 'power2.out' }, 0.3);

    // Intro played once the preloader has gone (letters rise into their masks).
    gsap.set(heroSplit.chars, { yPercent: 115 });
    gsap.set('.nav', { autoAlpha: 0, y: -16 });
    gsap.set('.hero__hint', { autoAlpha: 0 });
    heroIntro = gsap.timeline({ paused: true })
      .to(heroSplit.chars, { yPercent: 0, duration: 1.4, ease: 'expo.out', stagger: 0.07 }, 0)
      .to('.nav', { autoAlpha: 1, y: 0, duration: 1, ease: 'power3.out' }, 0.5)
      .to('.hero__hint', { autoAlpha: 1, duration: 0.8 }, 0.9);
    if (introPlayed) heroIntro.progress(1);

    /* ---------------- SIGNATURE COLLECTION ---------------- */
    later(() => {
      $$('.split-lines').forEach((el) => splitLines(el));

      gsap.from('.card', {
        y: 140, rotationX: 25, opacity: 0, transformOrigin: '50% 100%',
        duration: 1.3, ease: 'power3.out', stagger: 0.12,
        scrollTrigger: { trigger: '#cards', start: 'top 88%', once: true },
      });
      // Gentle parallax, kept small so the cap always keeps ≥10% clearance under the arch.
      gsap.fromTo('.card__bottle', { yPercent: 3 }, {
        yPercent: -3, ease: 'none',
        scrollTrigger: {
          trigger: '#cards', start: 'top bottom', end: 'bottom top', scrub: true,
          toggleClass: { targets: '.collection', className: 'is-active' },
        },
      });

      if (canHover) {
        // Hover: card lifts 6px, bottle lifts 12px and grows 3% from its base. On desktop the
        // pointer also tilts the arch (max ±8°) while the bottle drifts the other way.
        const tilt = isDesktop;
        $$('.card').forEach((card) => {
          const arch = $('.card__arch', card);
          const bottle = $('.card__bottle', card);
          gsap.set(bottle, { transformOrigin: '50% 100%' });
          const rx = gsap.quickTo(arch, 'rotationX', { duration: 0.6, ease: 'power3' });
          const ry = gsap.quickTo(arch, 'rotationY', { duration: 0.6, ease: 'power3' });
          const bx = gsap.quickTo(bottle, 'x', { duration: 0.8, ease: 'power3' });
          const by = gsap.quickTo(bottle, 'y', { duration: 0.8, ease: 'power3' });
          const LIFT = -12;
          const enter = () => {
            gsap.to(card, { y: -6, duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
            gsap.to(bottle, { scale: 1.03, duration: 0.8, ease: 'power3.out', overwrite: 'auto' });
            by(LIFT);
          };
          const move = (e) => {
            if (!tilt) return;
            const r = arch.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;
            const py = (e.clientY - r.top) / r.height - 0.5;
            rx(-py * 16); ry(px * 16);            // max ±8°
            bx(-px * 22); by(LIFT - py * 14);     // bottle drifts the other way → depth
          };
          const leave = () => {
            rx(0); ry(0); bx(0); by(0);
            gsap.to(card, { y: 0, duration: 0.7, ease: 'power3.out', overwrite: 'auto' });
            gsap.to(bottle, { scale: 1, duration: 0.8, ease: 'power3.out', overwrite: 'auto' });
          };
          card.addEventListener('mouseenter', enter);
          card.addEventListener('mousemove', move);
          card.addEventListener('mouseleave', leave);
          ctx.add(() => () => {
            card.removeEventListener('mouseenter', enter);
            card.removeEventListener('mousemove', move);
            card.removeEventListener('mouseleave', leave);
          });
        });
      }
    });

    /* ---------------- THE ART OF FINE FRAGRANCE ---------------- */
    later(() => {
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: '.art__media', start: 'top 90%', end: 'center 50%', scrub: true },
      })
        .fromTo('#artCircle', { clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(50% at 50% 50%)' }, 0)
        .fromTo('#artCircle img', { scale: 1.3 }, { scale: 1 }, 0)
        .fromTo('.art__ring circle', { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, 0);

      gsap.from('.art__text .eyebrow, .art__p, .art__sign', {
        y: 36, opacity: 0, duration: 1.1, ease: 'power3.out', stagger: 0.18,
        scrollTrigger: { trigger: '.art__text', start: 'top 75%', once: true },
      });
    });

    /* ---------------- THE ESSENCE ---------------- */
    later(() => {
      const notesProxy = { p: 0 };
      const notesTl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: '#notes', start: 'top top',
          end: isMobile ? '+=150%' : '+=200%',
          pin: true, scrub: SCRUB, anticipatePin: 1, invalidateOnRefresh: true,
          toggleClass: { targets: '#notes', className: 'is-active' },
        },
      });
      notesTl
        .to(notesProxy, { p: 1, duration: 1, onUpdate: () => notes.setProgress(notesProxy.p) }, 0)
        // 0–20%: heading lifts away, the visual grows into the freed space
        .fromTo('.notes__head', { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -40, duration: 0.2 }, 0)
        .fromTo(notesVisual, { scale: () => notesInit.s, y: () => notesInit.y }, { scale: 1, y: 0, duration: 0.2, ease: 'power1.inOut' }, 0)
        // the orbit draws itself across the whole pin
        .fromTo('.notes__ring circle', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1 }, 0);
      // (the Ultimate Collection's overlap with the notes pin is set in layoutNotes)
      [['.note--top', 0.3], ['.note--heart', 0.55], ['.note--base', 0.8]].forEach(([sel, at]) => {
        notesTl
          .fromTo(`${sel} .note__line path`, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.07 }, at)
          .fromTo(`${sel} .note__body`, { autoAlpha: 0, x: stacked ? 0 : (sel === '.note--heart' ? 16 : -16), y: stacked ? 16 : 0 },
            { autoAlpha: 1, x: 0, y: 0, duration: 0.08, ease: 'power2.out' }, at + 0.04);
      });
      // Hold the finished state briefly before the pin releases.
      notesTl.to({}, { duration: 0.06 });
    });

    /* ---------------- THE ULTIMATE COLLECTION ---------------- */
    later(() => {
      if (swipe) {
        // Phones: a normal section (no pin); heading and track simply fade up into view.
        gsap.from([swipe.head, swipe.track], {
          y: 28, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12,
          scrollTrigger: { trigger: '#ultimate', start: 'top 80%', once: true },
        });
        if (CAPTURE) {
          // no touch in a recording: page scroll swipes through all six bottles instead
          ScrollTrigger.create({
            trigger: '#ultimate', start: 'top 55%', end: 'bottom 45%',
            onUpdate: (self) => {
              const t = swipe.track;
              t.scrollLeft = self.progress * (t.scrollWidth - t.clientWidth);
              swipe.update();
            },
          });
        }
        return;
      }
      carousel.layout();
      const carProxy = { d: 0 };
      gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: '#ultimate', start: 'top top', end: '+=150%',
          pin: true, scrub: SCRUB, anticipatePin: 1,
          // one turn = 6 steps; when scrolling settles, the nearest bottle snaps to the front
          // (not in capture mode: the recorder owns the scroll position)
          snap: CAPTURE ? false : { snapTo: 1 / 6, inertia: false, directional: false, duration: { min: 0.2, max: 0.6 }, delay: 0.08, ease: 'power2.inOut' },
          toggleClass: { targets: '#ultimate', className: 'is-active' },
        },
      }).to(carProxy, { d: 360, duration: 1, onUpdate: () => carousel.setScroll(carProxy.d) });
    });

    /* ---------------- MADE FOR EVERY MOMENT ---------------- */
    later(() => {
      gsap.from('.moment__text .eyebrow, .moment__p, .moment__list li, .moment__text .text-link', {
        y: 30, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.12,
        scrollTrigger: { trigger: '.moment__text', start: 'top 75%', once: true },
      });
      $$('.bubble').forEach((b, i) => {
        const st = { trigger: '.moment', start: 'top bottom', end: 'bottom top', scrub: true };
        if (i === 0) st.toggleClass = { targets: '.moment', className: 'is-active' };
        gsap.fromTo(b, { yPercent: 0 }, {
          yPercent: parseFloat(b.dataset.speed) * (isMobile ? 0.5 : 1), ease: 'none', scrollTrigger: st,
        });
        gsap.fromTo($('img', b), { scale: 1.25 }, {
          scale: 1, ease: 'none',
          scrollTrigger: { trigger: b, start: 'top bottom', end: 'center center', scrub: true },
        });
        gsap.from(b, {
          scale: 0.82, opacity: 0, duration: 1.4, ease: 'power3.out', delay: i * 0.12,
          scrollTrigger: { trigger: '.moment__cluster', start: 'top 80%', once: true },
        });
      });
    });

    /* ---------------- FOOTER ---------------- */
    later(() => {
      gsap.fromTo('#footerMark', { xPercent: 20 }, {
        xPercent: 0, ease: 'none',
        scrollTrigger: { trigger: '.footer__mark', start: 'top bottom', end: 'bottom bottom', scrub: true },
      });
      gsap.from('.g-item', {
        y: 90, opacity: 0, duration: 1.2, ease: 'power3.out',
        stagger: { each: 0.09, from: isMobile ? 'start' : 'center' },
        scrollTrigger: { trigger: '#gallery', start: 'top 88%', once: true },
      });
      gsap.from('.footer__contact > *', {
        y: 24, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.1,
        scrollTrigger: { trigger: '.footer__contact', start: 'top 85%', once: true },
      });
    });

    // Close the mobile menu if we cross into desktop with it open
    if (isDesktop) setMenu(false);

    setTimeout(drain, 0);
    return () => { alive = false; /* gsap.matchMedia reverts everything created in ctx */ };
  });

  /* =========================================================================
     PRELOADER → reveal
     ========================================================================= */
  const pre = $('#preloader');
  const fill = $('#preloaderFill');
  const pct = $('#preloaderPct');

  function runPreloader() {
    if (CAPTURE) {
      pre.remove();
      introPlayed = true;
      if (heroIntro) heroIntro.progress(1);
      return;
    }
    lockScroll(true);
    const v = matchMedia(BP.isMobile).matches ? 'm' : 'd';
    const heroSeq = seqs[`hero-${v}`];
    const first = heroSeq ? heroSeq.firstBatch : 1;

    const setPct = (p) => {
      fill.style.transform = `scaleX(${p})`;
      pct.textContent = `${Math.round(p * 100)}%`;
    };
    gsap.from(preSplit.chars, { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.06 });

    let framesReady;
    if (startReduced || !heroSeq) {
      framesReady = Promise.resolve();
    } else {
      heroSeq.on('progress', () => setPct(Math.min(1, heroSeq.loadedCount / first)));
      framesReady = heroSeq.load();
    }
    const fontsReady = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
    const minTime = new Promise((r) => setTimeout(r, startReduced ? 0 : 900));   // let the wordmark land
    const timeout = new Promise((r) => setTimeout(r, 9000));                      // never hang on a slow network

    Promise.race([Promise.all([framesReady, fontsReady, minTime]), timeout]).then(() => {
      setPct(1);
      ScrollTrigger.refresh();
      gsap.timeline({
        delay: 0.25,
        onComplete: () => {
          pre.remove();
          lockScroll(false);
          introPlayed = true;
        },
      })
        .to(preSplit.chars, { yPercent: -110, duration: 0.7, ease: 'expo.in', stagger: 0.04 })
        .to('.preloader__bar, .preloader__meta', { opacity: 0, duration: 0.4 }, 0.1)
        .to(pre, { yPercent: -100, duration: 1, ease: 'expo.inOut' }, 0.55)
        .add(() => heroIntro && heroIntro.play(), 0.85);
    });
  }

  runPreloader();

  /* =========================================================================
     CAPTURE API (only with ?capture=1)
     ========================================================================= */
  if (CAPTURE) {
    const sectionTriggers = {};
    const maxScroll = () => document.documentElement.scrollHeight - innerHeight;
    const clamp = (v) => Math.round(Math.max(0, Math.min(maxScroll(), v)));
    // Pinned sections report their pin range; the others: start = section top at the viewport
    // top, end = section bottom at the viewport bottom (never before start). Footer ends at the
    // very bottom of the page.
    const SECTIONS = {
      hero: '.hero', signature: '.collection', art: '.art', notes: '#notes',
      ultimate: '#ultimate', moments: '.moment', footer: '.footer',
    };

    window.__captureReady = (async () => {
      await setupDone;
      if (document.fonts) await document.fonts.ready;
      // every image eager + decoded, so nothing pops in mid-recording
      const imgs = $$('img');
      imgs.forEach((img) => { img.loading = 'eager'; });
      await Promise.all(imgs.map((img) => (img.complete && img.naturalWidth ? Promise.resolve() : img.decode().catch(() => {}))));
      // every frame of the active hero and notes sequences
      await Promise.all([activeHero, activeNotes].filter(Boolean).map((s) => { s.load(); return s.whenComplete(); }));
      ScrollTrigger.refresh();
      Object.entries(SECTIONS).forEach(([name, sel]) => {
        const pinned = ScrollTrigger.getAll().find((s) => s.pin && s.trigger === $(sel));
        sectionTriggers[name] = pinned || ScrollTrigger.create({ trigger: sel, start: 'top top', end: 'bottom bottom' });
      });
      window.scrollTo(0, 0);
      ScrollTrigger.update();
      return true;
    })();

    Object.defineProperty(window, '__captureSections', {
      get() {
        const out = {};
        Object.entries(sectionTriggers).forEach(([name, st]) => {
          const start = clamp(st.start);
          out[name] = { start, end: name === 'footer' ? clamp(maxScroll()) : Math.max(start, clamp(st.end)) };
        });
        return out;
      },
    });

    window.__captureStep = (scrollY, timeSeconds) => {
      window.scrollTo(0, scrollY);
      gsap.updateRoot(captureBase + timeSeconds);
      ScrollTrigger.update();
      [activeHero, activeNotes].forEach((s) => s && s.drawNow());
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
  }

  // (ScrollTrigger re-measures on window load by itself; SplitText autoSplit re-splits after fonts load.)
})();
