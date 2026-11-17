# OpenPixel Studio — Design Notes

**Date:** 16 November 2026 (design polish sprint, before Studio Phase 2)
**Scope:** the web app (`apps/web`) only. The desktop app still uses
Tailwind (see the audit §13) and is out of scope until its MUI
migration (Raju's decision, Phase 6/7).

**Why this exists:** Raju rated the MUI + Three.js redesign 3/10 —
professional intent, unprofessional result. The audit found the
problems were not the framework but the details: a 3D backdrop that
shouted over the content, walls of copy, no type hierarchy, cards
with no border or shadow, and 16px gaps everywhere. This document
records the rules the polish sprint applied, so every future tab
(PDF, OCR, Documents) is born into the same calm, clean system —
and so a future change can be judged against the rules instead of
taste.

**Single source of truth:** `apps/web/src/theme/theme.ts`
(`getTheme(mode)`). Nothing in `src/components/` hard-codes a brand
colour or a hex value — use `theme.palette`, `sx`, or the component
overrides in that file. The shared shell is `App.tsx` (header, tabs,
footer, theme toggle, 3D backdrop switch).

---

## 1. Spacing — 8px scale, generous by default

- Section gaps: **24px** (`Stack spacing={3}` at the section level).
- Card padding: **24px** on all sides (theme `MuiCardContent`).
- Main content: **32px** vertical padding (`Container py: 4`).
- Control groups inside a card: **20px** (`Stack spacing={2.5}`).
- Field label → control: **4px** (`mt: 0.5`).
- Helper text under a control: **4px** (`mt: 0.5`).
- Never use `spacing={1}` between unrelated blocks, and never
  invent a one-off pixel value when a scale step fits.

## 2. Typography — one size per job

| Role | Variant | Size / weight |
|---|---|---|
| Page title (one per tab) | `h5` | 22px / 650, −0.01em |
| Brand wordmark | `h5` + teal `.` | 22px / 650 |
| Card section label | `overline` | 12px / 600, +0.08em, uppercase, `text.secondary` |
| Field label | `subtitle2` | 14px / 600 |
| Body | `body1` / `body2` | 16px / 14px |
| Helper / caption | `caption` | 12px, `text.secondary` |

- Tab intro copy is **two sentences max, ~55 words**, one idea per
  sentence, `maxWidth: 720` so lines stay readable. Detail that
  only matters after upload belongs in the warning/status area,
  not in the intro.
- Headings are sentence case. Labels are sentence case. No
  all-caps except `overline`.
- Never bold a whole paragraph. Bold marks the one fact that
  matters (`Converted: …`, a file size), nothing else.

## 3. Colour — restrained, three hues only

- Primary brand blue `#2563eb`, secondary teal `#0d9488`, slate
  neutrals (`#0f172a` / `#475569` / `#94a3b8` / `#e2e8f0` light;
  `#f1f5f9` / `#94a3b8` / `#334155` dark). **No new hues.**
- Status colours come from the palette (`success` / `warning` /
  `error` / `info`) — never a hard-coded hex. Notice boxes use
  `alpha(palette.<status>.main, 0.08)` background with a
  `0.4`-alpha border, and default text colour.
- The 3D backdrop uses brand blue + teal only, at low opacity
  (see §6).
- Dark mode is a palette mode, not a second design: the same
  cards, radii and spacing, with `paper #1e293b` on `default
  #0f172a` and a border + soft shadow for separation.

## 4. Cards, tables, controls

- **Cards:** 16px radius, 1px `divider` border, soft shadow
  (`0 1px 2px + 0 8px 24px -12px`, theme-aware). No elevation-only
  cards — in dark mode elevation is invisible without the border.
- **Controls:** 10px radius (buttons, inputs, selects). Primary
  contained buttons are flat (no shadow); the colour does the
  work.
- **Tabs:** 15px semibold labels, 48px min height (tap targets
  stay ≥ 44px), 2px indicator.
- **Tables:** 12px uppercase header labels in `text.secondary`,
  12px × 16px body cells, 1px divider border on the container.
- **Sliders:** thin 4px track, 18px thumb. The value stands out,
  not the chrome.
- **Toggle groups:** separated pills (8px gap, 8px radius,
  divider border); selected = 8% primary tint + primary text.
- **Drop zone:** paper background (never grey `action.hover` —
  grey reads as disabled), 1.5px dashed divider border, 40px
  padding, a 64px tinted circle behind the upload icon. Dragging
  state = primary border + 6% primary tint.

## 5. Layout

- One column of work per tab; two columns only for a genuine
  pair (source + output, original + result). Never three.
- Settings-style pages use a responsive grid
  (`7fr / 5fr` on `md+`, stacked on mobile) — a single narrow
  card in a wide container wastes the page.
- The header is one row (wordmark + theme toggle) with the tabs
  directly below, separated by 8px. The footer is **one line**.
- Preview images: `maxHeight 320`, `objectFit: contain`,
  centred, 8px radius. Thumbnails: 56–64px, cover, 8px radius.

## 6. Motion and decoration

- The Three.js backdrop is decoration and must never compete
  with the workspace: ~160 particles at 0.28 opacity, 4 small
  wireframe shapes (scale 0.35–0.7, opacity 0.07–0.11), slow
  rotation, camera pulled back (z 9.5). If the backdrop is
  noticeable before the content, it is too loud — turn it down,
  not up.
- The backdrop respects `prefers-reduced-motion` (one static
  frame) and pauses when the tab is hidden. The Settings
  "3D background" switch turns the whole chunk off.
- No other animation, no gradients, no decorative clutter.
  Motion exists only to confirm an action (button press, file
  added), never to decorate.

## 7. Copy rules

- Say what the tool does in one line. Say where files go
  ("never leave your device") once per tab, not once per card.
- Honest status only: a result line reports the real size change
  ("3% larger" when the file grew, never "0% smaller"); a
  limitation is stated where it applies (WebP target size,
  AVIF needs the CLI), not hidden in Settings.
- Error copy names the cause and the next step. "Conversion
  failed:" is reserved for a conversion that was actually
  attempted — probe failures carry their own message.

## 8. What NOT to change

- **E2E contracts are frozen:** tab/panel ids, `#convert-file`,
  `#target-format`, `#resize-*` ids, `role="status"` /
  `role="alert"`, button and drop-zone texts, and the exact
  strings the suite asserts on (`WASM engine’s BMP`,
  `Converted:`, `Resized:`, `Expected result:`, `Converted with
  the built-in WASM engine`, `only the first frame`,
  `Resized to 256×192 for ICO`). Restyle around them; never
  rename or reword them.
- **Behaviour is frozen by this sprint:** no new features, no
  logic changes, no conversion/resize changes. A polish sprint
  that changes behaviour is a feature sprint wearing a costume.
- **Tap targets stay ≥ 44px** (tabs 48px, buttons, switches).
- **Theme toggle and 3D toggle keep working** in both modes;
  the `dark` class on `<html>` stays for the e2e suite.

## 9. Checklist for a new tab (PDF, OCR, Documents)

1. Plug into `App.tsx` tabs + `theme.ts` — no local colours,
   radii, or spacing inventions.
2. One `h5` title + ≤ 2-sentence intro (`maxWidth: 720`).
3. Cards with an `overline` section label; 24px section gaps.
4. Drop zone = the shared `DropZone` component.
5. Notice boxes = theme-alpha status boxes, `role="status"`.
6. Every button maps to a real engine call; every status line
   reports a real result.
7. Screenshots in both modes, eyeballed before commit.

## 10. Phase 6 audit — the pre-Studio shell (17 Nov 2026)

Audited before building the unified Studio frontend (prompt §28
Phase 1). What the site was:

- **Navigation:** seven header tabs (Convert / Resize / PDF /
  OCR / Batch / Formats / Settings), no sidebar, no homepage,
  no All Tools directory, no workspace, no recent files. The
  landing page was the Convert tab itself.
- **Identity:** wordmark "OpenPixel." + tagline "Local image
  conversion". The PDF/OCR tools already lived under the same
  header, but nothing said "Studio" anywhere.
- **Theme:** brand blue `#2563eb`, teal `#0d9488`, slate
  neutrals, system font stack, cards 16px radius, controls 10px
  radius, 8px spacing scale (this document's rules).
- **Inconsistencies found:** (a) each workspace restates the
  "files never leave your device" line in its own words;
  (b) the PDF tab is a long vertical stack of cards — its edit
  tools sit far below the preview; (c) no shared page pattern:
  tool pages have no breadcrumb, no common header, no
  "process another file" affordance; (d) the Formats tab is a
  reference table hidden as a seventh tab; (e) no way back to a
  file you processed yesterday (no history at all).

### Honest tool inventory (what the web app really does, 17 Nov 2026)

This is the inventory the All Tools directory is built from.
Anything not on this list is shown as **Coming Soon**, never as
a working-looking button.

- **Image (web, real):** Convert (16 browser targets, canvas +
  WASM), Resize (Fit/Fill/Pad/Exact, presets, aspect lock,
  never-upscale, target-size mode, batch + zip, Before/After),
  Batch convert (up to 4 concurrent), metadata read (EXIF/ICC/
  XMP detection; web conversion always strips metadata).
- **PDF (web, real):** info, pdf.js preview, PDF→image
  download, page ops (rotate/extract/remove/reorder/duplicate/
  insert/replace/reverse/booklet/N-up), compress (screen/ebook/
  printer), edit overlays (text/images/shapes/highlight/draw/
  comments/page numbers/header-footer), redaction (within one
  Tj/TJ run only), flatten, metadata edit, repair, sanitise,
  threat inspection, text extraction (txt/html), image→PDF.
- **PDF (CLI/desktop only — label as such on the web):**
  protect/unlock/watermark, digital signatures, searchable-PDF
  OCR, PDFium rendering, extract-text to EPUB/DOCX.
- **Document conversion (CLI/desktop only, LibreOffice):**
  DOCX/XLSX/PPTX/ODT/ODS/ODP/RTF/TXT/CSV/HTML ↔ PDF and
  between Office formats. No Office conversion runs in the
  browser (LibreOffice cannot run in WASM).
- **OCR (web, real):** image OCR, English + Bengali
  (tesseract.js, self-hosted), PSM, enhance toggle, text
  download. Searchable-PDF OCR is CLI-only.
- **Not built anywhere:** background removal, audio/video
  conversion, table extraction, media tools, one-click
  PDF→Word on the web (text extraction exists — label it
  honestly), interactive form filling, in-place text editing.
- **Workspace data:** there is no account and no server. Recent
  Files / My Files derive only from a local activity record
  (file name, size, type, tool, result, date) in localStorage
  — never file contents, never a fake history. Empty until the
  user processes something.

### Phase 6 decisions (prompt-driven, 17 Nov 2026)

- **Shell:** app shell (header + sidebar + content + footer),
  not the A/B/C directions shown to Raju earlier — the master
  prompt supersedes them.
- **Tokens:** prompt §5–7 tokens replace the old ones (primary
  `#3157D5` light / `#829BFF` dark; background `#F7F8FC` /
  `#0B1020`; Inter + Noto Sans Bengali, self-hosted via
  @fontsource — no Google Fonts CDN).
- **3D background:** stays as a Settings toggle, default **off**
  in the new shell (minimal decoration per the prompt).
- **No auth pages:** no backend exists; Sign In / Sign Up are
  not built. The header profile area says so plainly.
- **Desktop:** out of scope (Phase 7).

## 11. Phase 6 as built (17 Nov 2026)

- **Tokens live in `apps/web/src/theme/theme.ts`** (`getTheme(mode)`):
  light primary `#3157D5` / primary-dark `#2443AA`, background
  `#F7F8FC`, surface `#FFFFFF`, surface-secondary `#F1F4F9`, text
  `#172033` / `#64748B`, border `#E2E8F0`, success `#16A36A`,
  warning `#E6A23C`, error `#DC4C4C`, info `#3284D6`; dark
  background `#0B1020`, surface `#121A2B`, elevated `#19243A`,
  primary `#829BFF`, text `#F1F5FB` / `#A3AEC2`, border `#26344D`,
  success `#39C98A`, warning `#F0B64D`, error `#F07878`, info
  `#64A9F5`. Inter + Noto Sans Bengali via `@fontsource`
  (self-hosted woff/woff2, no CDN). 8px spacing; sidebar 248px /
  collapsed 72px; header 64–72px; content max-width 1440px; page
  padding 24–32px (16px mobile); card radius 12, dialog 16,
  button 8; input min-height 44.
- **Shell:** `src/components/layout/AppShell.tsx` + `src/lib/routes.ts`
  (route registry, tool inventory, nav groups, titles, search) +
  `src/lib/activity.ts` (local history). Pages: `HomePage`,
  `ToolsDirectory`, `Workspace` (dashboard / My Files / Recent),
  `HelpPage`, `ToolCard`, `ToolPageHeader`, `EditorShell`,
  `PdfThumbnails`, `src/components/layout/notify.ts` (snackbar
  channel, kept out of AppShell for fast refresh).
- **Homepage upload routing is real:** the file is sniffed and
  handed to the workspace (`initialFiles`, consumed once,
  StrictMode-safe via a ref guard) — not just a navigation.
- **E2E contracts kept:** all `tab-*` / `panel-*` ids, all
  workspace ids, `role="status"` / `role="alert"`, result strings.
  The one behaviour change is the default route: Home, not
  Convert — `web-e2e.mjs`, `web-nowasm.mjs` and `live-matrix.mjs`
  click `#tab-convert` after load (added `tab-tools` id for the
  All Tools nav item). `resize` / `pdf` / `ocr` scripts already
  clicked their tab.
- **Viewport QA** (`apps/web/e2e/viewport-qa.mjs`, 15/15): no
  horizontal overflow at 360×800 / 768×1024 / 1440×900 on Home,
  All Tools, Convert, PDF tab, Settings. The run caught a real
  bug — the centered logo button covering the hamburger on
  phones (see `docs/WEB.md`, header gotcha) — fixed, not waived.
- **What Phase 6 did NOT build:** auth pages (no backend);
  Bengali UI strings (preference stored, UI stays English);
  background removal / audio-video / table extraction / media
  tools (labelled Coming Soon); PDF→Word one-click web tool
  (text extraction exists); desktop Tailwind→MUI migration
  (Phase 7); undo/redo in the editors (nothing faked).
