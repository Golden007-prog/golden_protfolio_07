# Lottie credits

Every animation in `public/lottie/` comes from the free LottieFiles library and is used under the
[Lottie Simple License (FL 9.13.21)](https://lottiefiles.com/page/license). The licence was checked on
each animation's own page on 2026-09-25 (rendered in headless Chromium; every page reads "Free to use
under the Lottie Simple License"). The source URL, author and frame data below were also checked against
the LottieFiles API (`publicAnimationByHash`).

The LSL allows download, modification and redistribution, including commercial use, and does not require
attribution. Modified files count as derivative works and have to be distributed under the same licence,
so **the recoloured and optimised files in `public/lottie/` are distributed under the Lottie Simple
License**, not under the rest of the repository's terms. Attribution is optional; if a visible credit is
added to the site, the licence asks that it be visible to the end user.

## Regenerating

```sh
node scripts/fetch-lottie.mjs      # download, validate, bake for the light player, minify (10 files)
node scripts/recolor-lottie.mjs    # recolour to brand tokens, round to 3 decimals, strip metadata (13 files)
node scripts/recolor-lottie.mjs --report   # print palettes without writing
```

`fetch-lottie.mjs` rejects any file with raster images (embedded `data:` URIs, `e:1` or external image
assets) or over 30 KB minified, and exits non-zero on any failure without writing that file. Because
`LottieIcon` plays files with lottie-web's light build, which has no expression engine and registers no
layer effects, it also rejects expressions and rendered effects unless it can remove them losslessly:
whole-range `loopOut('cycle'|'pingpong')` expressions are baked into keyframes, effect types that no
lottie-web build renders are dropped, and top-level layers that can never be on screen are dropped.
`recolor-lottie.mjs` is idempotent and takes `error.json`'s red from the dark `--app-danger` in
`src/index.css` (currently `#FB7185`).

## Files

| File | Animation | Author | Source | Licence | Frames | Canvas | Bytes (source → shipped) |
|---|---|---|---|---|---|---|---|
| `error.json` | fail | [Minji](https://lottiefiles.com/minji) | [fail-w75UyCGaBK](https://lottiefiles.com/animations/fail-w75UyCGaBK) | LSL | 0–90 @ 60 fps (1.5 s) | 180×180 | 2,678 → 2,326 |
| `send.json` | Send | Simon Quintana | [send-ECdBgrNQYq](https://lottiefiles.com/animations/send-ECdBgrNQYq) | LSL | 0–24 @ 24 fps (1.0 s) | 80×74 | 2,397 → 2,175 |
| `wave.json` | wave | Jacob Johnson | [wave-sq8KP9uwNS](https://lottiefiles.com/animations/wave-sq8KP9uwNS) | LSL | 0–250 @ 25 fps (10 s) | 1080×1080 | 5,446 → 5,098 |
| `copy-check.json` | copy check | [juan pablo](https://lottiefiles.com/juanpa) | [copy-check-H9tRpAfCYE](https://lottiefiles.com/animations/copy-check-H9tRpAfCYE) | LSL | 0–40 @ 30 fps (1.33 s) | 80×80 | 4,667 → 3,784 |
| `download.json` | download arrow | Ihtisham | [download-arrow-IN08fp3sGD](https://lottiefiles.com/animations/download-arrow-IN08fp3sGD) | LSL | 0–30.94 @ 29.97 fps (1.03 s) | 500×500 | 2,872 → 2,637 |
| `rocket.json` | rocket launch | Manuel Sanchez | [rocket-launch-GvTteAPPE9](https://lottiefiles.com/animations/rocket-launch-GvTteAPPE9) | LSL | 0–80 @ 29.97 fps (2.67 s) | 1080×1080 | 26,812 → 21,452 |
| `empty-search.json` | No results found | [Yogesh Pal](https://lottiefiles.com/yogeshpal) | [no-results-found-gfuuj6dxfU](https://lottiefiles.com/animations/no-results-found-gfuuj6dxfU) | LSL | 0–121 @ 60 fps (2.02 s) | 500×500 | 6,145 → 5,253 |
| `typing.json` | Typing in chat | [Jonas Alvarson](https://lottiefiles.com/jalvarson) | [typing-in-chat-xL2kPNJSBN](https://lottiefiles.com/animations/typing-in-chat-xL2kPNJSBN) | LSL | 0–40 @ 29.97 fps (1.33 s) | 169×86 | 5,553 → 4,591 |
| `sparkle.json` | star shine | LottieFiles user `famkqdec7bz9gbub` (no display name) | [star-shine-eA7UrOTpO9](https://lottiefiles.com/animations/star-shine-eA7UrOTpO9) | LSL | 0–30 @ 29.97 fps (1.0 s) | 200×200 | 2,901 → 2,427 |
| `calendar.json` | calendar, date, book | Mikael Olsson | [calendar-date-book-2YTaBNupRe](https://lottiefiles.com/animations/calendar-date-book-2YTaBNupRe) | LSL | 0–60 @ 30 fps (2.0 s) | 200×160 | 8,242 → 6,087 |
| `dots.json` | Dots Loading animation | [Mitch](https://lottiefiles.com/mitch) | [dots-loading-animation-LRfCgWD2PP](https://lottiefiles.com/animations/dots-loading-animation-LRfCgWD2PP) | LSL | 0–81 @ 60 fps (1.35 s) | 1341×1212 | 3,961 → 3,196 |
| `scroll.json` | Mouse Scroll | Rohith R Krishnan | [mouse-scroll-89Sp6FQ1vA](https://lottiefiles.com/animations/mouse-scroll-89Sp6FQ1vA) | LSL | 0–115 @ 60 fps (1.92 s) | 32×32 | 2,811 → 2,299 |
| `success.json` | Message Sent Successfully \| Plane | [Creator Mahesh](https://lottiefiles.com/creatormahesh) | [message-sent-successfully-plane-QbtxbRhyJI](https://lottiefiles.com/animations/message-sent-successfully-plane-QbtxbRhyJI) | LSL | 0–75 @ 30 fps (2.5 s) | 1500×1500 | 11,551 → 9,716 |

The last three were added during the Next.js migration without a recorded source. They were traced on
2026-09-25 by searching LottieFiles and comparing every candidate with the committed file, ignoring only
colours and metadata; each match below is exact. Identical copies exist under several accounts, so the
table credits the earliest upload, and the other copies (all LSL, checked the same day) are listed here:
`scroll.json` also appears as [mouse-scroll-QohCqTpe8l](https://lottiefiles.com/animations/mouse-scroll-QohCqTpe8l)
(SandyEliezer, 2022-02-22; the credited upload is from 2021-03-15), and `success.json` also appears as
[has-been-sent-successfully-sM8QPkx1oI](https://lottiefiles.com/animations/has-been-sent-successfully-sM8QPkx1oI)
(2022-03-02) and [success-send-77S5oMkxtv](https://lottiefiles.com/animations/success-send-77S5oMkxtv)
(Bruno, 2022-10-15; the credited upload is from 2021-12-31). `dots.json` has one match (2020-07-27).

## Frame notes for consumers

Frame numbers are in each file's own frame rate. Where the plan quoted a figure that differs from the
file, the file wins, and consumers should read `op` from the animation (or use `onComplete`) rather than
hard-code it.

- **CopyButton, `copy-check.json`**: 0–40 @ 30 fps. The ring draws over 0–16 and contracts over 16–25,
  the disc fills over 21–28, the check strokes over 25–33, and a flash settles by 38. Play 0–40 once and
  hold the last frame, which is the "copied" state.
- **DownloadCvButton, `download.json`**: `op` is **30.94 @ 29.97 fps (1.03 s), not the ~36 in the plan**
  (36.09 belongs to a different upload by the same author,
  [download-arrow-ElDGSWu32T](https://lottiefiles.com/animations/download-arrow-ElDGSWu32T)). The arrow and
  baseline move over roughly 0–15 and are back in the start pose by 30, so play 0–op once after the click.
- **BackToTop, `rocket.json`**: 0–80 @ 29.97 fps. The rocket bob and flame pulse (0–21–39, then
  ping-pong, baked to keys at 57 and 78) are 2 frames past their start pose at 80, so the wrap is nearly
  seamless; two of the four orbit rings run 0–132 in the source, so they jump at the wrap, as they do in
  the original. Loop 0–80 while hovered or focused and return to frame 0 on leave. The art fills only about 40%×63% of the 1080 canvas (x 31–71%,
  y 19–82%), so size the player about 1.6× the intended rocket height or scale it inside an
  `overflow-clip` box. Two 30 px Gaussian blurs on the orbit rings are skipped by the light player; on the
  1080 px canvas that is about 1–2 px at 44–70 px player sizes, so the rings just look slightly crisper.
- **AskMeBot, `typing.json`**: `op` 40 @ 29.97 fps (1.33 s). The dots bounce in a stagger (0–31, 5–36,
  9–40), and every dot is back at rest by 40, so it can loop.
- **Hero kicker, `wave.json`**: the file holds five identical waves, each 31 frames (0–31, 50–81,
  100–131, 150–181, 200–231) with a 19-frame rest between them. For one wave after the intro, play the
  segment [0, 31] (1.24 s) once.
- **Contact submit, `send.json`**: 0–24 @ 24 fps; the plane moves out over 0–11 and back over 12–22,
  ending where it started. **`success.json`**: 0–75 @ 30 fps; the plane flies over 15–49 and the check
  draws over 40–62. Play once and hold the last frame.
- **Error states, `error.json`**: 0–90 @ 60 fps; the X pops in with an overshoot over 2–48 and holds
  from 48. Play once and hold the last frame.
- **Empty states, `empty-search.json`**: 0–121 @ 60 fps; the magnifier sway (0–60–120) ends where it
  starts and the face animates over 30–84.
- **Featured badge, `sparkle.json`**: 0–30 @ 29.97 fps. The amber star grows over 0–10 and is gone by
  23; the small neutral star grows over 1–14 and stays visible on the last frame, so hide the player
  after `onComplete` if nothing should remain.
- **EducationCard, `calendar.json`**: 0–60 @ 30 fps; the page flip runs 0–44 and frames 44–60 rest on
  the frame-0 pose. Play once in view.
- **`scroll.json` and `dots.json`**: `scroll.json` is 0–115 @ 60 fps and loops under the hero today;
  `dots.json` is 0–81 @ 60 fps and no component references it yet.

## Colours

Files are coloured for the dark theme with the brand tokens violet `#A855F7`, cyan `#22D3EE`, amber
`#F59E0B`, neutral `#E2E8F0` and, for `error.json` only, danger `#FB7185`. Fill and stroke channels are
written so that both `Math.round(c * 255)` and lottie-web's `Math.floor(c * 255)` give the exact token
hex, so hex→hex maps (`LottieIcon`'s `colors`) match them directly.

| File | Source colours → role |
|---|---|
| `error.json` | `#FA3535` → danger, `#FFFFFF` → neutral |
| `send.json` | `#F98F66` → cyan (matches the cyan `success.json` plane) |
| `wave.json` | `#ACAFFF` (hand) → neutral, `#9295E1` (palm crease) → violet |
| `copy-check.json` | `#6DCC5B`, `#87F572` → violet, `#FFFFFF` (check) → neutral |
| `download.json` | `#F0564E` (arrow) → violet, `#3D82C1` (baseline) → cyan |
| `rocket.json` | `#EBEEF0`, `#CED7DB` (body) → neutral; `#8E56EC`, `#262626`, `#525252` (fins, details) → violet; `#80DDE9` (window), `#5AE4A8` (rings) → cyan; `#F3CA3E` (flame) → amber |
| `empty-search.json` | `#85ADFF` → violet |
| `typing.json` | `#FFFFFF`, `#C9C9C9`, `#E0E0E0`, `#F0F0F0` → neutral |
| `sparkle.json` | `#FFF9E2` → amber, `#FFFFFF` → neutral |
| `calendar.json` | `#FFFFFF`, `#FF0000` → cyan (matches the education header) |
| `dots.json`, `scroll.json`, `success.json` | unchanged (minified only): `#A855F7` `#818CF8` `#22D3EE`; `#E2F6FD`; `#0E7490` `#67E8F9` `#22D3EE` |

Suggested `colors.light` maps for `LottieIcon`, from the light-theme tokens and checked in a render on
`#F7F5F0`:

- Default: `{ '#A855F7': '#7C3AED', '#22D3EE': '#0E7490', '#F59E0B': '#D97706', '#E2E8F0': '#2A2A33' }`
- `copy-check.json` and `error.json`, where neutral is a mark on a filled disc:
  `{ '#A855F7': '#7C3AED', '#FB7185': '#BE123C', '#E2E8F0': '#FFFFFF' }`
- `dots.json`: `{ '#A855F7': '#7C3AED', '#818CF8': '#6D28D9', '#22D3EE': '#0E7490' }`
- `scroll.json`: `{ '#E2F6FD': '#2A2A33' }` (the shipped colour disappears on the light background)
- `success.json`: `{ '#22D3EE': '#0891B2', '#67E8F9': '#0891B2' }` (keeps the darker `#0E7490` fold)

## Changes from the sources

Beyond colour, rounding and metadata, the only changes are the light-player clean-ups done by
`fetch-lottie.mjs`. `rocket.json` had two `loopOut('pingpong')` expressions baked into keyframes and an
unused, never-visible solid layer removed. `calendar.json` had two Puppet effects removed, which no
lottie-web build renders; it also has two merge paths, which lottie-web ignores in every build, exactly
as before. A render of every file at 24 sampled frames against the original (full lottie-web build)
matched in shape (alpha-mask IoU ≥ 0.98 at 200 px, 1.0 for most). For the three minify-only files the
largest colour change is 2/255 on `dots.json`, `scroll.json` is pixel-identical, and `success.json`
differs by at most 7/255 on 36 anti-aliased edge pixels out of 960,000 sampled.
