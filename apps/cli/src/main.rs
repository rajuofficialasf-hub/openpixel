use clap::{Parser, Subcommand};
use openpixel_core::security::parse_background;
use openpixel_core::{
    detect_format, ConvertOptions, Engine, EngineConfig, ImageFormat, MetadataPolicy, Operation,
    Pipeline, PipelineSpec, ProcessOptions, WatermarkPosition, WatermarkSpec,
};
use openpixel_jobs::{JobManager, JobManagerConfig};
use openpixel_ocr::OcrEngine;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;

mod bench;

#[derive(Parser)]
#[command(
    name = "openpixel",
    version,
    about = "OpenPixel Engine — local image conversion and processing (Phase 6)"
)]
struct Cli {
    /// Output machine-readable JSON instead of human text
    #[arg(long, global = true)]
    json: bool,
    /// Only errors
    #[arg(long, global = true)]
    quiet: bool,
    /// Extra detail
    #[arg(long, global = true)]
    verbose: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
// The Process variant is large by nature (one field per flag); boxing
// its Vec field is not an option because clap's derive has no value
// parser for Box<Vec<String>>. The enum is constructed once per run,
// so the size difference is immaterial.
#[allow(clippy::large_enum_variant)]
enum Commands {
    /// Show format, dimensions, colour type and size for an image
    Info { input: PathBuf },
    /// Show EXIF / ICC / XMP metadata for an image
    Metadata { input: PathBuf },
    /// List the frames of an animated image (GIF / APNG / animated WebP) or the pages of a multi-page TIFF
    Frames { input: PathBuf },
    /// Extract one frame (GIF) or page (TIFF) and write it as an image: openpixel extract-frame input.gif frame2.png --frame 2
    ExtractFrame {
        input: PathBuf,
        output: PathBuf,
        /// Frame / page index, 0-based (default 0)
        #[arg(long, default_value = "0")]
        frame: u32,
        /// JPEG quality 1-100 (default 85). Ignored for lossless formats.
        #[arg(long)]
        quality: Option<u8>,
        /// PNG compression 0=fast, 1=default, 2=best
        #[arg(long)]
        png_compression: Option<u8>,
        /// Background when flattening alpha: white, black, or #RRGGBB
        #[arg(long, default_value = "white")]
        background: String,
        /// Keep metadata: preserve, strip, color-profiles, normalize-orientation, selected:exif,icc,xmp,gps
        #[arg(long)]
        metadata: Option<String>,
        /// Legacy shorthand for --metadata preserve
        #[arg(long)]
        preserve_metadata: bool,
        /// Convert pixels to sRGB using the embedded ICC profile
        #[arg(long)]
        to_srgb: bool,
    },
    /// Convert one image: openpixel convert input.jpg output.png
    Convert {
        input: PathBuf,
        output: PathBuf,
        /// JPEG quality 1-100 (default 85). Ignored for lossless formats.
        #[arg(long)]
        quality: Option<u8>,
        /// PNG compression 0=fast, 1=default, 2=best
        #[arg(long)]
        png_compression: Option<u8>,
        /// Background when flattening alpha: white, black, or #RRGGBB
        #[arg(long, default_value = "white")]
        background: String,
        /// Keep metadata: preserve, strip, color-profiles, normalize-orientation, selected:exif,icc,xmp,gps
        #[arg(long)]
        metadata: Option<String>,
        /// Legacy shorthand for --metadata preserve
        #[arg(long)]
        preserve_metadata: bool,
        /// Convert only this frame (GIF) / page (TIFF), 0-based
        #[arg(long)]
        frame: Option<u32>,
        /// Convert pixels to sRGB using the embedded ICC profile
        #[arg(long)]
        to_srgb: bool,
    },
    /// Identify a file's real format: signature vs extension vs MIME
    Discover { input: PathBuf },
    /// List every format the registry knows, with what this build can do
    Formats,
    /// Show capabilities for one format, e.g. `capabilities avif`
    Capabilities { format: String },
    /// Convert every image in a directory (Phase 6: parallel worker
    /// pool by default; --workers 1 or --sequential keeps the old
    /// one-by-one behaviour)
    Batch {
        input_dir: PathBuf,
        /// Target format, e.g. webp
        #[arg(long)]
        format: String,
        /// JPEG quality 1-100
        #[arg(long)]
        quality: Option<u8>,
        /// Where to write outputs (default: <input_dir>/openpixel-out)
        #[arg(long)]
        out_dir: Option<PathBuf>,
        /// Worker threads (1..=8, default = CPUs capped at 4).
        /// 1 runs the old sequential batch.
        #[arg(long)]
        workers: Option<usize>,
        /// Force the old sequential batch (same as --workers 1)
        #[arg(long)]
        sequential: bool,
    },
    /// Run the Phase 6 benchmark suite (JPEG decode, PNG/WebP/AVIF
    /// encode, large TIFF, 12-file batch) and print a table
    Bench {
        /// Repetitions per operation (default 3)
        #[arg(long, default_value = "3")]
        iterations: usize,
        /// Small fixtures (256x192 base, 4-file batch) for a fast
        /// smoke run; timings are not comparable to a full run
        #[arg(long)]
        quick: bool,
    },
    /// Process one image and write it out: openpixel process input.png output.jpg --resize 800x600 --grayscale --rotate 90
    ///
    /// Individual flags apply in the documented canonical order
    /// (resize/crop -> rotate/flip -> colour/blur/sharpen ->
    /// watermark -> flatten). For exact ordering, use repeatable
    /// --op instead (e.g. --op crop:0,0,100,100 --op flip-h);
    /// --op cannot be combined with individual operation flags.
    /// Negative numbers are allowed, so --brightness -0.2 works.
    #[command(allow_negative_numbers = true)]
    Process {
        input: PathBuf,
        output: PathBuf,
        /// JPEG quality 1-100 (default 85). Ignored for lossless formats.
        #[arg(long)]
        quality: Option<u8>,
        /// Target output size, e.g. 200KB, 1.5MB, or plain bytes (51200).
        /// Searches encode quality so the output fits the target (JPEG,
        /// AVIF, HEIC, HEIF; best PNG compression for PNG). Cannot be
        /// combined with --quality — the search picks quality for you.
        #[arg(long, value_name = "SIZE")]
        target_size: Option<String>,
        /// PNG compression 0=fast, 1=default, 2=best
        #[arg(long)]
        png_compression: Option<u8>,
        /// Background when flattening alpha: white, black, or #RRGGBB
        #[arg(long, default_value = "white")]
        background: String,
        /// Keep metadata: preserve, strip, color-profiles, normalize-orientation, selected:exif,icc,xmp,gps
        #[arg(long)]
        metadata: Option<String>,
        /// Legacy shorthand for --metadata preserve
        #[arg(long)]
        preserve_metadata: bool,
        /// Convert only this frame (GIF) / page (TIFF), 0-based
        #[arg(long)]
        frame: Option<u32>,
        /// Convert pixels to sRGB using the embedded ICC profile
        #[arg(long)]
        to_srgb: bool,
        /// Exact size, e.g. 800x600 (aspect ratio ignored)
        #[arg(long, value_name = "WxH")]
        resize: Option<String>,
        /// Fit inside a box, e.g. 800x600 (aspect preserved, never upscales)
        #[arg(long, value_name = "WxH")]
        resize_fit: Option<String>,
        /// Fill and centre-crop to exactly WxH, e.g. 800x600
        #[arg(long, value_name = "WxH")]
        resize_fill: Option<String>,
        /// Pad to exactly WxH with --pad-color, e.g. 800x600
        #[arg(long, value_name = "WxH")]
        pad: Option<String>,
        /// Pad colour: white, black, or #RRGGBB
        #[arg(long, default_value = "white")]
        pad_color: String,
        /// Crop rectangle, e.g. 10,20,400,300 (x,y,width,height)
        #[arg(long, value_name = "X,Y,W,H")]
        crop: Option<String>,
        /// Fit inside a max-dimension box, e.g. 256 (never upscales)
        #[arg(long)]
        thumbnail: Option<u32>,
        /// Rotation in degrees: 90/180/270 are exact; any other value
        /// rotates arbitrarily with --rotate-background fill
        #[arg(long)]
        rotate: Option<f32>,
        /// Fill colour for arbitrary rotation: white, black, or #RRGGBB
        #[arg(long, default_value = "white")]
        rotate_background: String,
        /// Mirror left-right
        #[arg(long)]
        flip_h: bool,
        /// Mirror top-bottom
        #[arg(long)]
        flip_v: bool,
        /// Convert to greyscale
        #[arg(long)]
        grayscale: bool,
        /// Brightness -1.0..=1.0 (-1 black, 0 unchanged, 1 white)
        #[arg(long)]
        brightness: Option<f32>,
        /// Contrast -1.0..=1.0 (0 unchanged)
        #[arg(long)]
        contrast: Option<f32>,
        /// Saturation 0.0..=2.0 (0 greyscale, 1 unchanged, 2 double)
        #[arg(long)]
        saturation: Option<f32>,
        /// Gaussian blur sigma, e.g. 2.0
        #[arg(long)]
        blur: Option<f32>,
        /// Unsharp-mask sigma, e.g. 1.0 (with --sharpen-threshold)
        #[arg(long)]
        sharpen: Option<f32>,
        /// Sharpen threshold 0..=255 (default 0)
        #[arg(long, default_value = "0")]
        sharpen_threshold: i32,
        /// Image watermark file (PNG logo); no text watermark in Phase 4
        #[arg(long)]
        watermark: Option<PathBuf>,
        /// Watermark position: top-left, top-right, bottom-left, bottom-right, center
        #[arg(long, default_value = "bottom-right")]
        watermark_position: String,
        /// Watermark opacity 0.0..=1.0 (default 0.5)
        #[arg(long, default_value = "0.5")]
        watermark_opacity: f32,
        /// Watermark margin in px at the corners (default 8)
        #[arg(long, default_value = "8")]
        watermark_margin: u32,
        /// Flatten alpha onto --background as an explicit step
        #[arg(long)]
        flatten: bool,
        /// One operation, in order: resize:800x600, crop:0,0,100,100,
        /// rotate:90, flip-h, flip-v, grayscale, brightness:0.2,
        /// contrast:0.1, saturation:1.5, blur:2.0, sharpen:1.0,
        /// thumbnail:256, pad:800x600, flatten, resize-fit:800x600,
        /// resize-fill:800x600, threshold:128, denoise, deskew:5.
        /// Repeatable; order is honoured.
        #[arg(long, value_name = "SPEC")]
        op: Vec<String>,
    },
    /// PDF operations (Studio Phase 2): info, page ops, render to
    /// images, and building a PDF from images
    Pdf {
        #[command(subcommand)]
        command: PdfCommands,
    },
    /// Document conversion (Studio Phase 3): Office/PDF via
    /// LibreOffice headless (desktop/server only) and PDF text
    /// exports. Never runs in the browser.
    Doc {
        #[command(subcommand)]
        command: DocCommands,
    },
    /// OCR (Studio Phase 4): read text from an image with native
    /// Tesseract. Needs Tesseract 5 + leptonica installed — see
    /// docs/OCR.md. A PDF input is refused here; use
    /// `openpixel pdf ocr` for scanned PDFs.
    Ocr {
        input: PathBuf,
        /// Output file (default: print to stdout)
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Languages, e.g. eng, ben, eng+ben (default eng)
        #[arg(long, default_value = "eng")]
        lang: String,
        /// Page segmentation mode 0..=13 (default 3 = automatic)
        #[arg(long, default_value = "3")]
        psm: u8,
        /// Preprocessing: none, light (default), full
        #[arg(long, default_value = "light")]
        preprocess: String,
        /// Output format: txt, html or json (default txt)
        #[arg(long, default_value = "txt")]
        format: String,
    },
}

/// The `openpixel pdf ...` subcommands (Studio Phase 2). Every
/// command that writes a PDF takes its output as a positional
/// `output` path, except `merge`/`from-images` (several inputs, so
/// the output is `--output`) and `split`/`render` (several outputs,
/// so the destination is `--out-dir`).
#[derive(Subcommand)]
enum PdfCommands {
    /// Show page count, page sizes, metadata, encryption status and PDF version
    Info { input: PathBuf },
    /// Merge several PDFs into one, in order
    Merge {
        /// Input PDFs, in order
        #[arg(required = true)]
        inputs: Vec<PathBuf>,
        /// Output PDF
        #[arg(short, long)]
        output: PathBuf,
    },
    /// Split a PDF into one file per range: --ranges 1-3,5-7
    Split {
        input: PathBuf,
        /// Page ranges, e.g. 1-3,5-7 (1-based, inclusive; a single
        /// number means one page)
        #[arg(long)]
        ranges: String,
        /// Where to write the parts (default: <input-stem>-split next
        /// to the input)
        #[arg(long)]
        out_dir: Option<PathBuf>,
    },
    /// Rotate pages 90/180/270 degrees (adds to any existing rotation)
    Rotate {
        input: PathBuf,
        output: PathBuf,
        /// Pages, e.g. 1,3,5 or 1-3,5 (default: all pages)
        #[arg(long)]
        pages: Option<String>,
        /// Degrees: 90, 180 or 270
        #[arg(long)]
        degrees: u16,
    },
    /// Keep exactly these pages, in the given order (repeats allowed)
    Extract {
        input: PathBuf,
        output: PathBuf,
        /// Pages, e.g. 1,3,5 or 1-3,5
        #[arg(long)]
        pages: String,
    },
    /// Remove these pages
    Remove {
        input: PathBuf,
        output: PathBuf,
        /// Pages, e.g. 2,4 or 2-3
        #[arg(long)]
        pages: String,
    },
    /// Reorder pages: --order 3,1,2 (must list every page exactly once)
    Reorder {
        input: PathBuf,
        output: PathBuf,
        /// New order, e.g. 3,1,2
        #[arg(long)]
        order: String,
    },
    /// Duplicate pages right after themselves
    Duplicate {
        input: PathBuf,
        output: PathBuf,
        /// Pages to duplicate, e.g. 1,2
        #[arg(long)]
        pages: String,
    },
    /// Insert another PDF's pages before page N (1-based; N =
    /// pages+1 appends at the end)
    Insert {
        input: PathBuf,
        other: PathBuf,
        output: PathBuf,
        /// Page to insert before, 1-based
        #[arg(long)]
        at: u32,
    },
    /// Replace one page with all pages of another PDF
    Replace {
        input: PathBuf,
        replacement: PathBuf,
        output: PathBuf,
        /// Page to replace, 1-based
        #[arg(long)]
        page: u32,
    },
    /// Reverse the page order
    Reverse { input: PathBuf, output: PathBuf },
    /// Reorder pages for saddle-stitch booklet printing (pads the
    /// document to a multiple of 4 pages)
    Booklet { input: PathBuf, output: PathBuf },
    /// Lay pages out N-up on sheets
    Nup {
        input: PathBuf,
        output: PathBuf,
        /// Columns per sheet (default 2)
        #[arg(long, default_value = "2")]
        cols: u32,
        /// Rows per sheet (default 2)
        #[arg(long, default_value = "2")]
        rows: u32,
    },
    /// Render pages to images (needs libpdfium — see docs/PDF.md)
    Render {
        input: PathBuf,
        /// Where to write the images (default: <input-stem>-pages
        /// next to the input)
        #[arg(long)]
        out_dir: Option<PathBuf>,
        /// Pages, e.g. 1,3,5 or 1-3,5 (default: all pages)
        #[arg(long)]
        pages: Option<String>,
        /// Image format: png, jpg, webp (default png)
        #[arg(long, default_value = "png")]
        format: String,
        /// Render scale: 1.0 = 72 DPI, 2.0 = 144 DPI (0.25..=6.0)
        #[arg(long, default_value = "2.0")]
        scale: f32,
        /// JPEG/WebP quality 1-100 (default 85)
        #[arg(long)]
        quality: Option<u8>,
    },
    /// Build a PDF from images, one page per image, in order
    FromImages {
        /// Images (PNG, JPEG, WebP, anything the engine decodes)
        #[arg(required = true)]
        inputs: Vec<PathBuf>,
        /// Output PDF
        #[arg(short, long)]
        output: PathBuf,
        /// Page size: A4, Letter, A5 (default: each image's own size
        /// in points, 1 px = 1 pt)
        #[arg(long)]
        page_size: Option<String>,
    },
    /// Compress a PDF: downsample + re-encode images and optimise
    /// structure. Prints input/output sizes and what was saved.
    /// When the compressed file would be larger, the original is
    /// kept and the report says so (unless --strip-metadata was
    /// asked for, which is always honoured).
    Compress {
        input: PathBuf,
        output: PathBuf,
        /// screen (72 DPI, JPEG q50), ebook (150 DPI, q75) or
        /// printer (300 DPI, q90). Default: ebook.
        #[arg(long, default_value = "ebook")]
        mode: String,
        /// Strip the document /Info metadata (title/author/…)
        #[arg(long)]
        strip_metadata: bool,
    },
    /// Password-protect a PDF (RC4-128, user + owner password).
    /// Passwords are command-line arguments — use only on your
    /// own machine, never in shared shell history you care about.
    Protect {
        input: PathBuf,
        output: PathBuf,
        /// User password (required to open the file)
        #[arg(long)]
        user_password: String,
        /// Owner password (full rights; defaults to the user password)
        #[arg(long)]
        owner_password: Option<String>,
        /// Forbid printing
        #[arg(long)]
        no_print: bool,
        /// Forbid copying text
        #[arg(long)]
        no_copy: bool,
        /// Forbid modifying the document
        #[arg(long)]
        no_modify: bool,
    },
    /// Remove password protection (user or owner password)
    Unlock {
        input: PathBuf,
        output: PathBuf,
        /// The user or owner password
        #[arg(long)]
        password: String,
    },
    /// Add a diagonal text watermark to every page
    Watermark {
        input: PathBuf,
        output: PathBuf,
        /// Watermark text
        #[arg(long)]
        text: String,
        /// Font size in points (default 48)
        #[arg(long, default_value = "48")]
        font_size: f64,
        /// Opacity 0.0..=1.0 (default 0.25)
        #[arg(long, default_value = "0.25")]
        opacity: f32,
        /// Rotation in degrees, counter-clockwise (default 45)
        #[arg(long, default_value = "45")]
        angle: f64,
    },
    /// Extract text with layout (needs libpdfium — see docs/PDF.md)
    ExtractText {
        input: PathBuf,
        /// Output file (default: <input-stem>.<format> next to the input)
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Pages, e.g. 1,3,5 or 1-3,5 (default: all pages)
        #[arg(long)]
        pages: Option<String>,
        /// Output format: txt, html, epub or docx (default txt).
        /// EPUB/DOCX are text-only reflows, not the original layout.
        #[arg(long, default_value = "txt")]
        format: String,
    },
    /// OCR a scanned PDF (or a single image) into a searchable PDF:
    /// the original image with a real text layer, findable with
    /// `pdftotext`. A PDF input renders via PDFium first (needs
    /// libpdfium — see docs/PDF.md). The text layer comes from
    /// OCRing the image as given (like `tesseract … pdf`) — no
    /// pipeline preprocessing applies on this path; see docs/OCR.md.
    Ocr {
        input: PathBuf,
        output: PathBuf,
        /// Languages, e.g. eng, ben, eng+ben (default eng)
        #[arg(long, default_value = "eng")]
        lang: String,
        /// Page segmentation mode 0..=13 (default 3 = automatic)
        #[arg(long, default_value = "3")]
        psm: u8,
        /// Pages to OCR, e.g. 1,3,5 or 1-3,5 (PDF input only;
        /// default: all pages)
        #[arg(long)]
        pages: Option<String>,
        /// Render scale for PDF input: 1.0 = 72 DPI, 3.0 = 216 DPI
        /// (default 3.0 — Tesseract reads small print best at
        /// 200+ DPI)
        #[arg(long, default_value = "3.0")]
        scale: f32,
    },
    /// Add overlay content to a PDF — text, images, shapes,
    /// highlight, freehand strokes, comments, page numbers,
    /// header/footer. Overlays are NEW content layered on top of
    /// the page; existing text is never edited in place (see
    /// docs/PDF.md). At least one op is required.
    Edit {
        input: PathBuf,
        output: PathBuf,
        /// Overlay op as JSON, repeatable, e.g.
        /// --op '{"kind":"text","page":1,"x":72,"y":700,"text":"Hi","size":14,"color":{"r":0,"g":0,"b":0},"font":"helvetica"}'
        /// (kinds: text, image, rect, line, circle, highlight,
        /// draw, comment, page_numbers, header_footer)
        #[arg(long)]
        op: Vec<String>,
        /// Add one line of text (with --page, --x, --y, --size, --color)
        #[arg(long)]
        text: Option<String>,
        /// Page for --text / --image (1-based, default 1)
        #[arg(long, default_value = "1")]
        page: u32,
        /// X position in points for --text / --image (default 72)
        #[arg(long, default_value = "72")]
        x: f64,
        /// Y position in points for --text / --image (default 700)
        #[arg(long, default_value = "700")]
        y: f64,
        /// Font size in points for --text (default 14)
        #[arg(long, default_value = "14")]
        size: f64,
        /// Text colour as #RRGGBB (default #000000)
        #[arg(long, default_value = "#000000")]
        color: String,
        /// Add an image file at (--x, --y); drawn at
        /// --image-width/--image-height, or its own pixel size
        #[arg(long)]
        image: Option<PathBuf>,
        /// Image width in points (default: the image's own width)
        #[arg(long)]
        image_width: Option<f64>,
        /// Image height in points (default: the image's own height)
        #[arg(long)]
        image_height: Option<f64>,
        /// Add page numbers to every page ("Page {n} of {total}")
        #[arg(long)]
        page_numbers: bool,
        /// Page-number format with {n} and {total}
        /// (default "Page {n} of {total}")
        #[arg(long, default_value = "Page {n} of {total}")]
        page_number_format: String,
        /// Where page numbers go: bottom-center, bottom-right,
        /// top-center, top-right (default bottom-center)
        #[arg(long, default_value = "bottom-center")]
        page_number_position: String,
        /// Header line on every page
        #[arg(long)]
        header: Option<String>,
        /// Footer line on every page
        #[arg(long)]
        footer: Option<String>,
    },
    /// Really remove text from a PDF — the text is deleted from
    /// the content stream, not covered with a black box. Verify
    /// with `grep`: the redacted text must be absent from the
    /// output bytes (see docs/PDF.md).
    Redact {
        input: PathBuf,
        output: PathBuf,
        /// Rectangle to redact: x,y,width,height in points
        /// (repeatable; --page applies to every --rect)
        #[arg(long)]
        rect: Vec<String>,
        /// Page for --rect (1-based, default 1)
        #[arg(long, default_value = "1")]
        page: u32,
        /// Text to redact everywhere it occurs (repeatable,
        /// all pages, case-sensitive)
        #[arg(long)]
        text: Vec<String>,
    },
    /// Sign a PDF with an RSA private key + certificate (PEM
    /// files). The signature is an invisible field on the first
    /// page; verify it with `pdf verify-sign`. Bring your own
    /// key and certificate — see docs/PDF.md for how to make a
    /// self-signed test certificate with openssl.
    Sign {
        input: PathBuf,
        output: PathBuf,
        /// Private key PEM (PKCS#8 or PKCS#1)
        #[arg(long)]
        key: PathBuf,
        /// Certificate PEM (or DER)
        #[arg(long)]
        cert: PathBuf,
        /// Reason for signing
        #[arg(long)]
        reason: Option<String>,
        /// Signing location
        #[arg(long)]
        location: Option<String>,
        /// Contact info
        #[arg(long)]
        contact: Option<String>,
    },
    /// Verify the signatures in a PDF: validity (cryptography),
    /// trust (against --trust anchors), digest, signing time and
    /// certificate window. With no anchors every signer is
    /// reported untrusted — that is the honest answer for a
    /// self-signed certificate, not a failure.
    VerifySign {
        input: PathBuf,
        /// Trust anchor certificate (PEM or DER), repeatable
        #[arg(long)]
        trust: Vec<PathBuf>,
    },
    /// Flatten annotations and form fields into page content
    /// (annotations with an appearance become part of the page;
    /// bare ones are dropped and reported)
    Flatten { input: PathBuf, output: PathBuf },
    /// Set document metadata (title/author/subject/keywords).
    /// An empty string clears a field; an omitted flag leaves
    /// it unchanged.
    SetMetadata {
        input: PathBuf,
        output: PathBuf,
        /// New title ("" clears it)
        #[arg(long)]
        title: Option<String>,
        /// New author ("" clears it)
        #[arg(long)]
        author: Option<String>,
        /// New subject ("" clears it)
        #[arg(long)]
        subject: Option<String>,
        /// New keywords ("" clears it)
        #[arg(long)]
        keywords: Option<String>,
    },
    /// Rebuild the cross-reference table of a damaged PDF where
    /// lopdf can (reports how the file was recovered)
    Repair { input: PathBuf, output: PathBuf },
    /// Strip JavaScript, embedded files, launch actions and
    /// auto-actions from a PDF. The document is kept; the
    /// dangerous parts are removed, not hidden.
    Sanitize { input: PathBuf, output: PathBuf },
    /// List JavaScript actions and embedded files in a PDF
    /// (never executes anything) plus the basic document info
    Inspect { input: PathBuf },
}

/// The `openpixel doc ...` subcommands (Studio Phase 3).
/// Conversions run LibreOffice headless on this machine — never
/// in the browser, never through an external API.
#[derive(Subcommand)]
enum DocCommands {
    /// Convert a document: Office/PDF via LibreOffice, or PDF text
    /// exports (txt/html/epub/docx). Source is detected from the
    /// file; `--to` names the target format.
    Convert {
        input: PathBuf,
        /// Target format: pdf, docx, xlsx, pptx, odt, ods, odp,
        /// html, txt, csv, rtf, epub (see `openpixel doc formats`
        /// for the full matrix)
        #[arg(long)]
        to: String,
        /// Output file (default: <input-stem>.<to> next to the input)
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// LibreOffice timeout, seconds (default 120)
        #[arg(long, default_value = "120")]
        timeout_secs: u64,
    },
    /// List every supported document conversion, the engine that
    /// runs it, where it runs, and what fidelity to expect
    Formats,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let engine = Arc::new(Engine::new(EngineConfig::default()));
    match run(&cli, &engine) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            if !cli.quiet {
                eprintln!("error: {e}");
            }
            ExitCode::FAILURE
        }
    }
}

fn run(cli: &Cli, engine: &Arc<Engine>) -> Result<(), openpixel_core::OpenPixelError> {
    match &cli.command {
        Commands::Info { input } => {
            let info = engine.get_image_info(input)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&info).unwrap());
            } else {
                println!("file:      {}", input.display());
                println!(
                    "format:    {}  (detected by signature, not extension)",
                    info.format
                );
                println!("size:      {}x{} px", info.width, info.height);
                println!("colour:    {}", info.color_type);
                println!("alpha:     {}", if info.has_alpha { "yes" } else { "no" });
                println!("file size: {} bytes", info.file_size_bytes);
                if info.is_animated {
                    println!(
                        "animated:  yes ({} frame{})",
                        info.frame_count.unwrap_or(0),
                        if info.frame_count == Some(1) { "" } else { "s" }
                    );
                }
                if let Some(o) = info.orientation {
                    println!("orientation: {o}");
                }
                println!("exif:      {}", yes(info.has_exif));
                println!("icc:       {}", yes(info.has_icc));
                println!("xmp:       {}", yes(info.has_xmp));
                if let Some(n) = &info.note {
                    println!("note:      {n}");
                }
            }
            Ok(())
        }
        Commands::Metadata { input } => {
            let meta = engine.read_metadata(input)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&meta).unwrap());
            } else {
                println!("file:      {}", input.display());
                println!("summary:   {}", meta.summary());
                if let Some(o) = meta.orientation {
                    println!("orientation: {o}");
                }
                if let Some(make) = &meta.make {
                    println!(
                        "camera:    {make}{}",
                        meta.model
                            .as_ref()
                            .map(|m| format!(" {m}"))
                            .unwrap_or_default()
                    );
                }
                if let Some(dt) = meta.date_time_original.as_ref().or(meta.date_time.as_ref()) {
                    println!("taken:     {dt}");
                }
                if let Some(gps) = meta.gps {
                    println!(
                        "gps:       {:.5}, {:.5}{}",
                        gps.latitude,
                        gps.longitude,
                        gps.altitude_m
                            .map(|a| format!(" ({a} m)"))
                            .unwrap_or_default()
                    );
                }
                if let (Some(x), Some(y)) = (meta.x_resolution, meta.y_resolution) {
                    println!(
                        "resolution: {x:.1} x {y:.1} (unit {})",
                        meta.resolution_unit.unwrap_or(0)
                    );
                }
                if let Some(icc) = &meta.icc {
                    println!(
                        "icc:       {} ({} bytes{})",
                        icc.description.as_deref().unwrap_or(&icc.color_space),
                        icc.size_bytes,
                        if icc.is_srgb { ", sRGB" } else { "" }
                    );
                }
                println!("xmp:       {}", yes(meta.has_xmp));
                for w in &meta.warnings {
                    println!("warning:   {w}");
                }
            }
            Ok(())
        }
        Commands::Frames { input } => {
            let info = engine.list_frames(input)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&info).unwrap());
            } else {
                println!("file:      {}", input.display());
                println!("format:    {}", info.format);
                println!(
                    "frames:    {}{}",
                    info.frame_count,
                    if info.format == "tiff" {
                        " (multi-page)".to_string()
                    } else if info.is_animated {
                        " (animated)".to_string()
                    } else {
                        String::new()
                    }
                );
                if let Some(loops) = info.loop_count {
                    println!(
                        "loops:     {}",
                        if loops == 0 {
                            "forever".to_string()
                        } else {
                            loops.to_string()
                        }
                    );
                }
                println!(
                    "{:<6} {:<9} {:<9} {:<9} {:<8}",
                    "index", "size", "offset", "delay", "dispose"
                );
                for f in &info.frames {
                    println!(
                        "{:<6} {:<9} {:<9} {:<9} {:<8}",
                        f.index,
                        format!("{}x{}", f.width, f.height),
                        format!("{},{}", f.offset_x, f.offset_y),
                        f.delay_ms
                            .map(|d| format!("{d} ms"))
                            .unwrap_or_else(|| "-".to_string()),
                        f.disposal
                            .map(|d| d.to_string())
                            .unwrap_or_else(|| "-".to_string())
                    );
                }
                if let Some(n) = &info.note {
                    println!("note:      {n}");
                }
            }
            Ok(())
        }
        Commands::ExtractFrame {
            input,
            output,
            frame,
            quality,
            png_compression,
            background,
            metadata,
            preserve_metadata,
            to_srgb,
        } => {
            let options = ConvertOptions {
                quality: *quality,
                png_compression: *png_compression,
                background: parse_background(background)?,
                preserve_metadata: *preserve_metadata,
                metadata_policy: resolve_metadata_policy(*preserve_metadata, metadata.as_deref())?,
                selected_frame: Some(*frame),
                convert_to_srgb: *to_srgb,
            };
            let result = engine.extract_frame_to_path(input, *frame, output, &options)?;
            print_convert_result(cli, &result, "extracted");
            Ok(())
        }
        Commands::Convert {
            input,
            output,
            quality,
            png_compression,
            background,
            metadata,
            preserve_metadata,
            frame,
            to_srgb,
        } => {
            let options = ConvertOptions {
                quality: *quality,
                png_compression: *png_compression,
                background: parse_background(background)?,
                preserve_metadata: *preserve_metadata,
                metadata_policy: resolve_metadata_policy(*preserve_metadata, metadata.as_deref())?,
                selected_frame: *frame,
                convert_to_srgb: *to_srgb,
            };
            let result = engine.convert_to_path(input, output, &options)?;
            print_convert_result(cli, &result, "converted");
            Ok(())
        }
        Commands::Process {
            input,
            output,
            quality,
            target_size,
            png_compression,
            background,
            metadata,
            preserve_metadata,
            frame,
            to_srgb,
            resize,
            resize_fit,
            resize_fill,
            pad,
            pad_color,
            crop,
            thumbnail,
            rotate,
            rotate_background,
            flip_h,
            flip_v,
            grayscale,
            brightness,
            contrast,
            saturation,
            blur,
            sharpen,
            sharpen_threshold,
            watermark,
            watermark_position,
            watermark_opacity,
            watermark_margin,
            flatten,
            op,
        } => {
            let background = parse_background(background)?;
            let rotate_background = parse_background(rotate_background)?;
            let pad_color = parse_background(pad_color)?;
            let individual_set = resize.is_some()
                || resize_fit.is_some()
                || resize_fill.is_some()
                || pad.is_some()
                || crop.is_some()
                || thumbnail.is_some()
                || rotate.is_some()
                || *flip_h
                || *flip_v
                || *grayscale
                || brightness.is_some()
                || contrast.is_some()
                || saturation.is_some()
                || blur.is_some()
                || sharpen.is_some()
                || watermark.is_some()
                || *flatten;
            if !op.is_empty() && individual_set {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(
                    "cannot combine --op with individual operation flags; use --op alone for exact ordering, or individual flags for the documented canonical order".to_string(),
                ));
            }
            let pipeline = if !op.is_empty() {
                let mut ops = Vec::with_capacity(op.len());
                for spec in op {
                    ops.push(parse_op_spec(spec)?);
                }
                Pipeline::from_operations(ops)
            } else {
                let mut spec = PipelineSpec {
                    resize: resize.as_deref().map(parse_dimensions).transpose()?,
                    resize_fit: resize_fit.as_deref().map(parse_dimensions).transpose()?,
                    resize_fill: resize_fill.as_deref().map(parse_dimensions).transpose()?,
                    crop: crop.as_deref().map(parse_crop).transpose()?,
                    thumbnail: *thumbnail,
                    rotate_degrees: *rotate,
                    rotate_background,
                    flip_horizontal: *flip_h,
                    flip_vertical: *flip_v,
                    grayscale: *grayscale,
                    brightness: *brightness,
                    contrast: *contrast,
                    saturation: *saturation,
                    blur: *blur,
                    sharpen: sharpen.map(|s| (s, *sharpen_threshold)),
                    flatten: if *flatten { Some(background) } else { None },
                    ..Default::default()
                };
                if let Some((w, h)) = pad.as_deref().map(parse_dimensions).transpose()? {
                    spec.pad = Some((w, h, pad_color));
                }
                if let Some(wm_path) = watermark {
                    let position = parse_watermark_position(watermark_position)?;
                    spec.watermark = Some(WatermarkSpec {
                        overlay: engine.decode_file(wm_path)?,
                        position,
                        opacity: *watermark_opacity,
                        margin: *watermark_margin,
                    });
                }
                spec.build()?
            };
            let options = ProcessOptions::new(
                ConvertOptions {
                    quality: *quality,
                    png_compression: *png_compression,
                    background,
                    preserve_metadata: *preserve_metadata,
                    metadata_policy: resolve_metadata_policy(
                        *preserve_metadata,
                        metadata.as_deref(),
                    )?,
                    selected_frame: *frame,
                    convert_to_srgb: *to_srgb,
                },
                pipeline,
            );
            let op_count = options.pipeline.len();
            if let Some(target_size) = target_size {
                if quality.is_some() {
                    return Err(openpixel_core::OpenPixelError::InvalidArgument(
                        "cannot combine --target-size with --quality; the target-size search picks quality for you".to_string(),
                    ));
                }
                let target_bytes = parse_target_size(target_size)?;
                let outcome = engine.process_to_size(input, output, &options, target_bytes)?;
                if cli.json {
                    println!("{}", serde_json::to_string_pretty(&outcome).unwrap());
                } else if !cli.quiet {
                    let result = &outcome.result;
                    println!(
                        "processed {} ({}x{}) -> {} : {} bytes -> {} bytes (target {} bytes, quality {})",
                        result.source_format,
                        result.width,
                        result.height,
                        result.target_format,
                        result.input_bytes,
                        result.output_bytes,
                        target_bytes,
                        match outcome.quality_used {
                            Some(q) => q.to_string(),
                            None => "n/a (lossless)".to_string(),
                        },
                    );
                    println!("wrote {}", result.output_path);
                    if outcome.target_met {
                        println!("target size met");
                    } else {
                        println!("warning: target size NOT met");
                    }
                    print_warnings(cli, result);
                }
                return Ok(());
            }
            let result = engine.process_to_path(input, output, &options)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result).unwrap());
            } else if !cli.quiet {
                println!(
                    "processed {} ({}x{}) -> {} : {} bytes -> {} bytes ({} operation{})",
                    result.source_format,
                    result.width,
                    result.height,
                    result.target_format,
                    result.input_bytes,
                    result.output_bytes,
                    op_count,
                    if op_count == 1 { "" } else { "s" },
                );
                println!("wrote {}", result.output_path);
                print_warnings(cli, &result);
            }
            Ok(())
        }
        Commands::Discover { input } => {
            let bytes = fs::read(input).map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    openpixel_core::OpenPixelError::NotFound(input.clone())
                } else {
                    openpixel_core::OpenPixelError::Io {
                        path: input.clone(),
                        source: e,
                    }
                }
            })?;
            let ext = input.extension().and_then(|e| e.to_str());
            let result = engine.discover_format(&bytes, ext, None);
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&result).unwrap());
            } else {
                println!("file:       {}", input.display());
                println!("format:     {}", result.format);
                println!("method:     {:?}", result.method);
                println!("confidence: {:?}", result.confidence);
                if result.has_mismatch() {
                    println!(
                        "warning:    extension claims {:?} but the signature says {}",
                        result.extension_claim, result.format
                    );
                }
            }
            Ok(())
        }
        Commands::Formats => {
            let caps = engine.get_capabilities();
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&caps).unwrap());
            } else {
                println!(
                    "{:<10} {:<7} {:<7} {:<6} {:<9} status",
                    "format", "decode", "encode", "alpha", "anim"
                );
                for c in &caps {
                    println!(
                        "{:<10} {:<7} {:<7} {:<6} {:<9} {}",
                        c.format_id,
                        yes(c.can_decode),
                        yes(c.can_encode),
                        yes(c.supports_alpha),
                        yes(c.supports_animation),
                        c.status
                    );
                }
                println!("\nFormats with decode=yes convert as a source; formats with encode=yes convert as a target.");
                println!("Use `openpixel capabilities <format>` for full detail.");
            }
            Ok(())
        }
        Commands::Capabilities { format } => {
            let fmt = ImageFormat::from_name(format).ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown format '{format}'"
                ))
            })?;
            let cap = engine.get_capability(fmt).ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown format '{format}'"
                ))
            })?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&cap).unwrap());
            } else {
                println!("format:     {}", cap.format_id);
                println!("extensions: {}", cap.extensions.join(", "));
                println!("mime:       {}", cap.mime_types.join(", "));
                println!("decode:     {}", yes(cap.can_decode));
                println!("encode:     {}", yes(cap.can_encode));
                println!("alpha:      {}", yes(cap.supports_alpha));
                println!("animation:  {}", yes(cap.supports_animation));
                println!("metadata:   {}", yes(cap.supports_metadata));
                println!("icc:        {}", yes(cap.supports_icc));
                println!("multi-frame: {}", yes(cap.supports_multiple_frames));
                println!("dependency: {}", cap.native_dependency);
                println!("license:    {}", cap.license);
                println!("status:     {}", cap.status);
                println!("max dim:    {} px", cap.max_dimension);
            }
            Ok(())
        }
        Commands::Batch {
            input_dir,
            format,
            quality,
            out_dir,
            workers,
            sequential,
        } => {
            let target = ImageFormat::from_name(format).ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown format '{format}'"
                ))
            })?;
            let out_dir = out_dir
                .clone()
                .unwrap_or_else(|| input_dir.join("openpixel-out"));
            fs::create_dir_all(&out_dir).map_err(|e| openpixel_core::OpenPixelError::Io {
                path: out_dir.clone(),
                source: e,
            })?;
            let worker_count = match (*workers, *sequential) {
                (_, true) => 1,
                (Some(n), false) => n,
                (None, false) => openpixel_jobs::default_workers(),
            };
            if worker_count == 0 || worker_count > openpixel_jobs::MAX_WORKERS {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "--workers must be 1..={} (got {worker_count})",
                    openpixel_jobs::MAX_WORKERS
                )));
            }
            let options = ConvertOptions {
                quality: *quality,
                background: [255, 255, 255],
                ..Default::default()
            };
            let summary = if worker_count == 1 {
                batch_sequential(cli, engine, input_dir, &out_dir, target, &options)?
            } else {
                batch_parallel(
                    cli,
                    engine,
                    input_dir,
                    &out_dir,
                    target,
                    &options,
                    worker_count,
                )?
            };
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&summary).unwrap());
            } else if !cli.quiet {
                println!(
                    "batch done: {} converted, {} failed ({} worker{}) -> {}",
                    summary.converted,
                    summary.failed,
                    summary.workers,
                    if summary.workers == 1 { "" } else { "s" },
                    out_dir.display()
                );
            }
            Ok(())
        }
        Commands::Bench { iterations, quick } => {
            let report = bench::run_bench(*iterations, *quick)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&report).unwrap());
            } else {
                bench::print_report(&report);
            }
            Ok(())
        }
        Commands::Pdf { command } => run_pdf(cli, engine, command),
        Commands::Doc { command } => run_doc(cli, command),
        Commands::Ocr {
            input,
            output,
            lang,
            psm,
            preprocess,
            format,
        } => {
            let format = format.trim().to_ascii_lowercase();
            if !matches!(format.as_str(), "txt" | "html" | "json") {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown OCR format '{format}' — use txt, html or json"
                )));
            }
            let options = ocr_options(lang, *psm, preprocess)?;
            let bytes = read_pdf_bytes(input)?;
            if bytes.starts_with(b"%PDF-") {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "{} is a PDF — `openpixel ocr` reads images; use `openpixel pdf ocr` for scanned PDFs",
                    input.display()
                )));
            }
            let (_, image) = engine.decode_bytes(&bytes, None)?;
            let ocr = openpixel_ocr::TesseractEngine::new().map_err(ocr_err)?;
            let result = ocr.recognize(&image, &options).map_err(ocr_err)?;
            let out: Vec<u8> = match format.as_str() {
                "txt" => format!("{}\n", result.text).into_bytes(),
                "html" => ocr_result_to_html(&result).into_bytes(),
                "json" => serde_json::to_string_pretty(&result).unwrap().into_bytes(),
                _ => unreachable!(),
            };
            match output {
                Some(path) => {
                    write_pdf_bytes(path, &out)?;
                    if !cli.quiet {
                        println!(
                            "ocr: {} words, mean confidence {:.0}% ({} ms) -> {} ({} bytes, {})",
                            result.words.len(),
                            result.mean_confidence,
                            result.duration_ms,
                            path.display(),
                            out.len(),
                            format
                        );
                    }
                }
                None => {
                    // Text output goes to stdout; the summary goes
                    // to stderr so piping the text stays clean.
                    use std::io::Write;
                    std::io::stdout().write_all(&out).map_err(|e| {
                        openpixel_core::OpenPixelError::Io {
                            path: PathBuf::from("<stdout>"),
                            source: e,
                        }
                    })?;
                    if !cli.quiet {
                        eprintln!(
                            "ocr: {} words, mean confidence {:.0}% ({} ms)",
                            result.words.len(),
                            result.mean_confidence,
                            result.duration_ms
                        );
                    }
                }
            }
            Ok(())
        }
    }
}

/// What a one-output PDF command reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct PdfOpSummary {
    command: &'static str,
    output: PathBuf,
    pages: u32,
    bytes: u64,
}

/// One output of a multi-output PDF command.
#[derive(Debug, serde::Serialize)]
struct PdfOpOutput {
    path: PathBuf,
    pages: u32,
    bytes: u64,
}

/// What `pdf split` reports.
#[derive(Debug, serde::Serialize)]
struct PdfSplitSummary {
    command: &'static str,
    outputs: Vec<PdfOpOutput>,
}

/// One rendered page.
#[derive(Debug, serde::Serialize)]
struct PdfRenderOutput {
    path: PathBuf,
    page: u32,
    width: u32,
    height: u32,
    bytes: u64,
}

/// What `pdf render` reports.
#[derive(Debug, serde::Serialize)]
struct PdfRenderSummary {
    command: &'static str,
    format: String,
    scale: f32,
    outputs: Vec<PdfRenderOutput>,
}

/// Map a PDF error onto the CLI's error type. `NotImplemented`
/// (missing libpdfium, unimplemented op) keeps its variant so the
/// message is not dressed up as a bad argument; everything else is
/// a caller-visible failure of the input or the operation.
fn pdf_err(e: openpixel_pdf::PdfError) -> openpixel_core::OpenPixelError {
    match e {
        openpixel_pdf::PdfError::NotImplemented(msg) => {
            openpixel_core::OpenPixelError::NotImplemented(msg)
        }
        other => openpixel_core::OpenPixelError::InvalidArgument(other.to_string()),
    }
}

/// Map an OCR error onto the CLI's error type (same pattern as
/// `pdf_err`: a missing Tesseract install stays NotImplemented
/// with the install hint; everything else is a caller-visible
/// failure of the input or the options).
fn ocr_err(e: openpixel_ocr::OcrError) -> openpixel_core::OpenPixelError {
    match e {
        openpixel_ocr::OcrError::Unavailable(msg) => {
            openpixel_core::OpenPixelError::NotImplemented(msg)
        }
        other => openpixel_core::OpenPixelError::InvalidArgument(other.to_string()),
    }
}

/// Split a `--lang` value on '+' or ','; `--lang eng+ben` and
/// `--lang eng,ben` mean the same thing.
fn parse_ocr_languages(lang: &str) -> Vec<String> {
    lang.split(['+', ','])
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Build OCR options from the CLI flags.
fn ocr_options(
    lang: &str,
    psm: u8,
    preprocess: &str,
) -> Result<openpixel_ocr::OcrOptions, openpixel_core::OpenPixelError> {
    let mode = std::str::FromStr::from_str(preprocess)
        .map_err(|e: String| openpixel_core::OpenPixelError::InvalidArgument(e))?;
    let options = openpixel_ocr::OcrOptions {
        languages: parse_ocr_languages(lang),
        psm,
        dpi: None,
        preprocess: mode,
    };
    options.validate().map_err(ocr_err)?;
    Ok(options)
}

/// Escape text for the HTML OCR output.
fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

/// Render one OCR result as a small standalone HTML page: one
/// paragraph per recognised line, each word a span carrying its
/// bounding box + confidence in the title attribute.
fn ocr_result_to_html(result: &openpixel_ocr::OcrResult) -> String {
    let mut s = String::from(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>OCR result</title>\n<style>body{font-family:sans-serif;line-height:1.6;margin:2em}.ocr_word{border-bottom:1px dotted #888}</style>\n</head>\n<body>\n",
    );
    for line in result.lines() {
        s.push_str("<p>");
        for word in line {
            s.push_str(&format!(
                "<span class=\"ocr_word\" title=\"bbox {} {} {} {}; confidence {:.0}\">{}</span> ",
                word.x,
                word.y,
                word.width,
                word.height,
                word.confidence,
                escape_html(&word.text)
            ));
        }
        s.push_str("</p>\n");
    }
    s.push_str("</body>\n</html>\n");
    s
}

/// Read a PDF (or image, for `from-images`) with the same
/// not-found / I/O distinction the image commands use.
fn read_pdf_bytes(path: &Path) -> Result<Vec<u8>, openpixel_core::OpenPixelError> {
    fs::read(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            openpixel_core::OpenPixelError::NotFound(path.to_path_buf())
        } else {
            openpixel_core::OpenPixelError::Io {
                path: path.to_path_buf(),
                source: e,
            }
        }
    })
}

/// Write PDF bytes, creating parent directories and applying the
/// same output-path rule as the image commands (no `..`, no NUL).
fn write_pdf_bytes(path: &Path, bytes: &[u8]) -> Result<(), openpixel_core::OpenPixelError> {
    use openpixel_core::security::validate_output_path;
    validate_output_path(path)?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| openpixel_core::OpenPixelError::Io {
                path: parent.to_path_buf(),
                source: e,
            })?;
        }
    }
    fs::write(path, bytes).map_err(|e| openpixel_core::OpenPixelError::Io {
        path: path.to_path_buf(),
        source: e,
    })
}

/// Parse "1,3,5" / "1-3,5" into 1-based page numbers, in order.
/// Ranges are inclusive; a page number must be >= 1.
fn parse_page_list(s: &str) -> Result<Vec<u32>, openpixel_core::OpenPixelError> {
    let err = || {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid page list '{s}' — use e.g. 1,3,5 or 1-3,5"
        ))
    };
    let mut pages = Vec::new();
    for part in s.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err(err());
        }
        if let Some((a, b)) = part.split_once('-') {
            let a: u32 = a.trim().parse().map_err(|_| err())?;
            let b: u32 = b.trim().parse().map_err(|_| err())?;
            if a == 0 || b < a {
                return Err(err());
            }
            pages.extend(a..=b);
        } else {
            let p: u32 = part.parse().map_err(|_| err())?;
            if p == 0 {
                return Err(err());
            }
            pages.push(p);
        }
    }
    if pages.is_empty() {
        return Err(err());
    }
    Ok(pages)
}

/// Parse "1-3,5-7" into inclusive ranges; a lone number means a
/// one-page range.
fn parse_ranges(s: &str) -> Result<Vec<(u32, u32)>, openpixel_core::OpenPixelError> {
    let err = || {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid page ranges '{s}' — use e.g. 1-3,5-7"
        ))
    };
    let mut ranges = Vec::new();
    for part in s.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err(err());
        }
        if let Some((a, b)) = part.split_once('-') {
            let a: u32 = a.trim().parse().map_err(|_| err())?;
            let b: u32 = b.trim().parse().map_err(|_| err())?;
            if a == 0 || b < a {
                return Err(err());
            }
            ranges.push((a, b));
        } else {
            let p: u32 = part.parse().map_err(|_| err())?;
            if p == 0 {
                return Err(err());
            }
            ranges.push((p, p));
        }
    }
    if ranges.is_empty() {
        return Err(err());
    }
    Ok(ranges)
}

/// Parse a colour as #RRGGBB (the leading # is optional).
fn parse_hex_color(s: &str) -> Result<openpixel_pdf::Rgb, openpixel_core::OpenPixelError> {
    let err = || {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid colour '{s}' — use #RRGGBB, e.g. #ff0000"
        ))
    };
    let hex = s.strip_prefix('#').unwrap_or(s);
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(err());
    }
    let channel = |i: usize| -> std::result::Result<f64, openpixel_core::OpenPixelError> {
        u8::from_str_radix(&hex[i..i + 2], 16)
            .map(|v| v as f64 / 255.0)
            .map_err(|_| err())
    };
    Ok(openpixel_pdf::Rgb {
        r: channel(0)?,
        g: channel(2)?,
        b: channel(4)?,
    })
}

/// Parse "x,y,width,height" (points) for `pdf redact --rect`.
fn parse_rect_arg(s: &str) -> Result<(f64, f64, f64, f64), openpixel_core::OpenPixelError> {
    let err = || {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid rectangle '{s}' — use x,y,width,height in points, e.g. 72,600,200,20"
        ))
    };
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() != 4 {
        return Err(err());
    }
    let mut vals = [0.0f64; 4];
    for (i, p) in parts.iter().enumerate() {
        vals[i] = p.trim().parse().map_err(|_| err())?;
    }
    Ok((vals[0], vals[1], vals[2], vals[3]))
}

/// Parse a page-number position name for `pdf edit --page-numbers`.
fn parse_page_number_position(
    s: &str,
) -> Result<openpixel_pdf::PageNumberPosition, openpixel_core::OpenPixelError> {
    match s.trim().to_ascii_lowercase().as_str() {
        "bottom-center" => Ok(openpixel_pdf::PageNumberPosition::BottomCenter),
        "bottom-right" => Ok(openpixel_pdf::PageNumberPosition::BottomRight),
        "top-center" => Ok(openpixel_pdf::PageNumberPosition::TopCenter),
        "top-right" => Ok(openpixel_pdf::PageNumberPosition::TopRight),
        _ => Err(openpixel_core::OpenPixelError::InvalidArgument(format!(
            "unknown page-number position '{s}' — use bottom-center, bottom-right, top-center or top-right"
        ))),
    }
}

/// Default `--out-dir` for a multi-output PDF command: a directory
/// named `<input-stem>-<suffix>` next to the input file.
fn default_pdf_out_dir(input: &Path, suffix: &str) -> PathBuf {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "out".into());
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!("{stem}-{suffix}"))
}

fn run_pdf(
    cli: &Cli,
    engine: &Arc<Engine>,
    command: &PdfCommands,
) -> Result<(), openpixel_core::OpenPixelError> {
    let pdf = openpixel_pdf::PdfEngine::default();
    match command {
        PdfCommands::Info { input } => {
            let bytes = read_pdf_bytes(input)?;
            let info = pdf.inspect(&bytes).map_err(pdf_err)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&info).unwrap());
            } else {
                println!("file:      {}", input.display());
                if info.encrypted {
                    // The page count is unknown without the
                    // password (lopdf loads no objects) — say so
                    // instead of printing the 0 the struct carries.
                    println!("pages:     unknown (encrypted)");
                } else {
                    println!("pages:     {}", info.page_count);
                }
                println!("version:   {}", info.version);
                println!("encrypted: {}", yes(info.encrypted));
                if let Some(enc) = &info.encryption {
                    println!("algorithm: {}", enc.algorithm);
                    if let Some(r) = enc.revision {
                        println!("revision:  {r}");
                    }
                    println!(
                        "allowed:   print:{} modify:{} copy:{} annotate:{}",
                        yes(enc.print),
                        yes(enc.modify),
                        yes(enc.copy),
                        yes(enc.annotate)
                    );
                }
                if let Some(t) = &info.title {
                    println!("title:     {t}");
                }
                if let Some(a) = &info.author {
                    println!("author:    {a}");
                }
                if let Some(c) = &info.creator {
                    println!("creator:   {c}");
                }
                if let Some(p) = &info.producer {
                    println!("producer:  {p}");
                }
                // Empty for encrypted documents (page sizes are
                // unknown without the password); skip the line
                // instead of printing a bare label.
                if !info.page_sizes.is_empty() {
                    let sizes: Vec<String> = info
                        .page_sizes
                        .iter()
                        .enumerate()
                        .map(|(i, (w, h))| format!("p{}: {w:.0}x{h:.0} pt", i + 1))
                        .collect();
                    println!("page sizes: {}", sizes.join(", "));
                }
            }
            Ok(())
        }
        PdfCommands::Merge { inputs, output } => {
            let mut docs = Vec::with_capacity(inputs.len());
            for input in inputs {
                docs.push(read_pdf_bytes(input)?);
            }
            let out = pdf.merge(&docs).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "merge", output, &out);
            Ok(())
        }
        PdfCommands::Split {
            input,
            ranges,
            out_dir,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let ranges = parse_ranges(ranges)?;
            let parts = pdf.split(&bytes, &ranges).map_err(pdf_err)?;
            let out_dir = out_dir
                .clone()
                .unwrap_or_else(|| default_pdf_out_dir(input, "split"));
            fs::create_dir_all(&out_dir).map_err(|e| openpixel_core::OpenPixelError::Io {
                path: out_dir.clone(),
                source: e,
            })?;
            let stem = input
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "out".into());
            let mut outputs = Vec::with_capacity(parts.len());
            for (i, part) in parts.iter().enumerate() {
                let path = out_dir.join(format!("{stem}-part{}.pdf", i + 1));
                write_pdf_bytes(&path, part)?;
                outputs.push(PdfOpOutput {
                    pages: pdf.page_count(part).map_err(pdf_err)?,
                    bytes: part.len() as u64,
                    path,
                });
            }
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfSplitSummary {
                        command: "split",
                        outputs
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                for o in &outputs {
                    println!(
                        "wrote {} ({} pages, {} bytes)",
                        o.path.display(),
                        o.pages,
                        o.bytes
                    );
                }
            }
            Ok(())
        }
        PdfCommands::Rotate {
            input,
            output,
            pages,
            degrees,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let list = pages.as_deref().map(parse_page_list).transpose()?;
            let out = pdf
                .rotate(&bytes, list.as_deref(), *degrees)
                .map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "rotate", output, &out);
            Ok(())
        }
        PdfCommands::Extract {
            input,
            output,
            pages,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let list = parse_page_list(pages)?;
            let out = pdf.extract(&bytes, &list).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "extract", output, &out);
            Ok(())
        }
        PdfCommands::Remove {
            input,
            output,
            pages,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let list = parse_page_list(pages)?;
            let out = pdf.remove(&bytes, &list).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "remove", output, &out);
            Ok(())
        }
        PdfCommands::Reorder {
            input,
            output,
            order,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let list = parse_page_list(order)?;
            let out = pdf.reorder(&bytes, &list).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "reorder", output, &out);
            Ok(())
        }
        PdfCommands::Duplicate {
            input,
            output,
            pages,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let list = parse_page_list(pages)?;
            let out = pdf.duplicate(&bytes, &list).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "duplicate", output, &out);
            Ok(())
        }
        PdfCommands::Insert {
            input,
            other,
            output,
            at,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let other_bytes = read_pdf_bytes(other)?;
            let out = pdf.insert(&bytes, *at, &[other_bytes]).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "insert", output, &out);
            Ok(())
        }
        PdfCommands::Replace {
            input,
            replacement,
            output,
            page,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let replacement_bytes = read_pdf_bytes(replacement)?;
            let out = pdf
                .replace(&bytes, *page, &replacement_bytes)
                .map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "replace", output, &out);
            Ok(())
        }
        PdfCommands::Reverse { input, output } => {
            let bytes = read_pdf_bytes(input)?;
            let out = pdf.reverse(&bytes).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "reverse", output, &out);
            Ok(())
        }
        PdfCommands::Booklet { input, output } => {
            let bytes = read_pdf_bytes(input)?;
            let out = pdf.booklet(&bytes).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "booklet", output, &out);
            Ok(())
        }
        PdfCommands::Nup {
            input,
            output,
            cols,
            rows,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let out = pdf.nup(&bytes, *cols, *rows).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "nup", output, &out);
            Ok(())
        }
        PdfCommands::Render {
            input,
            out_dir,
            pages,
            format,
            scale,
            quality,
        } => {
            let target = ImageFormat::from_name(format).ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown format '{format}' — render targets are image formats (png, jpg, webp)"
                ))
            })?;
            let bytes = read_pdf_bytes(input)?;
            let list = pages.as_deref().map(parse_page_list).transpose()?;
            let rendered = pdf
                .render_to_images(&bytes, list.as_deref(), *scale)
                .map_err(pdf_err)?;
            let out_dir = out_dir
                .clone()
                .unwrap_or_else(|| default_pdf_out_dir(input, "pages"));
            fs::create_dir_all(&out_dir).map_err(|e| openpixel_core::OpenPixelError::Io {
                path: out_dir.clone(),
                source: e,
            })?;
            let stem = input
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "out".into());
            let ext = target.extensions()[0];
            let options = ConvertOptions {
                quality: *quality,
                ..Default::default()
            };
            let mut outputs = Vec::with_capacity(rendered.len());
            for page in &rendered {
                let (_result, encoded) = engine
                    .encode_decoded(&page.image, target, &options)
                    .map_err(|e| {
                        openpixel_core::OpenPixelError::InvalidArgument(format!(
                            "could not encode rendered page {} as {format}: {e}",
                            page.page
                        ))
                    })?;
                let path = out_dir.join(format!("{stem}-p{}.{ext}", page.page));
                fs::write(&path, &encoded).map_err(|e| openpixel_core::OpenPixelError::Io {
                    path: path.clone(),
                    source: e,
                })?;
                if !cli.quiet {
                    for w in &_result.warnings {
                        println!("warning: {w}");
                    }
                }
                outputs.push(PdfRenderOutput {
                    path,
                    page: page.page,
                    width: page.image.width,
                    height: page.image.height,
                    bytes: encoded.len() as u64,
                });
            }
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfRenderSummary {
                        command: "render",
                        format: format.clone(),
                        scale: *scale,
                        outputs
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                for o in &outputs {
                    println!(
                        "wrote {} (page {}, {}x{} px, {} bytes)",
                        o.path.display(),
                        o.page,
                        o.width,
                        o.height,
                        o.bytes
                    );
                }
            }
            Ok(())
        }
        PdfCommands::FromImages {
            inputs,
            output,
            page_size,
        } => {
            let mut images = Vec::with_capacity(inputs.len());
            for input in inputs {
                images.push(read_pdf_bytes(input)?);
            }
            let size = match page_size.as_deref() {
                None => None,
                Some(name) => Some(openpixel_pdf::named_page_size(name).ok_or_else(|| {
                    openpixel_core::OpenPixelError::InvalidArgument(format!(
                        "unknown page size '{name}' — use A4, Letter, or A5"
                    ))
                })?),
            };
            let out = pdf.from_images(&images, size).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "from-images", output, &out);
            Ok(())
        }
        PdfCommands::Compress {
            input,
            output,
            mode,
            strip_metadata,
        } => {
            let mode = openpixel_pdf::CompressMode::from_name(mode).ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown compression mode '{mode}' — use screen, ebook or printer"
                ))
            })?;
            let bytes = read_pdf_bytes(input)?;
            let (out, outcome) = pdf
                .compress(
                    &bytes,
                    mode,
                    openpixel_pdf::CompressOptions {
                        strip_metadata: *strip_metadata,
                        images: true,
                    },
                )
                .map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfCompressSummary {
                        command: "compress",
                        mode: outcome.mode.label(),
                        output: output.clone(),
                        input_bytes: outcome.input_bytes,
                        output_bytes: outcome.output_bytes,
                        saved_bytes: outcome.saved_bytes,
                        saved_percent: outcome.saved_percent,
                        images_recompressed: outcome.images_recompressed,
                        images_skipped: outcome.images_skipped,
                        skipped_reasons: outcome.skipped_reasons.clone(),
                        note: outcome.note.clone(),
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "compressed {} -> {} ({} bytes -> {} bytes, {:.1}% saved)",
                    input.display(),
                    output.display(),
                    outcome.input_bytes,
                    outcome.output_bytes,
                    outcome.saved_percent
                );
                println!(
                    "images: {} recompressed, {} skipped{}",
                    outcome.images_recompressed,
                    outcome.images_skipped,
                    if outcome.skipped_reasons.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", outcome.skipped_reasons.join("; "))
                    }
                );
                if let Some(note) = &outcome.note {
                    println!("note: {note}");
                }
            }
            Ok(())
        }
        PdfCommands::Protect {
            input,
            output,
            user_password,
            owner_password,
            no_print,
            no_copy,
            no_modify,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let perms = openpixel_pdf::PdfPermissions {
                print: !no_print,
                copy: !no_copy,
                modify: !no_modify,
            };
            let out = pdf
                .protect(
                    &bytes,
                    user_password,
                    owner_password.as_deref().unwrap_or(""),
                    perms,
                )
                .map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            // The output is encrypted, so its page count cannot be
            // read back without a password — report the input's
            // count instead of a misleading "0 pages".
            let pages = pdf.page_count(&bytes).unwrap_or(0);
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfOpSummary {
                        command: "protect",
                        output: output.to_path_buf(),
                        pages,
                        bytes: out.len() as u64,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "wrote {} ({} pages, {} bytes, encrypted)",
                    output.display(),
                    pages,
                    out.len()
                );
            }
            if !cli.json && !cli.quiet {
                println!("protected with RC4-128 (user password required to open)");
            }
            Ok(())
        }
        PdfCommands::Unlock {
            input,
            output,
            password,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let out = pdf.unlock(&bytes, password).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "unlock", output, &out);
            Ok(())
        }
        PdfCommands::Watermark {
            input,
            output,
            text,
            font_size,
            opacity,
            angle,
        } => {
            let bytes = read_pdf_bytes(input)?;
            let out = pdf
                .watermark(
                    &bytes,
                    text,
                    openpixel_pdf::WatermarkOptions {
                        font_size: *font_size,
                        opacity: *opacity,
                        angle_degrees: *angle,
                        grey: 0.5,
                    },
                )
                .map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            print_pdf_op(cli, &pdf, "watermark", output, &out);
            Ok(())
        }
        PdfCommands::ExtractText {
            input,
            output,
            pages,
            format,
        } => {
            let format = format.trim().to_ascii_lowercase();
            if !matches!(format.as_str(), "txt" | "html" | "epub" | "docx") {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown text format '{format}' — use txt, html, epub or docx"
                )));
            }
            let bytes = read_pdf_bytes(input)?;
            let list = pages.as_deref().map(parse_page_list).transpose()?;
            let extracted = pdf.extract_text(&bytes, list.as_deref()).map_err(pdf_err)?;
            let title = pdf
                .inspect(&bytes)
                .map_err(pdf_err)?
                .title
                .unwrap_or_else(|| "Document".to_string());
            let out: Vec<u8> = match format.as_str() {
                "txt" => openpixel_pdf::PdfEngine::text_to_txt(&extracted).into_bytes(),
                "html" => openpixel_pdf::PdfEngine::text_to_html(&extracted, &title).into_bytes(),
                "epub" => {
                    openpixel_pdf::PdfEngine::text_to_epub(&extracted, &title).map_err(pdf_err)?
                }
                "docx" => {
                    openpixel_pdf::PdfEngine::text_to_docx(&extracted, &title).map_err(pdf_err)?
                }
                _ => unreachable!(),
            };
            let output = output.clone().unwrap_or_else(|| {
                let stem = input
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "out".into());
                input.with_file_name(format!("{stem}.{format}"))
            });
            write_pdf_bytes(&output, &out)?;
            let chars: usize = extracted.iter().map(|p| p.text.len()).sum();
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfExtractTextSummary {
                        command: "extract-text",
                        format: format.clone(),
                        output: output.clone(),
                        pages: extracted.len() as u32,
                        chars: chars as u64,
                        bytes: out.len() as u64,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "extracted {} pages ({} chars) -> {} ({} bytes, {})",
                    extracted.len(),
                    chars,
                    output.display(),
                    out.len(),
                    format
                );
            }
            Ok(())
        }
        PdfCommands::Ocr {
            input,
            output,
            lang,
            psm,
            pages,
            scale,
        } => {
            // `pdf ocr` offers no --preprocess flag: the text
            // layer is built from the image as given (like
            // `tesseract … pdf`), so preprocessing does not apply
            // on this path — see docs/OCR.md.
            let options = openpixel_ocr::OcrOptions {
                languages: parse_ocr_languages(lang),
                psm: *psm,
                dpi: None,
                preprocess: openpixel_ocr::PreprocessMode::None,
            };
            options.validate().map_err(ocr_err)?;
            let bytes = read_pdf_bytes(input)?;
            let ocr = openpixel_ocr::TesseractEngine::new().map_err(ocr_err)?;
            let title = input
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "OpenPixel OCR".into());
            // One page per input: a PDF renders its pages via
            // PDFium first (scale 3.0 = 216 DPI by default); a
            // single image is used as given (Leptonica reads the
            // bytes — the engine validates decodability first so
            // a bad file fails here, not inside Tesseract).
            let page_bytes: Vec<(Vec<u8>, String)> = if bytes.starts_with(b"%PDF-") {
                let list = pages.as_deref().map(parse_page_list).transpose()?;
                let rendered = pdf
                    .render_to_images(&bytes, list.as_deref(), *scale)
                    .map_err(pdf_err)?;
                let mut out = Vec::with_capacity(rendered.len());
                let encode_options = ConvertOptions::default();
                for page in &rendered {
                    let (_result, encoded) = engine
                        .encode_decoded(&page.image, ImageFormat::Png, &encode_options)
                        .map_err(|e| {
                            openpixel_core::OpenPixelError::InvalidArgument(format!(
                                "could not encode rendered page {} as PNG for OCR: {e}",
                                page.page
                            ))
                        })?;
                    out.push((encoded, format!("page {}", page.page)));
                }
                out
            } else {
                let (_, _) = engine.decode_bytes(&bytes, None)?;
                vec![(bytes, title.clone())]
            };
            let search_pages: Vec<openpixel_ocr::SearchablePage<'_>> = page_bytes
                .iter()
                .map(|(b, name)| openpixel_ocr::SearchablePage {
                    image_bytes: b,
                    filename: name,
                })
                .collect();
            let (out, results) = ocr
                .searchable_pdf(&search_pages, &title, &options)
                .map_err(ocr_err)?;
            write_pdf_bytes(output, &out)?;
            let words: usize = results.iter().map(|r| r.words.len()).sum();
            let mean_conf = if words == 0 {
                0.0
            } else {
                results
                    .iter()
                    .map(|r| r.mean_confidence as f64 * r.words.len() as f64)
                    .sum::<f64>()
                    / words as f64
            };
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfOcrSummary {
                        command: "ocr",
                        output: output.clone(),
                        pages: results.len() as u32,
                        words: words as u64,
                        mean_confidence: mean_conf,
                        bytes: out.len() as u64,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "searchable PDF: {} pages, {} words, mean confidence {:.0}% -> {} ({} bytes)",
                    results.len(),
                    words,
                    mean_conf,
                    output.display(),
                    out.len()
                );
            }
            Ok(())
        }
        PdfCommands::Edit {
            input,
            output,
            op,
            text,
            page,
            x,
            y,
            size,
            color,
            image,
            image_width,
            image_height,
            page_numbers,
            page_number_format,
            page_number_position,
            header,
            footer,
        } => {
            let mut ops: Vec<openpixel_pdf::OverlayOp> = Vec::new();
            // --op JSON first (in the order given), then the
            // convenience flags — later ops draw on top of
            // earlier ones.
            for json in op {
                let parsed: openpixel_pdf::OverlayOp = serde_json::from_str(json).map_err(|e| {
                    openpixel_core::OpenPixelError::InvalidArgument(format!(
                        "could not parse --op as an overlay operation: {e}"
                    ))
                })?;
                ops.push(parsed);
            }
            if let Some(text) = text {
                let color = parse_hex_color(color)?;
                ops.push(openpixel_pdf::OverlayOp::Text {
                    page: *page,
                    x: *x,
                    y: *y,
                    text: text.clone(),
                    size: *size,
                    color,
                    font: openpixel_pdf::OverlayFont::Helvetica,
                });
            }
            let mut images: Vec<Vec<u8>> = Vec::new();
            if let Some(image_path) = image {
                let image_bytes = read_pdf_bytes(image_path)?;
                let (width, height) = match (image_width, image_height) {
                    (Some(w), Some(h)) => (*w, *h),
                    _ => {
                        // The image's own size in points (1 px = 1 pt).
                        let info = engine.get_image_info_bytes(&image_bytes)?;
                        (
                            image_width.unwrap_or(info.width as f64),
                            image_height.unwrap_or(info.height as f64),
                        )
                    }
                };
                images.push(image_bytes);
                ops.push(openpixel_pdf::OverlayOp::Image {
                    page: *page,
                    x: *x,
                    y: *y,
                    width,
                    height,
                    image_index: images.len() - 1,
                });
            }
            if *page_numbers {
                let position = parse_page_number_position(page_number_position)?;
                ops.push(openpixel_pdf::OverlayOp::PageNumbers {
                    pages: None,
                    format: page_number_format.clone(),
                    position,
                    size: 10.0,
                });
            }
            if header.is_some() || footer.is_some() {
                ops.push(openpixel_pdf::OverlayOp::HeaderFooter {
                    pages: None,
                    header: header.clone(),
                    footer: footer.clone(),
                    size: 10.0,
                });
            }
            if ops.is_empty() {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(
                    "pdf edit needs at least one op: --op, --text, --image, --page-numbers, --header or --footer".to_string(),
                ));
            }
            let bytes = read_pdf_bytes(input)?;
            let (out, outcome) = pdf.edit(&bytes, &ops, &images).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfEditSummary {
                        command: "edit",
                        output: output.clone(),
                        bytes: out.len() as u64,
                        outcome,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "edited {} -> {} ({} op(s), {} page(s), {} comment(s), {} bytes)",
                    input.display(),
                    output.display(),
                    outcome.ops_applied,
                    outcome.pages_touched,
                    outcome.comments_added,
                    out.len()
                );
                for w in &outcome.warnings {
                    println!("warning: {w}");
                }
            }
            Ok(())
        }
        PdfCommands::Redact {
            input,
            output,
            rect,
            page,
            text,
        } => {
            let mut redactions: Vec<openpixel_pdf::Redaction> = Vec::new();
            for r in rect {
                let (x, y, w, h) = parse_rect_arg(r)?;
                redactions.push(openpixel_pdf::Redaction::Rect(
                    openpixel_pdf::RectRedaction {
                        page: *page,
                        x,
                        y,
                        width: w,
                        height: h,
                    },
                ));
            }
            for t in text {
                redactions.push(openpixel_pdf::Redaction::Text(
                    openpixel_pdf::TextRedaction {
                        page: None,
                        text: t.clone(),
                    },
                ));
            }
            if redactions.is_empty() {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(
                    "pdf redact needs at least one --rect or --text".to_string(),
                ));
            }
            let bytes = read_pdf_bytes(input)?;
            let (out, outcome) = pdf.redact(&bytes, &redactions).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfRedactSummary {
                        command: "redact",
                        output: output.clone(),
                        bytes: out.len() as u64,
                        outcome,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "redacted {} -> {} ({} run(s), {} character(s) removed, {} page(s), {} bytes)",
                    input.display(),
                    output.display(),
                    outcome.runs_removed,
                    outcome.characters_removed,
                    outcome.pages_touched,
                    out.len()
                );
                if !outcome.redacted_texts.is_empty() {
                    println!("removed: {}", outcome.redacted_texts.join(", "));
                }
                for w in &outcome.warnings {
                    println!("warning: {w}");
                }
            }
            Ok(())
        }
        PdfCommands::Sign {
            input,
            output,
            key,
            cert,
            reason,
            location,
            contact,
        } => {
            let key_pem = std::fs::read_to_string(key).map_err(|e| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "could not read private key {}: {e}",
                    key.display()
                ))
            })?;
            let cert_pem = std::fs::read_to_string(cert).map_err(|e| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "could not read certificate {}: {e}",
                    cert.display()
                ))
            })?;
            let bytes = read_pdf_bytes(input)?;
            let options = openpixel_pdf::SignOptions {
                reason: reason.clone(),
                location: location.clone(),
                contact_info: contact.clone(),
            };
            let out = pdf
                .sign(&bytes, &key_pem, &cert_pem, &options)
                .map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            let pages = pdf.page_count(&bytes).unwrap_or(0);
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfOpSummary {
                        command: "sign",
                        output: output.clone(),
                        pages,
                        bytes: out.len() as u64,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "signed {} -> {} ({} pages, {} bytes; verify with `openpixel pdf verify-sign`)",
                    input.display(),
                    output.display(),
                    pages,
                    out.len()
                );
            }
            Ok(())
        }
        PdfCommands::VerifySign { input, trust } => {
            let mut anchors: Vec<Vec<u8>> = Vec::new();
            for path in trust {
                anchors.push(std::fs::read(path).map_err(|e| {
                    openpixel_core::OpenPixelError::InvalidArgument(format!(
                        "could not read trust anchor {}: {e}",
                        path.display()
                    ))
                })?);
            }
            let bytes = read_pdf_bytes(input)?;
            let outcome = pdf.verify_signatures(&bytes, &anchors).map_err(pdf_err)?;
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&outcome).unwrap());
            } else if !cli.quiet {
                if outcome.signatures.is_empty() {
                    println!("no signatures in {}", input.display());
                }
                for (i, sig) in outcome.signatures.iter().enumerate() {
                    println!(
                        "signature {}: valid: {}, trusted: {}, signer: {}, digest: {}",
                        i + 1,
                        yes(sig.valid),
                        yes(sig.trusted),
                        sig.signer.as_deref().unwrap_or("(unknown)"),
                        sig.digest_algorithm
                    );
                    if let Some(t) = &sig.signing_time {
                        println!("  signing time: {t}");
                    }
                    for c in &sig.checks {
                        println!("  check: {c}");
                    }
                    for w in &sig.warnings {
                        println!("  warning: {w}");
                    }
                }
            }
            // The report IS the answer: an invalid or untrusted
            // signature is reported, not an error — exit 0.
            Ok(())
        }
        PdfCommands::Flatten { input, output } => {
            let bytes = read_pdf_bytes(input)?;
            let (out, outcome) = pdf.flatten(&bytes).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfFlattenSummary {
                        command: "flatten",
                        output: output.clone(),
                        bytes: out.len() as u64,
                        outcome,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "flattened {} -> {} ({} annotation(s) flattened, {} dropped, {} form field(s) removed, {} bytes)",
                    input.display(),
                    output.display(),
                    outcome.annotations_flattened,
                    outcome.annotations_dropped,
                    outcome.form_fields_removed,
                    out.len()
                );
                for w in &outcome.warnings {
                    println!("warning: {w}");
                }
            }
            Ok(())
        }
        PdfCommands::SetMetadata {
            input,
            output,
            title,
            author,
            subject,
            keywords,
        } => {
            if title.is_none() && author.is_none() && subject.is_none() && keywords.is_none() {
                return Err(openpixel_core::OpenPixelError::InvalidArgument(
                    "pdf set-metadata needs at least one of --title, --author, --subject, --keywords (an empty string clears a field)".to_string(),
                ));
            }
            let bytes = read_pdf_bytes(input)?;
            let out = pdf
                .set_metadata(
                    &bytes,
                    openpixel_pdf::MetadataEdit {
                        title: title.clone(),
                        author: author.clone(),
                        subject: subject.clone(),
                        keywords: keywords.clone(),
                        creator: None,
                        producer: None,
                    },
                )
                .map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            let pages = pdf.page_count(&bytes).unwrap_or(0);
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfOpSummary {
                        command: "set-metadata",
                        output: output.clone(),
                        pages,
                        bytes: out.len() as u64,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "metadata set: {} -> {} ({} pages, {} bytes)",
                    input.display(),
                    output.display(),
                    pages,
                    out.len()
                );
            }
            Ok(())
        }
        PdfCommands::Repair { input, output } => {
            let bytes = read_pdf_bytes(input)?;
            let (out, outcome) = pdf.repair(&bytes).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfRepairSummary {
                        command: "repair",
                        output: output.clone(),
                        bytes: out.len() as u64,
                        outcome,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "repaired {} -> {} (recovery: {}, {} bytes)",
                    input.display(),
                    output.display(),
                    outcome.recovery,
                    out.len()
                );
                for w in &outcome.warnings {
                    println!("warning: {w}");
                }
            }
            Ok(())
        }
        PdfCommands::Sanitize { input, output } => {
            let bytes = read_pdf_bytes(input)?;
            let (out, outcome) = pdf.sanitize(&bytes).map_err(pdf_err)?;
            write_pdf_bytes(output, &out)?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfSanitizeSummary {
                        command: "sanitize",
                        output: output.clone(),
                        bytes: out.len() as u64,
                        outcome,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "sanitized {} -> {} ({} JavaScript, {} embedded file(s), {} launch action(s), {} auto-action(s) removed, {} bytes)",
                    input.display(),
                    output.display(),
                    outcome.javascript_removed,
                    outcome.embedded_files_removed,
                    outcome.launch_actions_removed,
                    outcome.auto_actions_removed,
                    out.len()
                );
                for w in &outcome.warnings {
                    println!("warning: {w}");
                }
            }
            Ok(())
        }
        PdfCommands::Inspect { input } => {
            let bytes = read_pdf_bytes(input)?;
            let info = pdf.inspect(&bytes).map_err(pdf_err)?;
            let threats = pdf.inspect_threats(&bytes).map_err(pdf_err)?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&PdfInspectSummary {
                        command: "inspect",
                        info,
                        threats,
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!("file:      {}", input.display());
                println!(
                    "pages:     {}",
                    if info.encrypted {
                        "unknown (encrypted)".to_string()
                    } else {
                        info.page_count.to_string()
                    }
                );
                println!("version:   {}", info.version);
                println!("encrypted: {}", yes(info.encrypted));
                println!(
                    "javascript:    {}",
                    if threats.javascript.is_empty() {
                        "absent".to_string()
                    } else {
                        format!("PRESENT — {}", threats.javascript.join("; "))
                    }
                );
                println!(
                    "embedded files: {}",
                    if threats.embedded_files.is_empty() {
                        "absent".to_string()
                    } else {
                        format!("PRESENT — {}", threats.embedded_files.join("; "))
                    }
                );
                println!(
                    "launch actions: {}",
                    if threats.launch_actions.is_empty() {
                        "absent".to_string()
                    } else {
                        format!("PRESENT — {}", threats.launch_actions.join("; "))
                    }
                );
                println!(
                    "auto actions:   {}",
                    if threats.auto_actions.is_empty() {
                        "absent".to_string()
                    } else {
                        format!("PRESENT — {}", threats.auto_actions.join("; "))
                    }
                );
                for w in &threats.warnings {
                    println!("warning: {w}");
                }
            }
            Ok(())
        }
    }
}

/// What `pdf compress` reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct PdfCompressSummary {
    command: &'static str,
    mode: &'static str,
    output: PathBuf,
    input_bytes: u64,
    output_bytes: u64,
    saved_bytes: i64,
    saved_percent: f64,
    images_recompressed: usize,
    images_skipped: usize,
    skipped_reasons: Vec<String>,
    note: Option<String>,
}

/// What `pdf extract-text` reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct PdfExtractTextSummary {
    command: &'static str,
    format: String,
    output: PathBuf,
    pages: u32,
    chars: u64,
    bytes: u64,
}

/// What `pdf ocr` reports, in text and `--json`. The confidence is
/// the word-weighted mean across pages — it describes the text
/// layer itself, which `searchable_pdf` returns from the same
/// recognition.
#[derive(Debug, serde::Serialize)]
struct PdfOcrSummary {
    command: &'static str,
    output: PathBuf,
    pages: u32,
    words: u64,
    mean_confidence: f64,
    bytes: u64,
}

/// What `pdf edit` reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct PdfEditSummary {
    command: &'static str,
    output: PathBuf,
    bytes: u64,
    outcome: openpixel_pdf::EditOutcome,
}

/// What `pdf redact` reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct PdfRedactSummary {
    command: &'static str,
    output: PathBuf,
    bytes: u64,
    outcome: openpixel_pdf::RedactOutcome,
}

/// What `pdf flatten` reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct PdfFlattenSummary {
    command: &'static str,
    output: PathBuf,
    bytes: u64,
    outcome: openpixel_pdf::FlattenOutcome,
}

/// What `pdf repair` reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct PdfRepairSummary {
    command: &'static str,
    output: PathBuf,
    bytes: u64,
    outcome: openpixel_pdf::RepairOutcome,
}

/// What `pdf sanitize` reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct PdfSanitizeSummary {
    command: &'static str,
    output: PathBuf,
    bytes: u64,
    outcome: openpixel_pdf::SanitizeOutcome,
}

/// What `pdf inspect` reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct PdfInspectSummary {
    command: &'static str,
    info: openpixel_pdf::PdfInfo,
    threats: openpixel_pdf::PdfThreats,
}

/// What `doc convert` reports, in text and `--json`.
#[derive(Debug, serde::Serialize)]
struct DocConvertSummary {
    command: &'static str,
    input: PathBuf,
    output: PathBuf,
    source: String,
    target: String,
    engine: String,
    input_bytes: u64,
    output_bytes: u64,
    fidelity: String,
}

fn run_doc(cli: &Cli, command: &DocCommands) -> Result<(), openpixel_core::OpenPixelError> {
    match command {
        DocCommands::Convert {
            input,
            to,
            output,
            timeout_secs,
        } => {
            let target = to.trim().trim_start_matches('.').to_ascii_lowercase();
            let bytes = read_pdf_bytes(input)?;
            let hint = input.extension().map(|e| e.to_string_lossy().to_string());
            let engine = openpixel_documents::DocumentEngine::new();
            let options = openpixel_documents::DocumentOptions {
                source_hint: hint,
                timeout_secs: *timeout_secs,
            };
            let (outcome, out) = engine
                .convert(&bytes, &target, &options)
                .map_err(openpixel_core::OpenPixelError::from)?;
            let output = output.clone().unwrap_or_else(|| {
                let stem = input
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "out".into());
                input.with_file_name(format!("{stem}.{target}"))
            });
            write_pdf_bytes(&output, &out)?;
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&DocConvertSummary {
                        command: "doc-convert",
                        input: input.clone(),
                        output: output.clone(),
                        source: outcome.source.id().to_string(),
                        target: outcome.target.clone(),
                        engine: match outcome.engine {
                            openpixel_formats::ConversionEngine::LibreOffice => {
                                "libre_office".to_string()
                            }
                            openpixel_formats::ConversionEngine::PdfText => {
                                "pdf_text".to_string()
                            }
                        },
                        input_bytes: outcome.input_bytes,
                        output_bytes: outcome.output_bytes,
                        fidelity: outcome.fidelity.clone(),
                    })
                    .unwrap()
                );
            } else if !cli.quiet {
                println!(
                    "converted {} ({} bytes) -> {} ({} bytes) via {}",
                    input.display(),
                    outcome.input_bytes,
                    output.display(),
                    outcome.output_bytes,
                    match outcome.engine {
                        openpixel_formats::ConversionEngine::LibreOffice => "LibreOffice",
                        openpixel_formats::ConversionEngine::PdfText => "PDF text extraction",
                    }
                );
                println!("fidelity: {}", outcome.fidelity);
            }
            Ok(())
        }
        DocCommands::Formats => {
            let lo = openpixel_documents::LibreOffice::discover();
            if cli.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&openpixel_api_types()).unwrap()
                );
            } else {
                match &lo {
                    Some(lo) => match lo.version() {
                        Ok(v) => println!("LibreOffice: {v}"),
                        Err(e) => println!("LibreOffice: found, but --version failed: {e}"),
                    },
                    None => println!(
                        "LibreOffice: NOT INSTALLED — Office conversions need LibreOffice on this machine (see docs/PDF.md)"
                    ),
                }
                println!(
                    "PDF text extraction: {}",
                    if openpixel_pdf::pdfium_available() {
                        "available (PDFium)"
                    } else {
                        "NOT AVAILABLE — PDF -> TXT/HTML/EPUB/DOCX need --features pdfium (see docs/PDF.md)"
                    }
                );
                println!();
                println!(
                    "{:<8} {:<8} {:<13} {:<12} FIDELITY",
                    "SOURCE", "TARGET", "ENGINE", "RUNS WHERE"
                );
                for row in openpixel_formats::DOCUMENT_CONVERSIONS {
                    println!(
                        "{:<8} {:<8} {:<13} {:<12} {}",
                        row.source,
                        row.target,
                        match row.engine {
                            openpixel_formats::ConversionEngine::LibreOffice => "libre_office",
                            openpixel_formats::ConversionEngine::PdfText => "pdf_text",
                        },
                        match row.runs_where {
                            openpixel_formats::RunsWhere::CliDesktop => "cli/desktop",
                            openpixel_formats::RunsWhere::Browser => "browser",
                        },
                        row.fidelity
                    );
                }
                println!();
                println!("Conversions not listed here are NOT supported — e.g. PDF -> XLSX/PPTX (LibreOffice has no export filter for them).");
            }
            Ok(())
        }
    }
}

/// The `doc formats --json` payload: the conversion matrix plus
/// the local availability of the two engines that run it.
#[derive(Debug, serde::Serialize)]
struct DocFormatsJson {
    libreoffice: Option<String>,
    pdf_text_extraction: bool,
    conversions: Vec<openpixel_api::DocumentConversion>,
}

fn openpixel_api_types() -> DocFormatsJson {
    DocFormatsJson {
        libreoffice: openpixel_documents::LibreOffice::discover().and_then(|lo| lo.version().ok()),
        pdf_text_extraction: openpixel_pdf::pdfium_available(),
        conversions: openpixel_api::list_document_conversions(),
    }
}

/// Print one PDF command's result: text line, or the JSON summary.
fn print_pdf_op(
    cli: &Cli,
    pdf: &openpixel_pdf::PdfEngine,
    command: &'static str,
    output: &Path,
    out_bytes: &[u8],
) {
    if cli.json {
        let pages = pdf.page_count(out_bytes).unwrap_or(0);
        println!(
            "{}",
            serde_json::to_string_pretty(&PdfOpSummary {
                command,
                output: output.to_path_buf(),
                pages,
                bytes: out_bytes.len() as u64,
            })
            .unwrap()
        );
    } else if !cli.quiet {
        let pages = pdf.page_count(out_bytes).unwrap_or(0);
        println!(
            "wrote {} ({} pages, {} bytes)",
            output.display(),
            pages,
            out_bytes.len()
        );
    }
}

/// What a batch run reports, in both text and `--json` output.
#[derive(Debug, serde::Serialize)]
struct BatchSummary {
    converted: usize,
    failed: usize,
    workers: usize,
    out_dir: PathBuf,
    failures: Vec<BatchFailure>,
}

/// One file that did not convert, with the reason.
#[derive(Debug, serde::Serialize)]
struct BatchFailure {
    input: PathBuf,
    error: String,
}

/// Sorted image files in `input_dir`: unreadable files are reported
/// as failures (not crashes), files with an unknown signature are
/// skipped (not counted) — the Phase 1 rules, shared by both batch
/// paths so sequential and parallel agree on what counts.
fn collect_batch_inputs(
    cli: &Cli,
    input_dir: &Path,
) -> Result<(Vec<PathBuf>, Vec<BatchFailure>), openpixel_core::OpenPixelError> {
    let mut entries: Vec<_> = fs::read_dir(input_dir)
        .map_err(|e| openpixel_core::OpenPixelError::Io {
            path: input_dir.to_path_buf(),
            source: e,
        })?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    entries.sort();
    let mut inputs = Vec::new();
    let mut failures = Vec::new();
    for input in entries {
        // Size-gate BEFORE reading: the engine's 100 MiB limit is
        // enforced in `Engine::read_input`, but this function used to
        // `fs::read` every file first (to detect its format), so a
        // multi-gigabyte file in the batch directory was loaded into
        // memory whole and the limit never applied. Fixed in Phase 9:
        // oversize files are reported as failures, never read.
        if let Ok(meta) = fs::metadata(&input) {
            if meta.len() > openpixel_core::security::MAX_FILE_SIZE_BYTES {
                failures.push(BatchFailure {
                    input: input.clone(),
                    error: format!(
                        "file is {} bytes, over the {} byte input limit",
                        meta.len(),
                        openpixel_core::security::MAX_FILE_SIZE_BYTES
                    ),
                });
                continue;
            }
        }
        // Skip files we cannot even detect — report, don't crash the batch.
        let bytes = match fs::read(&input) {
            Ok(b) => b,
            Err(e) => {
                failures.push(BatchFailure {
                    input: input.clone(),
                    error: format!("could not read file: {e}"),
                });
                continue;
            }
        };
        if detect_format(&bytes) == ImageFormat::Unknown {
            if cli.verbose {
                println!("skip (unknown format): {}", input.display());
            }
            continue;
        }
        inputs.push(input);
    }
    Ok((inputs, failures))
}

/// Output path for one batch input, honouring the stem-collision
/// rule: `photo.jpg` + `photo.png` must not overwrite each other
/// (`photo.png` -> `photo-png.<target>`). `used` tracks outputs
/// already claimed in this run, so the rule holds even when the
/// output file does not exist on disk yet (parallel path).
fn batch_output_path(
    input: &Path,
    out_dir: &Path,
    target: ImageFormat,
    used: &mut HashSet<PathBuf>,
) -> PathBuf {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "out".into());
    let mut output = out_dir.join(format!("{stem}.{}", target.extensions()[0]));
    if output.exists() || used.contains(&output) {
        let src_ext = input
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_else(|| "img".into());
        output = out_dir.join(format!("{stem}-{src_ext}.{}", target.extensions()[0]));
    }
    used.insert(output.clone());
    output
}

/// The Phase 1 batch, unchanged in behaviour: one file at a time,
/// in sorted order. Kept as the fallback for `--workers 1` and
/// `--sequential`.
fn batch_sequential(
    cli: &Cli,
    engine: &Engine,
    input_dir: &Path,
    out_dir: &Path,
    target: ImageFormat,
    options: &ConvertOptions,
) -> Result<BatchSummary, openpixel_core::OpenPixelError> {
    let (inputs, mut failures) = collect_batch_inputs(cli, input_dir)?;
    let mut used: HashSet<PathBuf> = HashSet::new();
    let mut done = 0usize;
    for input in inputs {
        let output = batch_output_path(&input, out_dir, target, &mut used);
        match engine.convert(&input, &output, target, options) {
            Ok(r) => {
                done += 1;
                if cli.verbose {
                    println!(
                        "ok: {} -> {} ({} bytes)",
                        input.display(),
                        r.output_path,
                        r.output_bytes
                    );
                }
            }
            Err(e) => {
                eprintln!("failed: {}: {e}", input.display());
                failures.push(BatchFailure {
                    input: input.clone(),
                    error: e.to_string(),
                });
            }
        }
    }
    Ok(BatchSummary {
        converted: done,
        failed: failures.len(),
        workers: 1,
        out_dir: out_dir.to_path_buf(),
        failures,
    })
}

/// The Phase 6 batch: the same inputs and output rules, converted
/// through a bounded `JobManager` pool. A failed file is recorded
/// in its `JobResult` and never stops the batch.
fn batch_parallel(
    cli: &Cli,
    engine: &Arc<Engine>,
    input_dir: &Path,
    out_dir: &Path,
    target: ImageFormat,
    options: &ConvertOptions,
    workers: usize,
) -> Result<BatchSummary, openpixel_core::OpenPixelError> {
    let (inputs, mut failures) = collect_batch_inputs(cli, input_dir)?;
    let mut used: HashSet<PathBuf> = HashSet::new();
    let manager =
        JobManager::for_engine(JobManagerConfig::with_workers(workers), Arc::clone(engine))
            .map_err(|e| openpixel_core::OpenPixelError::InvalidArgument(e.to_string()))?;
    for input in inputs {
        let output = batch_output_path(&input, out_dir, target, &mut used);
        manager.submit(input, output, target, options.clone());
    }
    manager.wait_all();
    let mut done = 0usize;
    for result in manager.results() {
        match result.status {
            openpixel_jobs::JobStatus::Done => {
                done += 1;
                if cli.verbose {
                    println!(
                        "ok: {} -> {} ({} bytes)",
                        result.input.display(),
                        result.output.display(),
                        result.bytes
                    );
                }
            }
            openpixel_jobs::JobStatus::Failed => {
                let error = result
                    .error
                    .unwrap_or_else(|| "conversion failed".to_string());
                eprintln!("failed: {}: {error}", result.input.display());
                failures.push(BatchFailure {
                    input: result.input,
                    error,
                });
            }
            _ => {}
        }
    }
    Ok(BatchSummary {
        converted: done,
        failed: failures.len(),
        workers,
        out_dir: out_dir.to_path_buf(),
        failures,
    })
}

/// Resolve the metadata policy from the CLI flags: an explicit
/// `--metadata <policy>` wins; `--preserve-metadata` means
/// `preserve`; otherwise the policy is `None` (engine default =
/// strip). An unknown policy name is a clean error.
fn resolve_metadata_policy(
    preserve: bool,
    policy: Option<&str>,
) -> Result<Option<MetadataPolicy>, openpixel_core::OpenPixelError> {
    match policy {
        Some(name) => MetadataPolicy::from_name(name)
            .map(Some)
            .ok_or_else(|| {
                openpixel_core::OpenPixelError::InvalidArgument(format!(
                    "unknown metadata policy '{name}' — use preserve, strip, color-profiles, normalize-orientation, or selected:exif,icc,xmp,gps"
                ))
            }),
        None => {
            if preserve {
                Ok(Some(MetadataPolicy::Preserve))
            } else {
                Ok(None)
            }
        }
    }
}

fn print_warnings(cli: &Cli, result: &openpixel_core::ConvertResult) {
    if cli.quiet {
        return;
    }
    for w in &result.warnings {
        println!("warning: {w}");
    }
    if let Some(o) = &result.orientation_applied {
        println!("orientation: {o}");
    }
    if !result.metadata_preserved.is_empty() {
        println!(
            "metadata preserved: {}",
            result.metadata_preserved.join(", ")
        );
    }
    if !result.metadata_dropped.is_empty() {
        for d in &result.metadata_dropped {
            println!("metadata dropped: {d}");
        }
    }
}

fn print_convert_result(cli: &Cli, result: &openpixel_core::ConvertResult, verb: &str) {
    if cli.json {
        println!("{}", serde_json::to_string_pretty(&result).unwrap());
    } else if !cli.quiet {
        println!(
            "{verb} {} ({}x{}) -> {} : {} bytes -> {} bytes",
            result.source_format,
            result.width,
            result.height,
            result.target_format,
            result.input_bytes,
            result.output_bytes
        );
        println!("wrote {}", result.output_path);
        print_warnings(cli, result);
    }
}

fn yes(b: bool) -> &'static str {
    if b {
        "yes"
    } else {
        "no"
    }
}

/// Parse "800x600" into (800, 600).
fn parse_dimensions(s: &str) -> Result<(u32, u32), openpixel_core::OpenPixelError> {
    let err = || {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid size '{s}' — use WxH, e.g. 800x600"
        ))
    };
    let mut parts = s.split(['x', 'X']);
    let w = parts.next().ok_or_else(err)?;
    let h = parts.next().ok_or_else(err)?;
    if parts.next().is_some() {
        return Err(err());
    }
    let w: u32 = w.parse().map_err(|_| err())?;
    let h: u32 = h.parse().map_err(|_| err())?;
    Ok((w, h))
}

/// Parse a target file size: "200KB", "1.5MB", "2GB", "51200" (bytes),
/// "200 B". Units are binary (KB = 1024, MB = 1024^2, GB = 1024^3)
/// — the same units `formatBytes` reports in the web UI, so a size
/// the UI shows round-trips back through this flag. Decimals are
/// allowed with a unit ("1.5MB"); a bare number must be a whole
/// number of bytes. Anything else is a caller error.
fn parse_target_size(s: &str) -> Result<u64, openpixel_core::OpenPixelError> {
    let err = || {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid target size '{s}' — use e.g. 200KB, 1.5MB, or plain bytes"
        ))
    };
    let s = s.trim();
    if s.is_empty() {
        return Err(err());
    }
    let lower = s.to_ascii_lowercase();
    let (number, multiplier) = if let Some(n) = lower.strip_suffix("gb") {
        (n, 1024u64 * 1024 * 1024)
    } else if let Some(n) = lower.strip_suffix("mb") {
        (n, 1024u64 * 1024)
    } else if let Some(n) = lower.strip_suffix("kb") {
        (n, 1024u64)
    } else if let Some(n) = lower.strip_suffix('b') {
        (n, 1u64)
    } else {
        (lower.as_str(), 1u64)
    };
    let number = number.trim();
    let value: f64 = number.parse().map_err(|_| err())?;
    if !value.is_finite() || value <= 0.0 {
        return Err(err());
    }
    let bytes = (value * multiplier as f64).round() as u64;
    if bytes == 0 {
        return Err(err());
    }
    Ok(bytes)
}

/// Parse "10,20,400,300" into (x, y, width, height).
fn parse_crop(s: &str) -> Result<(u32, u32, u32, u32), openpixel_core::OpenPixelError> {
    let err = || {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid crop '{s}' — use X,Y,W,H, e.g. 10,20,400,300"
        ))
    };
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() != 4 {
        return Err(err());
    }
    let nums: Vec<u32> = parts
        .iter()
        .map(|p| p.trim().parse().map_err(|_| err()))
        .collect::<Result<_, _>>()?;
    Ok((nums[0], nums[1], nums[2], nums[3]))
}

fn parse_watermark_position(s: &str) -> Result<WatermarkPosition, openpixel_core::OpenPixelError> {
    WatermarkPosition::from_name(s).ok_or_else(|| {
        openpixel_core::OpenPixelError::InvalidArgument(format!(
            "invalid watermark position '{s}' — use top-left, top-right, bottom-left, bottom-right, or center"
        ))
    })
}

fn parse_f32(s: &str, what: &str) -> Result<f32, openpixel_core::OpenPixelError> {
    s.parse().map_err(|_| {
        openpixel_core::OpenPixelError::InvalidArgument(format!("invalid {what} '{s}'"))
    })
}

/// Parse one `--op SPEC` string into an operation. The watermark
/// operation is deliberately unavailable here — it needs an image
/// file, so it only exists as the `--watermark` flag.
fn parse_op_spec(s: &str) -> Result<Operation, openpixel_core::OpenPixelError> {
    let invalid = |msg: String| openpixel_core::OpenPixelError::InvalidArgument(msg);
    let (name, arg) = match s.split_once(':') {
        Some((n, a)) => (n, Some(a)),
        None => (s, None),
    };
    let need_arg = |what: &str| -> Result<&str, openpixel_core::OpenPixelError> {
        arg.ok_or_else(|| invalid(format!("--op {name} needs an argument, e.g. {what}")))
    };
    match name {
        "resize" => {
            let (w, h) = parse_dimensions(need_arg("resize:800x600")?)?;
            Ok(Operation::Resize {
                width: w,
                height: h,
            })
        }
        "resize-fit" | "resize_fit" => {
            let (w, h) = parse_dimensions(need_arg("resize-fit:800x600")?)?;
            Ok(Operation::ResizeFit {
                width: w,
                height: h,
            })
        }
        "resize-fill" | "resize_fill" => {
            let (w, h) = parse_dimensions(need_arg("resize-fill:800x600")?)?;
            Ok(Operation::ResizeFill {
                width: w,
                height: h,
            })
        }
        "pad" => {
            let a = need_arg("pad:800x600")?;
            let (dims, color) = match a.split_once(':') {
                Some((d, c)) => (d, parse_background(c)?),
                None => (a, [255, 255, 255]),
            };
            let (w, h) = parse_dimensions(dims)?;
            Ok(Operation::Pad {
                width: w,
                height: h,
                color,
            })
        }
        "crop" => {
            let (x, y, w, h) = parse_crop(need_arg("crop:10,20,400,300")?)?;
            Ok(Operation::Crop {
                x,
                y,
                width: w,
                height: h,
            })
        }
        "thumbnail" => {
            let a = need_arg("thumbnail:256")?;
            let m: u32 = a
                .parse()
                .map_err(|_| invalid(format!("invalid thumbnail '{a}'")))?;
            Ok(Operation::Thumbnail { max_dimension: m })
        }
        "rotate" => {
            let a = need_arg("rotate:90")?;
            let (deg_s, bg) = match a.split_once(':') {
                Some((d, c)) => (d, parse_background(c)?),
                None => (a, [255, 255, 255]),
            };
            let deg = parse_f32(deg_s, "rotate degrees")?;
            Ok(match deg {
                _ if deg == 90.0 => Operation::Rotate90,
                _ if deg == 180.0 => Operation::Rotate180,
                _ if deg == 270.0 => Operation::Rotate270,
                _ => Operation::RotateArbitrary {
                    degrees: deg,
                    background: bg,
                },
            })
        }
        "flip-h" | "flip-horizontal" => Ok(Operation::FlipHorizontal),
        "flip-v" | "flip-vertical" => Ok(Operation::FlipVertical),
        "grayscale" => Ok(Operation::Grayscale),
        "brightness" => Ok(Operation::Brightness {
            value: parse_f32(need_arg("brightness:0.2")?, "brightness")?,
        }),
        "contrast" => Ok(Operation::Contrast {
            value: parse_f32(need_arg("contrast:0.1")?, "contrast")?,
        }),
        "saturation" => Ok(Operation::Saturation {
            value: parse_f32(need_arg("saturation:1.5")?, "saturation")?,
        }),
        "blur" => Ok(Operation::Blur {
            sigma: parse_f32(need_arg("blur:2.0")?, "blur sigma")?,
        }),
        "sharpen" => {
            let a = need_arg("sharpen:1.0")?;
            let (sigma_s, threshold) = match a.split_once(':') {
                Some((s, t)) => (
                    s,
                    t.parse::<i32>().map_err(|_| {
                        invalid(format!("invalid sharpen threshold '{t}'"))
                    })?,
                ),
                None => (a, 0),
            };
            Ok(Operation::Sharpen {
                sigma: parse_f32(sigma_s, "sharpen sigma")?,
                threshold,
            })
        }
        "flatten" => {
            let bg = match arg {
                Some(c) => parse_background(c)?,
                None => [255, 255, 255],
            };
            Ok(Operation::Flatten { background: bg })
        }
        // Studio Phase 4: OCR preprocessing ops, exposed so a scan
        // can be cleaned before `pdf ocr` (which OCRs as given):
        // `openpixel process scan.png clean.png --op deskew --op denoise`.
        "threshold" => Ok(Operation::Threshold {
            threshold: need_arg("threshold:128")?
                .parse::<u8>()
                .map_err(|_| invalid(format!("invalid threshold '{}'", arg.unwrap())))?,
        }),
        "denoise" => Ok(Operation::Denoise),
        "deskew" => Ok(Operation::Deskew {
            max_angle: match arg {
                Some(a) => parse_f32(a, "deskew max angle")?,
                None => 5.0,
            },
        }),
        "watermark" => Err(invalid(
            "--op watermark is not supported (it needs an image file); use --watermark <file> instead".to_string(),
        )),
        other => Err(invalid(format!(
            "unknown --op '{other}' — see `openpixel process --help`"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dimensions_and_crop() {
        assert_eq!(parse_dimensions("800x600").unwrap(), (800, 600));
        assert_eq!(parse_dimensions("800X600").unwrap(), (800, 600));
        assert!(parse_dimensions("800").is_err());
        assert!(parse_dimensions("800x600x400").is_err());
        assert!(parse_dimensions("ax600").is_err());
        assert_eq!(parse_crop("10,20,400,300").unwrap(), (10, 20, 400, 300));
        assert!(parse_crop("10,20,400").is_err());
        assert!(parse_crop("10,20,400,300,5").is_err());
    }

    #[test]
    fn parses_op_specs_in_order() {
        let ops: Vec<Operation> = ["resize:800x600", "grayscale", "rotate:90", "flip-h"]
            .iter()
            .map(|s| parse_op_spec(s).unwrap())
            .collect();
        assert!(matches!(ops[0], Operation::Resize { .. }));
        assert!(matches!(ops[1], Operation::Grayscale));
        assert!(matches!(ops[2], Operation::Rotate90));
        assert!(matches!(ops[3], Operation::FlipHorizontal));
        assert!(matches!(
            parse_op_spec("rotate:45").unwrap(),
            Operation::RotateArbitrary { .. }
        ));
        assert!(matches!(
            parse_op_spec("blur:2.0").unwrap(),
            Operation::Blur { .. }
        ));
        assert!(matches!(
            parse_op_spec("sharpen:1.5:10").unwrap(),
            Operation::Sharpen { threshold: 10, .. }
        ));
        assert!(matches!(
            parse_op_spec("threshold:128").unwrap(),
            Operation::Threshold { threshold: 128 }
        ));
        assert!(matches!(
            parse_op_spec("denoise").unwrap(),
            Operation::Denoise
        ));
        assert!(matches!(
            parse_op_spec("deskew").unwrap(),
            Operation::Deskew { max_angle } if max_angle == 5.0
        ));
        assert!(matches!(
            parse_op_spec("deskew:10").unwrap(),
            Operation::Deskew { max_angle } if max_angle == 10.0
        ));
        assert!(matches!(
            parse_op_spec("flatten:#ff0000").unwrap(),
            Operation::Flatten { .. }
        ));
        assert!(parse_op_spec("watermark:logo.png").is_err());
        assert!(parse_op_spec("frobnicate:1").is_err());
        assert!(parse_op_spec("resize").is_err());
    }

    #[test]
    fn parses_watermark_positions() {
        assert_eq!(
            parse_watermark_position("top-left").unwrap(),
            WatermarkPosition::TopLeft
        );
        assert_eq!(
            parse_watermark_position("CENTER").unwrap(),
            WatermarkPosition::Center
        );
        assert!(parse_watermark_position("middle").is_err());
    }

    /// Phase 9: batch collection must not `fs::read` a file over
    /// the 100 MiB input limit just to detect its format — it is
    /// reported as a failure without being read.
    #[test]
    fn batch_collection_skips_oversize_files_without_reading() {
        let dir = tempfile::tempdir().unwrap();
        // One small real PNG (detectable).
        let small = dir.path().join("small.png");
        image::RgbaImage::new(4, 4).save(&small).unwrap();
        // One sparse file over the limit (set_len: no 101 MiB write).
        let big_path = dir.path().join("big.png");
        let big = std::fs::File::create(&big_path).unwrap();
        big.set_len(openpixel_core::security::MAX_FILE_SIZE_BYTES + 1)
            .unwrap();
        drop(big);
        let cli = Cli {
            json: false,
            quiet: false,
            verbose: false,
            command: Commands::Info {
                input: PathBuf::new(),
            },
        };
        let (inputs, failures) = collect_batch_inputs(&cli, dir.path()).unwrap();
        assert_eq!(inputs, vec![small]);
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].input, big_path);
        assert!(
            failures[0].error.contains("over the"),
            "error: {}",
            failures[0].error
        );
        // The sparse file was never read or rewritten.
        assert_eq!(
            std::fs::metadata(&big_path).unwrap().len(),
            openpixel_core::security::MAX_FILE_SIZE_BYTES + 1
        );
    }
}

#[cfg(test)]
mod phase5_tests {
    use super::*;

    #[test]
    fn resolves_metadata_policy_flags() {
        assert_eq!(resolve_metadata_policy(false, None).unwrap(), None);
        assert_eq!(
            resolve_metadata_policy(true, None).unwrap(),
            Some(MetadataPolicy::Preserve)
        );
        assert_eq!(
            resolve_metadata_policy(false, Some("strip")).unwrap(),
            Some(MetadataPolicy::Strip)
        );
        assert_eq!(
            resolve_metadata_policy(false, Some("normalize-orientation")).unwrap(),
            Some(MetadataPolicy::NormalizeOrientation)
        );
        assert_eq!(
            resolve_metadata_policy(true, Some("selected:icc")).unwrap(),
            Some(MetadataPolicy::PreserveSelected {
                fields: vec![openpixel_core::MetadataField::Icc]
            })
        );
        // An explicit --metadata wins over --preserve-metadata.
        assert_eq!(
            resolve_metadata_policy(true, Some("strip")).unwrap(),
            Some(MetadataPolicy::Strip)
        );
        assert!(resolve_metadata_policy(false, Some("bogus")).is_err());
    }
}
