/**
 * ImageSequence — scroll-scrubbable canvas image sequence.
 *
 *   const seq = new ImageSequence({ canvas, folder: 'assets/seq/hero-d', frameCount: 150, ext: 'webp' });
 *   seq.load();              // starts priority loading (call later for lazy sequences)
 *   seq.setProgress(0.42);   // 0..1, typically from a ScrollTrigger onUpdate
 *
 * Loading order: first 20 frames, then every 4th frame, then the gaps — so scrubbing
 * works almost immediately and gets smoother as more frames arrive.
 */
(function (global) {
  'use strict';

  const supportsBitmap = typeof createImageBitmap === 'function';

  class ImageSequence {
    constructor({ canvas, folder, frameCount, ext = 'webp', pad = 4, firstBatch = 20, concurrency = 6,
                  focusX = 0.5, focusY = 0.5, maxDpr = 1.5,
                  bg = '#E6EAE6', feather = 0.16, featherY = null, fit = 'cover', transparent = false }) {
      this.canvas = canvas;
      // fit 'contain' + transparent: the canvas IS the frame box; the frame is drawn
      // contain-fit with its edges faded to transparent (the page shows through).
      // fit 'width': the frame's width always equals the canvas width (any extra height is
      // cropped top/bottom, split by focusY) — no frame edge can ever show at the sides.
      this.fit = fit;
      this.transparent = transparent;
      this.ctx = canvas.getContext('2d', { alpha: transparent });
      this.folder = folder.replace(/\/$/, '');
      this.frameCount = frameCount;
      this.ext = ext;
      this.pad = pad;
      this.firstBatch = Math.min(firstBatch, frameCount);
      this.concurrency = concurrency;
      this.focusX = focusX;          // object-position for the cover crop (0.5 = centred)
      this.focusY = focusY;
      // Contain mode: setRect({x,y,w,h}) (CSS px) draws each frame contain-fit inside that
      // box, fills the rest of the canvas with `bg` and feathers the frame's edges into it.
      this.rect = null;
      this.bg = bg;
      this.bgClear = this._rgba(bg, 0);
      this.feather = feather;
      this.featherY = featherY == null ? feather : featherY;   // top/bottom fade; 0 = none
      this.cssW = 1;
      this.cssH = 1;
      this.maxDpr = maxDpr;

      this.frames = new Array(frameCount).fill(null);   // ImageBitmap | HTMLImageElement
      this.failed = new Array(frameCount).fill(false);
      this.loadedCount = 0;
      this.current = 0;         // requested frame
      this.drawn = -1;          // frame actually painted (-1 forces a paint)
      this.drawnSource = -1;    // which loaded frame was used for that paint
      this.rafId = 0;
      this.started = false;
      this.destroyed = false;

      this._listeners = { progress: [], firstbatch: [], complete: [] };
      this._firstBatchDone = false;

      this._onResize = this._debounce(() => this.resize(), 150);
      global.addEventListener('resize', this._onResize, { passive: true });
      this.resize();
    }

    /* ---------- events ---------- */
    on(type, fn) { (this._listeners[type] || []).push(fn); return this; }
    _emit(type, payload) { (this._listeners[type] || []).forEach((fn) => fn(payload)); }

    /* ---------- loading ---------- */
    src(i) { return `${this.folder}/${String(i + 1).padStart(this.pad, '0')}.${this.ext}`; }

    _priorityOrder() {
      const order = [];
      const seen = new Uint8Array(this.frameCount);
      const push = (i) => { if (i >= 0 && i < this.frameCount && !seen[i]) { seen[i] = 1; order.push(i); } };
      for (let i = 0; i < this.firstBatch; i++) push(i);
      push(this.frameCount - 1);                            // last frame early: the end state is shown often
      for (let i = 0; i < this.frameCount; i += 4) push(i);
      for (let i = 0; i < this.frameCount; i += 2) push(i);
      for (let i = 0; i < this.frameCount; i++) push(i);
      return order;
    }

    /** Starts loading. Resolves when the first batch is decoded. */
    load() {
      if (this.started) return this._firstBatchPromise;
      this.started = true;
      const queue = this._priorityOrder();
      const firstSet = new Set(queue.slice(0, this.firstBatch));
      let firstRemaining = firstSet.size;

      this._firstBatchPromise = new Promise((resolve) => {
        const settleFirst = (i) => {
          if (!firstSet.has(i)) return;
          firstSet.delete(i);
          firstRemaining--;
          if (firstRemaining === 0 && !this._firstBatchDone) {
            this._firstBatchDone = true;
            this._emit('firstbatch');
            resolve();
          }
        };

        const next = () => {
          if (this.destroyed || !queue.length) return;
          const i = queue.shift();
          this._loadFrame(i).then(() => { settleFirst(i); next(); });
        };
        for (let c = 0; c < this.concurrency; c++) next();
      });
      return this._firstBatchPromise;
    }

    _loadFrame(i) {
      // Fetch + createImageBitmap(blob) decodes off the main thread; fall back to <img>.
      if (supportsBitmap && typeof fetch === 'function') {
        const priority = i < this.firstBatch ? 'high' : 'low';
        return fetch(this.src(i), { priority })
          .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
          .then((blob) => createImageBitmap(blob))
          .then((bmp) => this._onFrame(i, bmp), () => this._onFail(i));
      }
      return new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        // Hint the browser: the first frames block the reveal, the rest are background work.
        if ('fetchPriority' in img) img.fetchPriority = i < this.firstBatch ? 'high' : 'low';
        img.onload = () => {
          const done = (bmp) => { this._onFrame(i, bmp); resolve(); };
          if (supportsBitmap) {
            createImageBitmap(img).then(done, () => done(img));
          } else {
            (img.decode ? img.decode() : Promise.resolve()).then(() => done(img), () => done(img));
          }
        };
        img.onerror = () => { this._onFail(i); resolve(); };
        img.src = this.src(i);
      });
    }

    _onFrame(i, bmp) {
      if (this.destroyed) { if (bmp.close) bmp.close(); return; }
      this.frames[i] = bmp;
      this._tick();
      // A better frame may now be available for what's on screen.
      if (this.drawnSource !== this.current && Math.abs(i - this.current) <= Math.abs(this.drawnSource - this.current)) {
        this._requestDraw(true);
      }
    }

    _onFail(i) {
      this.failed[i] = true;
      this._tick();
    }

    _tick() {
      this.loadedCount++;
      this._emit('progress', this.loadedCount / this.frameCount);
      if (this.loadedCount === this.frameCount) this._emit('complete');
    }

    /** Starts loading when the element comes within `margin` of the viewport. */
    loadWhenNear(el, margin = '100% 0px') {
      if (!('IntersectionObserver' in global)) { this.load(); return; }
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); this.load(); }
      }, { rootMargin: margin });
      io.observe(el);
    }

    /* ---------- drawing ---------- */
    setProgress(p) {
      this.setFrame(Math.round(Math.min(1, Math.max(0, p)) * (this.frameCount - 1)));
    }

    setFrame(i) {
      i = Math.min(this.frameCount - 1, Math.max(0, i | 0));
      if (i === this.current && this.drawn === i && this.drawnSource === i) return;
      this.current = i;
      this._requestDraw();
    }

    _requestDraw(force) {
      if (force) this.drawn = -1;
      if (this.rafId) return;
      this.rafId = requestAnimationFrame(() => { this.rafId = 0; this._draw(); });
    }

    _nearestLoaded(i) {
      if (this.frames[i]) return i;
      for (let d = 1; d < this.frameCount; d++) {
        if (i - d >= 0 && this.frames[i - d]) return i - d;   // prefer the earlier frame: no "jump ahead"
        if (i + d < this.frameCount && this.frames[i + d]) return i + d;
      }
      return -1;
    }

    _draw() {
      const target = this.current;
      const src = this._nearestLoaded(target);
      if (this.drawn === target && this.drawnSource === src) return;

      const { ctx, canvas } = this;
      const cw = canvas.width, ch = canvas.height;

      if (src < 0) { this._placeholder(); return; }   // keep whatever was there otherwise: no blank flash

      const img = this.frames[src];
      const iw = img.width, ih = img.height;
      if (this.fit === 'width') {
        this._drawWidth(img, iw, ih);
      } else if (this.rect || this.fit === 'contain') {
        this._drawContain(img, iw, ih);
      } else {
        // object-fit: cover
        const scale = Math.max(cw / iw, ch / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = (cw - dw) * this.focusX;
        const dy = (ch - dh) * this.focusY;
        ctx.drawImage(img, dx, dy, dw, dh);
      }

      this.drawn = target;
      this.drawnSource = src;
    }

    /** Contain mode: switch on with a CSS-px rect, or pass null to go back to cover. */
    setRect(rect) {
      this.rect = rect;
      this._requestDraw(true);
    }

    _drawContain(img, iw, ih) {
      const { ctx, canvas } = this;
      const sx = canvas.width / this.cssW, sy = canvas.height / this.cssH;
      const r = this.rect || { x: 0, y: 0, w: this.cssW, h: this.cssH };
      const rx = r.x * sx, ry = r.y * sy, rw = r.w * sx, rh = r.h * sy;
      const scale = Math.min(rw / iw, rh / ih);
      const dw = Math.round(iw * scale), dh = Math.round(ih * scale);
      const dx = Math.round(rx + (rw - dw) / 2), dy = Math.round(ry + (rh - dh) / 2);

      if (this.transparent) ctx.clearRect(0, 0, canvas.width, canvas.height);
      else { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(img, dx, dy, dw, dh);

      // Feather all four edges so the frame dissolves into the page: painted in the page
      // colour on an opaque canvas, or erased to transparent on a transparent one.
      const f = Math.round(Math.min(dw, dh) * this.feather);
      const fy = Math.round(Math.min(dw, dh) * this.featherY);
      if (f > 0 || fy > 0) {
        const solid = this.transparent ? '#000' : this.bg;
        const clear = this.transparent ? 'rgba(0,0,0,0)' : this.bgClear;
        if (this.transparent) ctx.globalCompositeOperation = 'destination-out';
        const edge = (x0, y0, x1, y1, x, y, w, h) => {
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, solid);
          g.addColorStop(1, clear);
          ctx.fillStyle = g;
          ctx.fillRect(x, y, w, h);
        };
        if (f > 0) {
          edge(dx, 0, dx + f, 0, dx, dy, f, dh);                         // left
          edge(dx + dw, 0, dx + dw - f, 0, dx + dw - f, dy, f, dh);      // right
        }
        if (fy > 0) {
          edge(0, dy, 0, dy + fy, dx, dy, dw, fy);                       // top
          edge(0, dy + dh, 0, dy + dh - fy, dx, dy + dh - fy, dw, fy);   // bottom
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    _drawWidth(img, iw, ih) {
      const { ctx, canvas } = this;
      const cw = canvas.width, ch = canvas.height;
      const dh = Math.round((ih * cw) / iw);
      const dy = Math.round(dh > ch ? (ch - dh) * this.focusY : (ch - dh) / 2);
      if (this.transparent) ctx.clearRect(0, 0, cw, ch);
      else { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, cw, ch); }
      ctx.drawImage(img, 0, dy, cw, dh);
      // hairline side safety fade only (top/bottom are faded by the CSS mask)
      const f = Math.round(cw * this.feather);
      if (f > 0) {
        const solid = this.transparent ? '#000' : this.bg;
        const clear = this.transparent ? 'rgba(0,0,0,0)' : this.bgClear;
        if (this.transparent) ctx.globalCompositeOperation = 'destination-out';
        [[0, f, 0], [cw, cw - f, cw - f]].forEach(([x0, x1, x]) => {
          const g = ctx.createLinearGradient(x0, 0, x1, 0);
          g.addColorStop(0, solid); g.addColorStop(1, clear);
          ctx.fillStyle = g; ctx.fillRect(x, 0, f, ch);
        });
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    _rgba(hex, a) {
      const n = parseInt(hex.replace('#', ''), 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }

    _placeholder() {
      // Only shown if no frame at all has loaded (e.g. sequence files missing).
      const { ctx, canvas } = this;
      if (this.transparent) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      if (this.rect || this.fit === 'contain') { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
      ctx.fillStyle = this.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.cssW = Math.max(1, rect.width);
      this.cssH = Math.max(1, rect.height);
      const dpr = Math.min(global.devicePixelRatio || 1, this.maxDpr);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.ctx.imageSmoothingQuality = 'high';
        this._requestDraw(true);    // resizing clears the bitmap, so repaint
      }
    }

    get ready() { return this._firstBatchDone; }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.rafId);
      global.removeEventListener('resize', this._onResize);
      this.frames.forEach((f) => f && f.close && f.close());
      this.frames = [];
    }

    _debounce(fn, ms) {
      let t;
      return () => { clearTimeout(t); t = setTimeout(fn, ms); };
    }
  }

  global.ImageSequence = ImageSequence;
})(window);
