/* tslint:disable */
/* eslint-disable */

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
    readonly supported_formats: () => any;
    readonly version: () => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
