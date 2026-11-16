/* @ts-self-types="./openpixel_wasm.d.ts" */

/**
 * Chroma subsampling format
 * @enum {0 | 1 | 2 | 3}
 */
export const ChromaSampling = Object.freeze({
    /**
     * Both vertically and horizontally subsampled.
     */
    Cs420: 0, "0": "Cs420",
    /**
     * Horizontally subsampled.
     */
    Cs422: 1, "1": "Cs422",
    /**
     * Not subsampled.
     */
    Cs444: 2, "2": "Cs444",
    /**
     * Monochrome.
     */
    Cs400: 3, "3": "Cs400",
});

/**
 * Capabilities of the registry *in this build* — the same list the
 * native CLI reports, except AVIF is listed as unavailable (its
 * decoder needs native libdav1d). The web UI reads this instead of
 * hard-coding a format list.
 * @returns {any}
 */
export function capabilities() {
    const ret = wasm.capabilities();
    return ret;
}

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
 * @param {Uint8Array | number[]} bytes
 * @param {string} target
 * @param {number | null} [quality]
 * @param {string | null} [background]
 * @returns {Uint8Array}
 */
export function convert(bytes, target, quality, background) {
    const val4 = +(isLikeNone(quality) ? 0xFFFFFF : quality);
    let ptr0, len0, ptr1, len1, ptr2, len2;
    try {
        ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = isLikeNone(background) ? 0 : passStringToWasm0(background, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.convert(ptr0, len0, ptr1, len1, val4, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v5 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v5;
}

/**
 * Detect the format of `bytes` from magic bytes only (never the
 * extension). Returns the format id (`"png"`, `"jpeg"`, …) or
 * `"unknown"`.
 * @param {Uint8Array | number[]} bytes
 * @returns {string}
 */
export function detect(bytes) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.detect(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Full discovery: signature first, extension/MIME only as a
 * low-confidence fallback, with mismatch reporting. Returns the
 * `DiscoveryResult` as a JS object.
 * @param {Uint8Array | number[]} bytes
 * @param {string | null} [extension]
 * @param {string | null} [mime]
 * @returns {any}
 */
export function discover(bytes, extension, mime) {
    let ptr0, len0, ptr1, len1, ptr2, len2;
    try {
        ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = isLikeNone(extension) ? 0 : passStringToWasm0(extension, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = isLikeNone(mime) ? 0 : passStringToWasm0(mime, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.discover(ptr0, len0, ptr1, len1, ptr2, len2);
    return ret;
}

/**
 * Information about an image (format, dimensions, colour type,
 * animation, metadata presence) without converting it. Errors on
 * unknown formats and on formats this build cannot decode.
 * @param {Uint8Array | number[]} bytes
 * @returns {any}
 */
export function info(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.info(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

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
 * @param {Uint8Array | number[]} bytes
 * @param {string} options_json
 * @returns {any}
 */
export function pdf_compress(bytes, options_json) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.pdf_compress(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

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
 * @param {Uint8Array | number[]} bytes
 * @param {string} ops_json
 * @param {any} images
 * @returns {any}
 */
export function pdf_edit(bytes, ops_json, images) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(ops_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.pdf_edit(ptr0, len0, ptr1, len1, images);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Flatten annotations and form fields into page content (Phase 5).
 * Returns a JS object `{ data: Uint8Array, annotations_flattened,
 * annotations_dropped, form_fields_removed, warnings }`.
 * @param {Uint8Array | number[]} bytes
 * @returns {any}
 */
export function pdf_flatten(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pdf_flatten(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Build a PDF from images (a JS array of `Uint8Array` — PNG, JPEG,
 * WebP, anything the engine decodes), one page per image, in order.
 * `page_size` is a named size ("A4", "Letter", "A5") or undefined
 * for one page per image at the image's own size in points.
 * @param {any} images
 * @param {string | null} [page_size]
 * @returns {Uint8Array}
 */
export function pdf_from_images(images, page_size) {
    var ptr0 = isLikeNone(page_size) ? 0 : passStringToWasm0(page_size, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.pdf_from_images(images, ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * PDF info: page count, version, metadata, encryption, page sizes.
 * Returns the `PdfInfo` as a JS object.
 * @param {Uint8Array | number[]} bytes
 * @returns {any}
 */
export function pdf_info(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pdf_info(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * List JavaScript actions and embedded files in a PDF (Phase 5) —
 * never executes anything. Returns the `PdfThreats` object
 * (`javascript`, `embedded_files`, `launch_actions`,
 * `auto_actions`, `warnings`).
 * @param {Uint8Array | number[]} bytes
 * @returns {any}
 */
export function pdf_inspect(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pdf_inspect(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Merge several PDFs (a JS array of `Uint8Array`) into one, in order.
 * @param {any} documents
 * @returns {Uint8Array}
 */
export function pdf_merge(documents) {
    const ret = wasm.pdf_merge(documents);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

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
 * @param {Uint8Array | number[]} bytes
 * @param {string} ops_json
 * @returns {any}
 */
export function pdf_process(bytes, ops_json) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(ops_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.pdf_process(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Really remove text from a PDF (Phase 5): `redactions_json` is a
 * JSON array of redactions, e.g.
 * `[{"kind":"rect","page":1,"x":72,"y":600,"width":200,"height":20}]`
 * or `[{"kind":"text","page":null,"text":"SECRET"}]`. The text is
 * deleted from the content stream, not covered with a black box.
 * Returns a JS object `{ data: Uint8Array, pages_touched,
 * runs_removed, characters_removed, annotations_removed,
 * redacted_texts, warnings }`.
 * @param {Uint8Array | number[]} bytes
 * @param {string} redactions_json
 * @returns {any}
 */
export function pdf_redact(bytes, redactions_json) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(redactions_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.pdf_redact(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Rebuild the cross-reference table of a damaged PDF (Phase 5).
 * Returns a JS object `{ data: Uint8Array, recovery, warnings }`.
 * @param {Uint8Array | number[]} bytes
 * @returns {any}
 */
export function pdf_repair(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pdf_repair(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Strip JavaScript, embedded files, launch actions and
 * auto-actions from a PDF (Phase 5). The document is kept; the
 * dangerous parts are removed, not hidden. Returns a JS object
 * `{ data: Uint8Array, javascript_removed, embedded_files_removed,
 * launch_actions_removed, auto_actions_removed, warnings }`.
 * @param {Uint8Array | number[]} bytes
 * @returns {any}
 */
export function pdf_sanitize(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pdf_sanitize(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Set document metadata (Phase 5): `metadata_json` is e.g.
 * `{"title":"…","author":null,"subject":"…","keywords":""}` — a
 * null leaves a field unchanged, an empty string clears it.
 * Returns the new PDF bytes.
 * @param {Uint8Array | number[]} bytes
 * @param {string} metadata_json
 * @returns {Uint8Array}
 */
export function pdf_set_metadata(bytes, metadata_json) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(metadata_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.pdf_set_metadata(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

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
 * @param {Uint8Array | number[]} bytes
 * @param {string} ops_json
 * @param {string} target
 * @param {number | null} [quality]
 * @param {string | null} [background]
 * @param {number | null} [png_compression]
 * @returns {any}
 */
export function process(bytes, ops_json, target, quality, background, png_compression) {
    const val5 = +(isLikeNone(quality) ? 0xFFFFFF : quality);
    const val6 = +(isLikeNone(png_compression) ? 0xFFFFFF : png_compression);
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3;
    try {
        ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(ops_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = isLikeNone(background) ? 0 : passStringToWasm0(background, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.process(ptr0, len0, ptr1, len1, ptr2, len2, val5, ptr3, len3, val6);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

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
 * @param {Uint8Array | number[]} bytes
 * @param {string} ops_json
 * @param {string} target
 * @param {bigint} target_bytes
 * @param {string | null} [background]
 * @returns {any}
 */
export function process_to_size(bytes, ops_json, target, target_bytes, background) {
    const val5 = BigInt.asIntN(64, target_bytes);
    let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3;
    try {
        ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(ops_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
        ptr2 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len2 = WASM_VECTOR_LEN;
        ptr3 = isLikeNone(background) ? 0 : passStringToWasm0(background, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len3 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
        if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.process_to_size(ptr0, len0, ptr1, len1, ptr2, len2, val5, ptr3, len3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Formats this build can decode / encode, as format ids. The web UI
 * uses this to offer only targets the WASM engine can actually
 * produce, and to fall back to the canvas path for the rest.
 * @returns {any}
 */
export function supported_formats() {
    const ret = wasm.supported_formats();
    return ret;
}

/**
 * The engine version this module was built from.
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_208446807d0d1e30: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_null_c22311b1cc228e3a: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_getRandomValues_8b6f1f663e6f188d: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_get_d7176cfb76d71114: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_instanceof_Uint8Array_d7aeb0dcb3108fea: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_bcf1376d0d732d08: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_b03a0fabb109b1e9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_37eb45aaf5eeb820: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_cd4348290afae586: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_with_length_01b143a7e5dd5a3e: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_c9f4893fc209f768: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_set_2793479888329cb6: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_d2d33b52458e984a: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_e4b9a833d288759a: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_feb3714f475485ba: function(arg0, arg1, arg2) {
            arg0.set(getArrayU8FromWasm0(arg1, arg2));
        },
        __wbindgen_generic_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000004: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./openpixel_wasm_bg.js": import0,
    };
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('openpixel_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
