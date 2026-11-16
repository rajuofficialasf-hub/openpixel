/* tslint:disable */
/* eslint-disable */

/**
 * Chroma subsampling format
 */
export enum ChromaSampling {
    /**
     * Both vertically and horizontally subsampled.
     */
    Cs420 = 0,
    /**
     * Horizontally subsampled.
     */
    Cs422 = 1,
    /**
     * Not subsampled.
     */
    Cs444 = 2,
    /**
     * Monochrome.
     */
    Cs400 = 3,
}

/**
 * Capabilities of the registry *in this build* — the same list the
 * native CLI reports, except AVIF is listed as unavailable (its
 * decoder needs native libdav1d). The web UI reads this instead of
 * hard-coding a format list.
 */
export function capabilities(): any;

/**
 * Convert `bytes` to `target` (a format id or extension, e.g.
 * `"jpeg"`, `"jpg"`, `"png"`, `"webp"`, `"tiff"`, `"qoi"`,
 * `"heic"`). `quality` is 1–100 and applies to JPEG/WebP targets
 * only; pass `undefined` for the engine default (80). `background`
 * is the `#RRGGBB` colour alpha is flattened to for targets
 * without alpha (pass `undefined` for white, the engine default).
 * Returns the converted bytes; the caller re-checks them with
 * [`detect`] / [`info`]. Metadata is always stripped by this
 * binding — the browser path has no metadata preservation story
 * yet; the CLI does.
 *
 * Errors when the source is unknown, undecodable in this build
 * (e.g. AVIF), or the target is not encodable in this build (e.g.
 * SVG is decode-only).
 */
export function convert(bytes: Uint8Array | number[], target: string, quality?: number | null, background?: string | null): Uint8Array;

/**
 * Detect the format of `bytes` from magic bytes only (never the
 * extension). Returns the format id (`"png"`, `"jpeg"`, …) or
 * `"unknown"`.
 */
export function detect(bytes: Uint8Array | number[]): string;

/**
 * Full discovery: signature first, extension/MIME only as a
 * low-confidence fallback, with mismatch reporting. Returns the
 * `DiscoveryResult` as a JS object.
 */
export function discover(bytes: Uint8Array | number[], extension?: string | null, mime?: string | null): any;

/**
 * Information about an image (format, dimensions, colour type,
 * animation, metadata presence) without converting it. Errors on
 * unknown formats and on formats this build cannot decode.
 */
export function info(bytes: Uint8Array | number[]): any;

/**
 * Compress a PDF (Phase 3): image downsample + re-encode and
 * structure optimisation. `options_json` is e.g.
 * `{"mode":"ebook","strip_metadata":false}` — `mode` is
 * `screen` | `ebook` | `printer` (default `ebook`).
 * Returns a JS object `{ data: Uint8Array, input_bytes,
 * output_bytes, saved_bytes, saved_percent,
 * images_recompressed, images_skipped, note }` — the sizes are
 * measured, never estimated. When the compressed file would be
 * larger and no transformation was requested, `data` is the
 * original bytes and `note` says so.
 *
 * The byte counts are emitted as JS **numbers** (f64), not
 * BigInts: `JsValue::from(u64)` becomes a BigInt in JS, and the
 * web UI does arithmetic on these fields (`formatBytes` divides
 * them) — a BigInt there throws "Cannot mix BigInt and other
 * types". f64 is exact for any real file size (PDFs are capped
 * at 100 MiB, far below 2^53).
 */
export function pdf_compress(bytes: Uint8Array | number[], options_json: string): any;

/**
 * Add overlay content to a PDF (Phase 5): `ops_json` is a JSON array
 * of overlay ops, e.g.
 * `[{"kind":"text","page":1,"x":72,"y":700,"text":"Hi","size":14,"color":{"r":0,"g":0,"b":0},"font":"helvetica"}]`
 * (kinds: text, image, rect, line, circle, highlight, draw,
 * comment, page_numbers, header_footer); `images` is a JS array of
 * `Uint8Array` (or undefined) supplying the image bytes for `image`
 * ops, by index. Overlays are NEW content layered on top of the
 * page — existing text is never edited in place.
 * Returns a JS object `{ data: Uint8Array, ops_applied,
 * pages_touched, comments_added, warnings }`.
 */
export function pdf_edit(bytes: Uint8Array | number[], ops_json: string, images: any): any;

/**
 * Flatten annotations and form fields into page content (Phase 5).
 * Returns a JS object `{ data: Uint8Array, annotations_flattened,
 * annotations_dropped, form_fields_removed, warnings }`.
 */
export function pdf_flatten(bytes: Uint8Array | number[]): any;

/**
 * Build a PDF from images (a JS array of `Uint8Array` — PNG, JPEG,
 * WebP, anything the engine decodes), one page per image, in order.
 * `page_size` is a named size ("A4", "Letter", "A5") or undefined
 * for one page per image at the image's own size in points.
 */
export function pdf_from_images(images: any, page_size?: string | null): Uint8Array;

/**
 * PDF info: page count, version, metadata, encryption, page sizes.
 * Returns the `PdfInfo` as a JS object.
 */
export function pdf_info(bytes: Uint8Array | number[]): any;

/**
 * List JavaScript actions and embedded files in a PDF (Phase 5) —
 * never executes anything. Returns the `PdfThreats` object
 * (`javascript`, `embedded_files`, `launch_actions`,
 * `auto_actions`, `warnings`).
 */
export function pdf_inspect(bytes: Uint8Array | number[]): any;

/**
 * Merge several PDFs (a JS array of `Uint8Array`) into one, in order.
 */
export function pdf_merge(documents: any): Uint8Array;

/**
 * One PDF page operation from the JS side. `ops_json` is a JSON
 * object, e.g. `{"kind":"rotate","pages":[1,3],"degrees":90}`,
 * `{"kind":"extract","pages":[1,3]}`,
 * `{"kind":"split","ranges":[[1,3],[5,7]]}`,
 * `{"kind":"reorder","order":[3,1,2]}`,
 * `{"kind":"nup","cols":2,"rows":2}`, `{"kind":"reverse"}`,
 * `{"kind":"booklet"}`. Kinds: split, rotate, extract, remove,
 * reorder, duplicate, reverse, booklet, nup. `pages` is optional
 * for rotate (default: all pages) and `degrees` defaults to 90.
 * Ops arrive as a JSON string — not a `JsValue` — so the parsing is
 * plain Rust and unit-testable without a JS runtime. Merge, insert
 * and replace take several documents, so they have their own
 * exports below.
 *
 * Returns a JS array of `Uint8Array` — one element per output
 * document (one for every op, one per range for split).
 */
export function pdf_process(bytes: Uint8Array | number[], ops_json: string): any;

/**
 * Really remove text from a PDF (Phase 5): `redactions_json` is a
 * JSON array of redactions, e.g.
 * `[{"kind":"rect","page":1,"x":72,"y":600,"width":200,"height":20}]`
 * or `[{"kind":"text","page":null,"text":"SECRET"}]`. The text is
 * deleted from the content stream, not covered with a black box.
 * Returns a JS object `{ data: Uint8Array, pages_touched,
 * runs_removed, characters_removed, annotations_removed,
 * redacted_texts, warnings }`.
 */
export function pdf_redact(bytes: Uint8Array | number[], redactions_json: string): any;

/**
 * Rebuild the cross-reference table of a damaged PDF (Phase 5).
 * Returns a JS object `{ data: Uint8Array, recovery, warnings }`.
 */
export function pdf_repair(bytes: Uint8Array | number[]): any;

/**
 * Strip JavaScript, embedded files, launch actions and
 * auto-actions from a PDF (Phase 5). The document is kept; the
 * dangerous parts are removed, not hidden. Returns a JS object
 * `{ data: Uint8Array, javascript_removed, embedded_files_removed,
 * launch_actions_removed, auto_actions_removed, warnings }`.
 */
export function pdf_sanitize(bytes: Uint8Array | number[]): any;

/**
 * Set document metadata (Phase 5): `metadata_json` is e.g.
 * `{"title":"…","author":null,"subject":"…","keywords":""}` — a
 * null leaves a field unchanged, an empty string clears it.
 * Returns the new PDF bytes.
 */
export function pdf_set_metadata(bytes: Uint8Array | number[], metadata_json: string): Uint8Array;

/**
 * Process `bytes` with a resize pipeline, then encode to `target`
 * — the Resize tab's entry point. `ops_json` is a JSON array of
 * resize operations, e.g. `[{"kind":"resize_fit","width":800,"height":600}]`
 * (kinds: `resize_fit`, `resize_fill`, `pad`, `resize`; `pad` takes
 * an optional `color` as `#RRGGBB`). Ops arrive as a JSON string —
 * not a `JsValue` — so the parsing is plain Rust and unit-testable
 * without a JS runtime. `quality` is 1–100 (JPEG,
 * HEIC, HEIF; pass `undefined` for the engine default 80);
 * `background` is the `#RRGGBB` colour alpha is flattened to for
 * targets without alpha (white when omitted); `png_compression`
 * is 0 = fast, 1 = default, 2 = best for PNG targets (ignored
 * for other formats; `undefined` is the engine default 1).
 *
 * Returns a JS object `{ bytes, width, height, warnings }` — the
 * resized bytes plus the result dimensions and any engine warnings
 * (e.g. the ICO auto-resize note). Errors when the ops are invalid,
 * the source is undecodable in this build, or the target is not
 * encodable here.
 */
export function process(bytes: Uint8Array | number[], ops_json: string, target: string, quality?: number | null, background?: string | null, png_compression?: number | null): any;

/**
 * Like [`process`], but the encode quality is searched so the
 * output fits inside `target_bytes` — "compress to X KB". Returns
 * `{ bytes, width, height, quality, target_met, warnings }`:
 * `quality` is the quality the search settled on (`null` for PNG,
 * where compression level is the knob), and `target_met` says
 * whether the target was actually reached. When it was not, the
 * bytes are still the smallest result found and the warnings say
 * the target was missed — never a silent overshoot.
 *
 * Only JPEG, HEIC and HEIF can be searched in this build (AVIF is
 * unavailable in WASM — its decoder needs native libdav1d — and
 * WebP is encoded losslessly only by image-rs, so quality does not
 * change its size). PNG tries best compression. Any other target
 * is an honest error.
 */
export function process_to_size(bytes: Uint8Array | number[], ops_json: string, target: string, target_bytes: bigint, background?: string | null): any;

/**
 * Formats this build can decode / encode, as format ids. The web UI
 * uses this to offer only targets the WASM engine can actually
 * produce, and to fall back to the canvas path for the rest.
 */
export function supported_formats(): any;

/**
 * The engine version this module was built from.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly capabilities: () => any;
    readonly convert: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly detect: (a: number, b: number) => [number, number];
    readonly discover: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly info: (a: number, b: number) => [number, number, number];
    readonly pdf_compress: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pdf_edit: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly pdf_flatten: (a: number, b: number) => [number, number, number];
    readonly pdf_from_images: (a: any, b: number, c: number) => [number, number, number, number];
    readonly pdf_info: (a: number, b: number) => [number, number, number];
    readonly pdf_inspect: (a: number, b: number) => [number, number, number];
    readonly pdf_merge: (a: any) => [number, number, number, number];
    readonly pdf_process: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pdf_redact: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pdf_repair: (a: number, b: number) => [number, number, number];
    readonly pdf_sanitize: (a: number, b: number) => [number, number, number];
    readonly pdf_set_metadata: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly process: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly process_to_size: (a: number, b: number, c: number, d: number, e: number, f: number, g: bigint, h: number, i: number) => [number, number, number];
    readonly supported_formats: () => any;
    readonly version: () => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
