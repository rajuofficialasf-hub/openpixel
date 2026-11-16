# Migration Plan — OpenPixel Engine → OpenPixel Studio

**Date:** 16 November 2026
**Basis:** `docs/EXISTING_PROJECT_AUDIT.md` (HEAD `ba9cc1e`).
**Status:** Plan only. No code changes in Phase 0. Nothing here is
approved until Raju decides the open questions in §8.

## 1. Goal and non-goals

**Goal:** grow the existing OpenPixel Engine into OpenPixel Studio —
one product, one design system, one engine family — adding a PDF
Engine, an OCR Engine (English + Bengali), a Document Conversion
Engine (Office formats), and File Security, with an optional
self-hosted backend and mobile last.

**Non-goals for this migration:**
- No rewrite of the image engine. No crate renames. No change to
  CLI commands, WASM exports, e2e selectors, or public URLs.
- No new product, no second repository, no second website.
- No AI Document Intelligence in this migration (extensible
  module after the core platform is stable, per the prompt §18).
- No paid/third-party processing APIs, ever, without explicit
  approval.

## 2. Target architecture

```
openpixel-engine/                          (same repo, same workspace)
│
├── apps/
│   ├── web/            # React + MUI — UNIFIED Studio site (Convert/Resize/
│   │                   # Batch/PDF/OCR/Documents/All Tools; theme.ts shell)
│   ├── desktop/        # Tauri 2 — same engine, native file access
│   ├── cli/            # openpixel binary — pdf/ocr/document subcommands
│   ├── android/        # LAST — Tauri Mobile or native SDK (Phase 7)
│   └── ios/            # LAST — same (Phase 7)
│
├── crates/
│   ├── openpixel-core/       # KEEP — Engine + security limits + error types
│   ├── openpixel-formats/    # KEEP — + document signature detection
│   ├── openpixel-codecs/     # KEEP — image-only registry (do not widen)
│   ├── openpixel-pipeline/   # KEEP — + OCR preprocessing ops (deskew/denoise)
│   ├── openpixel-metadata/   # KEEP — + PDF Info/XMP policy reuse
│   ├── openpixel-jobs/       # GENERALISE — job trait so PDF/OCR share the pool
│   ├── openpixel-wasm/       # KEEP — + WASM-safe PDF ops only (lopdf-backed)
│   ├── openpixel-color/      # PROMOTE from stub — ICC / colour spaces
│   ├── openpixel-security/   # PROMOTE from stub — validation, temp workspace,
│   │                         # timeouts/RSS, PDF sanitisation
│   ├── openpixel-api/        # PROMOTE from stub — shared /api/v1 types
│   ├── openpixel-pdf/        # NEW — PDF engine (lopdf core, PDFium render)
│   ├── openpixel-ocr/        # NEW — OCR engine (Tesseract native, tesseract.js web)
│   └── openpixel-documents/  # NEW — DocumentFormat + Office adapter types
│
├── adapters/
│   ├── pdf/            # pdfium-render / qpdf FFI shims (native only)
│   ├── office/         # LibreOffice headless subprocess (desktop/server only)
│   └── ocr/            # tesseract-sys / leptonica shims (native only)
│
├── backend/            # LAST (Phase 8) — api / workers / scheduler / storage
│   └── (optional self-hosted FastAPI + PostgreSQL + Valkey + S3)
│
├── packages/
│   ├── shared-types/   # generated TS types from openpixel-api (single source)
│   ├── engine-sdk/     # (only if a second consumer needs it — defer)
│   └── ui-components/  # MUI workspaces shared by web + desktop (Phase 6)
│
├── native/             # C/C++ FFI build + licence texts (exists; extend)
├── tests/              # populate or remove (currently empty — audit §9.8)
├── scripts/            # existing build/release/test/setup scripts (extend)
└── docs/               # + STUDIO docs (this plan, roadmap, API spec, DB ERD)
```

**Naming rule:** keep the `openpixel-*` crate naming. No existing
crate is renamed. New crates follow the same pattern. The prompt's
§11 sketch uses `image-engine/` / `pdf-engine/` style names — those
are conceptual, not literal; the literal names are `openpixel-pdf`
etc., because the existing crates are already `openpixel-*` and a
rename would churn every import for zero benefit.

## 3. New modules

| Module | Contents | First appears |
|---|---|---|
| `crates/openpixel-pdf` | `PdfEngine` (validate/inspect/process/optimize/export/health_check); page ops (merge, split, extract, remove, rotate, reorder, duplicate, insert, replace, reverse, booklet, N-up); render-to-image via PDFium adapter; text/image/font/attachment extraction; metadata edit; compression (3 modes); security (password, redact, flatten, sanitise); repair/compare/info | Phase 1 (foundation) → Phase 2 (core features) |
| `crates/openpixel-ocr` | `OcrEngine`; `OcrResult` (text, bounding boxes, confidence, reading order, language); preprocessing via pipeline; Tesseract native adapter; searchable-PDF writer; table/layout hooks (PaddleOCR later, not now) | Phase 4 (after PDF) |
| `crates/openpixel-documents` | `DocumentFormat` (DOC/DOCX/XLS/XLSX/PPT/PPTX/ODT/ODS/ODP/RTF/TXT/CSV/HTML/EPUB/PDF) with signature detection; conversion job types; font-substitution + error reporting types | Phase 3 (with Office conversion) |
| `crates/openpixel-security` (promote) | File validation, temp-workspace isolation + auto-cleanup, processing timeouts, RSS cap (closes audit A8/A9), PDF sanitisation (no JS execution, embedded-file inspection), password handling | Phase 1 (before PDF work) |
| `crates/openpixel-api` (promote) | Shared `/api/v1` request/response types, job types, error shapes; OpenAPI source of truth | Phase 1 (types only) → Phase 8 (backend) |
| `crates/openpixel-color` (promote) | ICC parsing + conversion (move from `openpixel-metadata::icc`), colour-space conversion for PDF grayscale/colour work | Phase 2/5 (when PDF colour work needs it) |
| `adapters/pdf`, `adapters/office`, `adapters/ocr` | Thin FFI/subprocess shims behind traits; each adapter is feature-gated and reports honest capability (missing system lib → planned entry, never a crash) | With their engines |
| `packages/shared-types` | Generated TS types from `openpixel-api` — frontend and backend share one contract | Phase 6 (unified frontend) |
| `backend/` | FastAPI + PostgreSQL + Valkey + S3-compatible storage; workers run the same Rust engines | Phase 8 (last) |

## 4. Required modifications to existing code

| Existing code | Modification | Risk |
|---|---|---|
| `openpixel-formats` | Add document signature detection (`%PDF`, ZIP-based Office/EPUB, RTF `{\\rtf`, plain text) alongside image detection. `ImageFormat` untouched; new `DocumentFormat` lives in `openpixel-documents` and reuses `discover()`'s design. | Low — additive only |
| `openpixel-jobs` | Generalise `JobManager` from image jobs to a job trait / generic job payload so PDF/OCR/document jobs share the pool, progress, cancel, retry. Keep the existing image behaviour byte-identical (regression tests). | Medium — the only shared-infrastructure refactor; needs care, not a rewrite |
| `openpixel-core` | Add the `ProcessingEngine` trait (`validate/inspect/process/optimize/export/health_check`); `Engine` implements it. Add `EngineConfig` fields for timeouts/RSS (from `openpixel-security`). No change to existing `Engine` methods. | Low–Medium — additive trait; existing methods untouched |
| `openpixel-pipeline` | Add OCR preprocessing ops (deskew, denoise, threshold/binarise, orientation detect) as new `Operation` variants. Existing ops untouched. | Low — additive |
| `openpixel-metadata` | Move ICC code toward `openpixel-color` (re-export for compatibility); add PDF Info/XMP handling reusing `MetadataPolicy` + `PreservationReport`. | Low — move with re-exports, no behaviour change |
| `openpixel-wasm` | Add WASM-safe PDF ops only (lopdf-backed page ops; no PDFium, no Tesseract, no LibreOffice). Feature-gate everything native. The wasm32 build must stay green or the web deploy breaks. | Medium — build-gate discipline; CI must build wasm32 on every PR touching shared crates |
| `openpixel-security` (stub) | Write the real crate (see §3). `core::security` keeps its public API; new crate adds temp workspace + timeouts + sanitisation. | Low — new code, no behaviour change to existing limits |
| `apps/web` | Add PDF / OCR / Document tool tabs + All Tools directory + unified homepage, reusing `theme.ts` + `App.tsx` shell + `capabilities.json` generation (extended to the new engines). pdf.js for in-browser PDF render; tesseract.js for in-browser OCR. No Tailwind (see §7). | Medium — largest frontend work; keep e2e selectors stable, add new ones for new tabs |
| `apps/desktop` | Add PDF/OCR/document commands (same engines as CLI); decide the Tailwind question (§7) before the unified frontend lands. | Medium — Tailwind decision gates the frontend work |
| `apps/cli` | Add `pdf`, `ocr`, `document` subcommands (same engines, same `--json` discipline). Existing commands untouched. | Low — additive |
| `docs/` | Add STUDIO docs (API spec, DB ERD, security, licence audit, testing strategy — prompt §18 list); fix the stale baselines (audit §9.7) with a "last verified" stamp. | Low — docs only |
| `Cargo.toml` / CI | New workspace members; new feature flags (`native-pdf`, `native-ocr`, `office`); CI jobs for the new crates + wasm32 build check; licence check step (cargo-deny or equivalent) + SBOM regeneration covering new deps. | Medium — CI matrix grows; keep jobs cached and selective |
| `tests/` | Populate with shared fixtures (PDF + Office + OCR samples) or remove the empty dir. | Low |

## 5. Dependency changes

Pin exact versions (same discipline as today). Full pre-check with
licences is in `docs/EXISTING_PROJECT_AUDIT.md` §14.

| Dependency | Where | Purpose | Licence | Platform note |
|---|---|---|---|---|
| lopdf `=0.47.0` | `openpixel-pdf` | PDF manipulation (merge/split/rotate/pages/metadata) | MIT | Pure Rust — **WASM-safe** |
| pdfium-render `=0.9.5` | `adapters/pdf` | PDF rendering + text extraction (native) | MIT OR Apache-2.0 (binding); PDFium BSD-3-Clause | Needs PDFium binary (prebuilt download by default — record provenance in licence registry) |
| pdfjs-dist `=6.5.438` | `apps/web` | In-browser PDF rendering/viewing | Apache-2.0 | Browser only |
| tesseract-sys `=0.6.3` (+ system tesseract/leptonica) | `adapters/ocr` | Native OCR (eng + ben) | MIT (binding); Tesseract Apache-2.0; Leptonica BSD-2-Clause | System libs on every platform — CI matrix work |
| tesseract.js `=7.0.0` | `apps/web` | In-browser OCR (WASM) | Apache-2.0 | Browser only; `ben`/`eng` traineddata shipped as app assets |
| LibreOffice 26.8.3 (headless) | `adapters/office` | Office ↔ PDF conversion | MPL-2.0 | Desktop/server only; ~286 MB; subprocess |
| qpdf v12.4.2 | `adapters/pdf` (only if lopdf proves insufficient) | Structural PDF (linearise, repair, encryption) | Apache-2.0 | C++ FFI — defer the decision to Phase 2 |
| **Ghostscript** | — | — | **AGPL-3.0** | **DO NOT USE** |
| PaddleOCR / OpenCV / libvips | — | — | Apache-2.0 / LGPL-2.1 | Deferred — Tesseract + pipeline first; libvips not needed at all |

**Licence governance (prompt §15):** every new dependency gets a
row in a Licence Registry (new doc in Phase 1) with exact version,
licence, bundled deps, redistribution requirements, and static/
dynamic linking notes; `THIRD_PARTY_NOTICES.md` + `LICENSE_AUDIT.md`
+ SBOM regenerated with each adoption. `cargo-deny` (or equivalent)
runs in CI. AGPL is a hard no without a full review.

## 6. Potential breaking changes

Intended: **none.** The migration is additive by design. The
following are the only places a break could leak in, and each has a
guard:

- `openpixel-jobs` generalisation — guard: existing batch tests
  + CLI e2e §6 must pass byte-identically before and after.
- `openpixel-metadata` ICC move — guard: re-exports keep every
  existing import path compiling; deprecation, not removal.
- `EngineConfig` gaining timeout/RSS fields — guard: new fields
  have defaults; existing constructors keep working.
- Web app gaining tabs/routes — guard: existing tab ids, e2e
  selectors, and the Convert/Resize/Batch flows keep their
  current behaviour; new tabs get new ids.
- Desktop Tailwind decision (§7) — guard: whichever way Raju
  decides, the desktop's existing tabs keep working through the
  change; it is a presentation migration, like the web redesign.

## 7. The Tailwind decision (carried from the audit)

The prompt says Tailwind; the web app is MUI (Raju's decision,
commit `23fa5a3`). **Keep MUI for the Studio web frontend.**
The desktop frontend still uses Tailwind 3.4.17. Before Phase 6
(unified frontend), Raju must decide:

- **(a) Migrate desktop to MUI** (recommended — one design system,
  shared `packages/ui-components`, one cohesive product), or
- **(b) Keep desktop on Tailwind** (less work now, two design
  systems forever).

This plan assumes (a) but does not start it. The migration itself
is presentation-only (same Tauri commands, same engine) and is
scoped as a Phase 6/7 task.

## 8. Migration risks (ranked)

1. **PDF library choice is the highest-stakes decision.** lopdf
   (manipulation) + PDFium (rendering) is two libraries, not one;
   PDFium's prebuilt-binary provenance and qpdf's C++ FFI are the
   two traps. Mitigation: Phase 1 prototypes both paths on real
   files (merge + render a 100-page PDF) before committing.
2. **Office conversion quality.** LibreOffice headless is the only
   realistic open-source route, and its layout fidelity is
   imperfect by design. Mitigation: never promise perfect
   formatting; ship font-substitution + error reporting from day
   one; desktop/server only, never in the browser.
3. **OCR accuracy expectations.** Bengali OCR is good, not
   perfect; conjuncts, reading order, and tables are the hard
   parts. Mitigation: confidence scores + bounding boxes on every
   result, a Bengali/English benchmark dataset (prompt §5), and
   never claim 100%.
4. **WASM build fragility.** One native-only dependency leaking
   into a shared crate breaks the web deploy. Mitigation:
   feature flags + a CI wasm32 build check on every PR.
5. **Scope creep — the prompt is very large.** 8 engines, 3
   platforms, backend, mobile, AI. Mitigation: the phase order
   in §9 is the scope control; nothing starts before its phase,
   and each phase has exit criteria (see Roadmap).
6. **Security surface grows with PDFs/Office.** PDFs execute JS,
   carry embedded files, and hide objects; Office files carry
   macros. Mitigation: `openpixel-security` first (Phase 1),
   never execute embedded JS, treat every upload as untrusted.
7. **Desktop click-through debt.** The desktop UI has never had a
   click-through test; adding PDF tabs multiplies the untested
   surface. Mitigation: Phase 6 adds a desktop smoke harness
   before new tabs land (or accepts the gap explicitly).
8. **CI time.** New crates + wasm32 + system deps (tesseract,
   LibreOffice) lengthen CI. Mitigation: selective workflows,
   caching, and keeping the web deploy independent of the
   desktop/Office jobs.

## 9. Milestones — prompt Phases 0–8 mapped to repo steps

**Phase 0 — Audit (this document + Roadmap). DONE in this delivery.**
Entry: repo at `ba9cc1e`. Exit: audit + migration plan + roadmap
written, uncommitted, reviewed with Raju. No code changed.

**Phase 1 — Unified Core Architecture.** Shared `ProcessingEngine`
trait in `openpixel-core`; promote `openpixel-security` (temp
workspace, timeouts, RSS cap — closes A8/A9) and `openpixel-api`
(types only); generalise `openpixel-jobs`; `openpixel-pdf`
foundation (crate skeleton, `DocumentFormat` detection, lopdf
wired, merge/split smoke test); licence registry started; CI
wasm32 check. Exit: all existing tests green + new crate tests
green + `cargo deny` clean. **PDF library decision is made here.**

**Phase 2 — Core PDF Features (FIRST user-facing PDF).**
Merge, split, rotate, extract/remove/reorder pages, PDF info,
PDF→PNG/JPG (PDFium render), image→PDF (lopdf + pipeline).
CLI `pdf` subcommand + web PDF tab (pdf.js render, lopdf-WASM
page ops where possible). Exit: CLI e2e PDF section green,
web PDF e2e green, live-site check. **DONE 16 Nov 2026** — all
exit criteria green except the live-site check, which the parent
agent runs after the push (see `docs/PDF.md` + `docs/E2E.md`
§1.15/§2.20). Also done in Phase 2 beyond the plan: duplicate,
insert, replace, reverse, booklet, N-up page ops; WASM
`pdf_info`/`pdf_process`/`pdf_merge`/`pdf_from_images` exports;
`Engine::encode_decoded`; `scripts/pdfium/fetch-pdfium.sh`
(pinned chromium/8152).

**Phase 3 — Conversion and Compression.** PDF compression (3
modes, honest size reporting — never claim smaller when larger);
Office→PDF and PDF→Office via LibreOffice headless
(**desktop/server only** — the browser shows an honest
"needs desktop/server" state); PDF→Word/Excel via the same
adapter. Exit: compression benchmarks + Office round-trip
fixtures green; fidelity limits documented.

**Phase 4 — OCR and Extraction.** English + Bengali OCR
(Tesseract native, tesseract.js web); image→text, scanned
PDF→text, searchable PDF, OCR→Word/Excel; table hooks;
Bengali/English benchmark dataset; confidence + bounding boxes
on every result. Exit: benchmark dataset + accuracy report
(honest numbers, never 100%).

**Phase 5 — Advanced Editing and Security.** PDF editor
(overlay content vs editing text objects — distinguished in
the UI), watermark, page numbers, password protect/unlock,
digital signatures, redaction (**real redaction, not black
overlays**), repair, metadata editing, sanitisation.
Exit: security tests (malicious PDFs) green.

**Phase 6 — Unified Frontend.** Image + PDF + Document + OCR
tools in one site; homepage (hero, tool search, popular tools,
categories); All Tools directory; reusable processing workspace;
local/server mode selection UI (no silent uploads). Desktop
Tailwind decision executed here. Exit: web e2e covers every
tool tab; live-site matrix re-run.

**Phase 7 — Desktop and Mobile.** Tauri integration of all
engines; Android/iOS via Tauri Mobile (shared Rust engine) —
native Kotlin/Swift only if Tauri Mobile proves insufficient.
Offline processing, capability checks per platform. Exit:
desktop installers on all three OSes; mobile build validation.

**Phase 8 — Production.** Security audit (new engines), load +
performance benchmarks, cross-platform QA, Docker deployment
for the optional backend (FastAPI + PostgreSQL + Valkey + S3),
monitoring, docs, release automation. Exit: release checklist
green; backend is optional — local-only still works with no
account and no database.

**Explicit ordering (do not reorder without a decision):**
Core PDF (Phase 2) before Office (Phase 3) before OCR
(Phase 4). Mobile + self-hosted backend are last (Phases 7–8).
AI Document Intelligence is after the core platform is stable,
not in this migration.

## 10. Open decisions for Raju (before Phase 1)

See also Roadmap §7. In short: (1) Tailwind vs MUI for desktop
(recommend MUI); (2) PDF library: lopdf + PDFium as proposed,
or lopdf-only first and PDFium later; (3) Office scope: full
Office↔PDF both ways in Phase 3, or Office→PDF only first;
(4) backend/mobile timing: confirm they stay last; (5) CI: keep
the 30-day artefact retention, or create a GitHub Release for
permanent download links.

**Decided by Raju, 16 Nov 2026 ~21:12 (Bengali reply):**
1. Desktop → **MUI** (one design system).
2. PDF library → **lopdf + PDFium, both**.
3. Office scope → **both directions** (full Office↔PDF in Phase 3).
4. Backend/mobile → **stay last** (Phases 7–8); backend stays optional.
5. CI/releases → **not decided** (not asked; keep 30-day retention for now).
6. OCR → **whichever is best** — architect's call: **Tesseract first** (audit recommendation; PaddleOCR deferred).
