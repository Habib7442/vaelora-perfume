# VAELORA — scroll-driven landing page

Plain HTML/CSS/JS. No build step. GSAP 3.13 (ScrollTrigger, SplitText) and Lenis load from jsDelivr.

```
index.html
css/style.css
js/main.js              Lenis + GSAP setup, section choreography
js/sequence.js          ImageSequence: canvas frame-sequence player
scripts/build-assets.sh asset pipeline (ffmpeg)
assets/seq/{hero,notes}-{d,m}/0001.webp …   frame sequences
assets/img/{products,lifestyle,gallery}/<slug>-{400,800}.webp
public/                 raw source files (videos + PNGs)
```

## Run locally

```bash
npx serve .            # then open http://localhost:3000
```

The page must be served over HTTP. Opening `file://` won't work because frames load with `fetch()`.

## Rebuild assets

Requires `ffmpeg` built with `libwebp` (check with `ffmpeg -encoders | grep webp`).

```bash
bash scripts/build-assets.sh          # everything
ONLY=seq bash scripts/build-assets.sh # only the frame sequences
ONLY=img bash scripts/build-assets.sh # only product / lifestyle / gallery images
ONLY=hero-d bash scripts/build-assets.sh  # one sequence: hero-d | hero-m | notes-d | notes-m
```

**The hero uses the portrait video at every size.** Both hero-d (150 frames, 960 px tall, for desktop and tablet) and hero-m (90 frames, 720 px tall, for phones) come from `hero-mobile.mp4`. The landscape `hero-desktop.mp4` crops the bottle's cap in its first and last seconds, so it isn't used. The page fits the whole frame into a box below the nav, fills the rest of the screen with `#E9ECEB`, and fades the frame's edges into that colour.

What the script does:

- **Sequences**: 150 frames for desktop and 90 for mobile, at the fps that gives that count for the video's length. It also paints out the small sparkle watermark in the source videos (`delogo`) and lifts the video's grey background to the page's `--bg`.
- **Budget**: the target is under 6 MB per desktop sequence and under 3 MB per mobile one. The script estimates each size/quality option from every 8th frame and picks the best one that fits. If nothing fits, it stops at a quality floor (1280 px wide at q50 for desktop, 720 px tall at q50 for mobile) instead of shipping blurry frames.
- **Images**: every PNG becomes `<slug>-800.webp` and `<slug>-400.webp` at q80, keeping transparency. The slug is the lower-cased filename with spaces turned into dashes.

### Replacing the videos

Replace `public/hero_sequence_video/hero-{desktop,mobile}.mp4` or `public/notes_sequence_video/notes-{desktop,mobile}.mp4` and rerun the script.

- If a new video has no watermark, delete `${delogo},` from the `-vf` line in `extract_seq`.
- If its background is a different grey, adjust `LEVELS`.
- If you change a frame count, also update `SEQ` at the top of `js/main.js`.

### Replacing products or photos

1. Drop new PNGs into `public/signature_collections`, `public/ultimate_collections`, `public/model_shots` or `public/footer_gallery_strip`.
2. Run `ONLY=img bash scripts/build-assets.sh`.
3. Update the `src` / `srcset` slugs in `index.html`. For carousel items, also update `data-name` / `data-price`.

Source folders can be overridden with env vars: `SRC_VIDEO_HERO`, `SRC_VIDEO_NOTES`, `SRC_PRODUCTS`, `SRC_LIFESTYLE`, `SRC_GALLERY`.

If an image is missing, the page still renders: arches and circles fall back to their background colours. If a whole sequence is missing, its canvas draws a soft gradient placeholder.

## How it behaves

| | Desktop ≥1024 | Tablet 768–1023 | Mobile ≤767 |
|---|---|---|---|
| Hero sequence | hero-d, DPR cap 1.5 | hero-d | hero-m, DPR cap 1 |
| Hero word | "VAE" left of the bottle, "LORA" right | same if it fits, otherwise above | above the bottle |
| Notes sequence | `-d`, DPR cap 1.5 | `-d` landscape, `-m` portrait | `-m`, DPR cap 1 |
| Hero pin | 250vh | 250vh | 180vh |
| Notes pin | 200vh | 200vh | 150vh, labels stacked below |
| Card tilt | mouse tilt | — | swipe row (scroll-snap) |
| Blur | glass nav / labels | none | none |

- **Preloader**: waits only for the first 20 hero frames, the fonts, and a short minimum time. It gives up after 9 s, so the page never hangs.
- **Load order**: the first 20 frames, then the last frame, then every 4th frame, then the gaps. The notes sequence starts loading when the user is within one viewport of it.
- **Scroll**: native scroll drives everything. Lenis only smooths mouse-wheel input (`lerp 0.1`); touch scrolling stays native.
- **`prefers-reduced-motion`**: no Lenis, no pins, no scrubbing. Each sequence shows its last frame as a static image, and sections use simple fades. The carousel buttons still work.
- **Setup**: below-the-fold animations are set up in small separate tasks while the preloader is showing, to keep Total Blocking Time down.

## Results from the last build

| Sequence | Size | Target |
|---|---|---|
| hero-m (90 × 406×720, q55) | 2.28 MB | < 3 MB ✓ |
| notes-m (90 × 406×720, q50) | 2.75 MB | < 3 MB ✓ |
| hero-d (150 × 540×960 portrait, q50) | 5.33 MB | < 6 MB ✓ |
| notes-d (150 × 1280w, q50) | 9.70 MB | < 6 MB — over |

The desktop notes sequence can't meet the budget at an acceptable quality. The notes video in particular is full of fine detail (wood grain, petals, droplets). Dropping from q70 to q35 saves only about 25%. Getting under 6 MB would mean going below 1280 px wide, which looks visibly soft on large screens.

To shrink them further, either:
- encode AVIF instead (roughly 30–50% smaller; needs a matching `ext` in `SEQ`), or
- accept a smaller floor by adding a lower rung to `LADDER_D`.

Lighthouse (mobile, local, 4 runs): Performance 77–94 (median 90), Accessibility 100, Best Practices 100, SEO 100. CLS ≈ 0, and the initial download is about 2.6 MB.
