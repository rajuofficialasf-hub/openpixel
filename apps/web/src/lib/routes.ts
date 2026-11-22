/**
 * Route model + honest tool registry for the Studio shell.
 *
 * One source of truth for navigation (sidebar, header search,
 * homepage, All Tools directory). A tool is listed ONLY if it is
 * real: `web` tools navigate to a working workspace, `cli-only`
 * tools name the exact CLI command, `coming-soon` tools are
 * clearly labelled and never look clickable. See
 * docs/DESIGN_NOTES.md §10 for the inventory this is built from.
 */

export type RouteId =
  | 'home'
  | 'overview'
  | 'tools'
  | 'convert'
  | 'resize'
  | 'pdf'
  | 'pdf-merge'
  | 'pdf-split'
  | 'pdf-rotate'
  | 'pdf-extract'
  | 'pdf-remove'
  | 'pdf-reorder'
  | 'pdf-duplicate'
  | 'pdf-reverse'
  | 'pdf-booklet'
  | 'pdf-nup'
  | 'pdf-compress'
  | 'pdf-edit'
  | 'pdf-redact'
  | 'pdf-metadata'
  | 'pdf-sanitize'
  | 'pdf-flatten'
  | 'pdf-repair'
  | 'pdf-to-image'
  | 'pdf-images-to-pdf'
  | 'pdf-extract-text'
  | 'ocr'
  | 'batch'
  | 'formats'
  | 'files'
  | 'recent'
  | 'settings'
  | 'help'

/**
 * Clean history-API URLs — one shareable link per page, no router
 * dependency. The app reads the path on load, `navigate()` pushes
 * the new path, and the browser back/forward buttons change the
 * route via popstate. Cloudflare Pages serves index.html for every
 * path (public/_redirects), so deep links load directly.
 */
export const ROUTE_PATHS: Record<RouteId, string> = {
  home: '/',
  overview: '/overview',
  tools: '/tools',
  convert: '/convert',
  resize: '/resize',
  pdf: '/pdf',
  'pdf-merge': '/pdf/merge',
  'pdf-split': '/pdf/split',
  'pdf-rotate': '/pdf/rotate',
  'pdf-extract': '/pdf/extract',
  'pdf-remove': '/pdf/remove',
  'pdf-reorder': '/pdf/reorder',
  'pdf-duplicate': '/pdf/duplicate',
  'pdf-reverse': '/pdf/reverse',
  'pdf-booklet': '/pdf/booklet',
  'pdf-nup': '/pdf/n-up',
  'pdf-compress': '/pdf/compress',
  'pdf-edit': '/pdf/edit',
  'pdf-redact': '/pdf/redact',
  'pdf-metadata': '/pdf/metadata',
  'pdf-sanitize': '/pdf/sanitize',
  'pdf-flatten': '/pdf/flatten',
  'pdf-repair': '/pdf/repair',
  'pdf-to-image': '/pdf/pdf-to-image',
  'pdf-images-to-pdf': '/pdf/images-to-pdf',
  'pdf-extract-text': '/pdf/extract-text',
  ocr: '/ocr',
  batch: '/batch',
  formats: '/formats',
  files: '/files',
  recent: '/recent',
  settings: '/settings',
  help: '/help',
}

/**
 * Map a URL pathname to a route. Unknown paths fall back to home —
 * except unknown /pdf/* paths, which fall back to the PDF tools
 * picker (the user was clearly looking for a PDF tool).
 */
export function routeFromPath(pathname: string): RouteId {
  const clean = pathname.replace(/\/+$/, '') || '/'
  for (const [id, path] of Object.entries(ROUTE_PATHS) as [RouteId, string][]) {
    if (path === clean) return id
  }
  if (clean === '/pdf' || clean.startsWith('/pdf/')) return 'pdf'
  return 'home'
}

export type ToolCategory =
  | 'image'
  | 'pdf'
  | 'document'
  | 'ocr'
  | 'conversion'
  | 'compression'
  | 'media'

export const CATEGORIES: { id: ToolCategory; label: string; blurb: string }[] = [
  { id: 'image', label: 'Images', blurb: 'Convert, resize, compress and inspect images.' },
  { id: 'pdf', label: 'PDFs', blurb: 'Merge, split, compress, edit and secure PDFs.' },
  { id: 'document', label: 'Documents', blurb: 'Office and text documents, to and from PDF.' },
  { id: 'ocr', label: 'OCR', blurb: 'Read text out of images and scanned pages.' },
  { id: 'conversion', label: 'Conversion', blurb: 'Change files from one format to another.' },
  { id: 'compression', label: 'Compression', blurb: 'Make files smaller without losing what matters.' },
  { id: 'media', label: 'Media', blurb: 'Audio and video — not built yet.' },
]

export type ToolStatus = 'web' | 'cli-only' | 'coming-soon'

export interface ToolEntry {
  id: string
  name: string
  description: string
  categories: ToolCategory[]
  status: ToolStatus
  /** Web tools: the route they open. */
  route?: RouteId
  /** CLI-only tools: the exact command to run. */
  cliCommand?: string
  keywords: string[]
  popular?: boolean
  /**
   * Signature format chip, shown on the tool card when the tool
   * has a natural format pair (e.g. "PNG → WebP"). Quiet mono
   * text, not a status pill — tools without a pair show nothing.
   */
  formatChip?: string
}

export const TOOLS: ToolEntry[] = [
  // ---- Image (web) ----
  {
    id: 'convert',
    name: 'Convert Image',
    description:
      'Convert between PNG, JPEG, WebP, BMP, TIFF, QOI, HEIC, JXL, JPEG 2000, ICO, PNM, TGA and GIF — in your browser.',
    categories: ['image', 'conversion'],
    status: 'web',
    route: 'convert',
    keywords: ['convert', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'format', 'image'],
    popular: true,
    formatChip: 'PNG → WebP',
  },
  {
    id: 'resize',
    name: 'Resize Image',
    description:
      'Fit, fill, pad or exact-size resize with presets, aspect lock and never-upscale. Before/after preview included.',
    categories: ['image'],
    status: 'web',
    route: 'resize',
    keywords: ['resize', 'scale', 'dimensions', 'width', 'height', 'shrink', 'image'],
    popular: true,
  },
  {
    id: 'compress-image',
    name: 'Image Compressor',
    description:
      'Compress an image to an exact file size with target-size mode, or pick a quality level. Batch + zip included.',
    categories: ['image', 'compression'],
    status: 'web',
    route: 'resize',
    keywords: ['compress', 'smaller', 'size', 'quality', 'optimize', 'image'],
    popular: true,
  },
  {
    id: 'batch',
    name: 'Batch Convert',
    description: 'Convert a whole folder of images at once — up to 4 files in parallel, with a zip of the results.',
    categories: ['image', 'conversion'],
    status: 'web',
    route: 'batch',
    keywords: ['batch', 'bulk', 'folder', 'many', 'zip', 'image'],
    popular: true,
    formatChip: 'PNG → WebP',
  },
  {
    id: 'metadata',
    name: 'Image Metadata',
    description: 'View format, dimensions, colour, alpha, EXIF, ICC and XMP info for any image.',
    categories: ['image'],
    status: 'web',
    route: 'convert',
    keywords: ['metadata', 'exif', 'icc', 'xmp', 'info', 'details', 'image'],
  },
  // ---- Image (CLI-only / coming soon) ----
  {
    id: 'crop',
    name: 'Crop Image',
    description: 'Crop an image to an exact rectangle. Runs in the CLI — the web crop tool is not built yet.',
    categories: ['image'],
    status: 'cli-only',
    cliCommand: 'openpixel process input.png output.png --op crop:0,0,100,100',
    keywords: ['crop', 'cut', 'trim', 'image'],
  },
  {
    id: 'rotate',
    name: 'Rotate & Flip Image',
    description: 'Rotate 90/180/270° or flip horizontally/vertically. Runs in the CLI.',
    categories: ['image'],
    status: 'cli-only',
    cliCommand: 'openpixel process input.png output.png --rotate 90',
    keywords: ['rotate', 'flip', 'mirror', 'orientation', 'image'],
  },
  {
    id: 'bg-remove',
    name: 'Background Removal',
    description: 'Remove the background from a photo. Not built yet — in any version.',
    categories: ['image'],
    status: 'coming-soon',
    keywords: ['background', 'remove', 'transparent', 'cutout', 'image'],
  },
  // ---- PDF (web) — one tool, one page, one route each.
  // The old "Organize PDF Pages" grouping is gone: rotate,
  // extract, remove, reorder, duplicate, reverse, booklet and
  // N-up are separate tools with separate pages, exactly as the
  // user asked (select the tool first, then see its page).
  {
    id: 'pdf-merge',
    name: 'Merge PDF',
    description: 'Combine several PDFs into one, in the order you choose.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-merge',
    keywords: ['merge', 'combine', 'join', 'pdf'],
    popular: true,
  },
  {
    id: 'pdf-split',
    name: 'Split PDF',
    description: 'Split a PDF into separate files by page ranges — one document per range.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-split',
    keywords: ['split', 'separate', 'pages', 'pdf'],
  },
  {
    id: 'pdf-rotate',
    name: 'Rotate PDF Pages',
    description: 'Rotate pages 90°, 180° or 270° — all pages, or just the ones you pick.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-rotate',
    keywords: ['rotate', 'pages', 'orientation', 'pdf'],
  },
  {
    id: 'pdf-extract',
    name: 'Extract PDF Pages',
    description: 'Pull pages out of a PDF into a new document.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-extract',
    keywords: ['extract', 'pages', 'pull out', 'pdf'],
  },
  {
    id: 'pdf-remove',
    name: 'Remove PDF Pages',
    description: 'Delete pages from a PDF — the rest stays exactly as it was.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-remove',
    keywords: ['remove', 'delete', 'pages', 'pdf'],
  },
  {
    id: 'pdf-reorder',
    name: 'Reorder PDF Pages',
    description: 'Put the pages in a new order — list every page exactly once.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-reorder',
    keywords: ['reorder', 'pages', 'order', 'arrange', 'pdf'],
  },
  {
    id: 'pdf-duplicate',
    name: 'Duplicate PDF Pages',
    description: 'Copy pages inside a PDF — the copies go right after the originals.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-duplicate',
    keywords: ['duplicate', 'copy', 'pages', 'pdf'],
  },
  {
    id: 'pdf-reverse',
    name: 'Reverse PDF Pages',
    description: 'Flip the page order — last page first.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-reverse',
    keywords: ['reverse', 'flip', 'pages', 'order', 'pdf'],
  },
  {
    id: 'pdf-booklet',
    name: 'Booklet Layout',
    description: 'Reorder pages into a booklet layout, ready to print and fold.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-booklet',
    keywords: ['booklet', 'print', 'fold', 'pages', 'pdf'],
  },
  {
    id: 'pdf-nup',
    name: 'N-up Layout',
    description: 'Put several pages on one sheet — pick the columns and rows.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-nup',
    keywords: ['n-up', 'layout', 'grid', 'pages', 'pdf'],
  },
  {
    id: 'pdf-compress',
    name: 'Compress PDF',
    description: 'Shrink a PDF — screen, ebook or printer quality. Images are downsampled and re-encoded.',
    categories: ['pdf', 'compression'],
    status: 'web',
    route: 'pdf-compress',
    keywords: ['compress', 'smaller', 'size', 'optimize', 'pdf'],
    popular: true,
  },
  {
    id: 'pdf-edit',
    name: 'Edit PDF',
    description: 'Add text, highlights, page numbers and headers to a PDF.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-edit',
    keywords: ['edit', 'annotate', 'text', 'overlay', 'pdf'],
  },
  {
    id: 'pdf-redact',
    name: 'Redact PDF',
    description: 'Permanently remove text from a PDF — deleted from the file, not covered up.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-redact',
    keywords: ['redact', 'remove', 'black out', 'sensitive', 'pdf'],
  },
  {
    id: 'pdf-metadata',
    name: 'PDF Metadata',
    description: 'Edit a PDF’s title, author, subject and keywords.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-metadata',
    keywords: ['metadata', 'title', 'author', 'info', 'pdf'],
  },
  {
    id: 'pdf-sanitize',
    name: 'Clean up PDF',
    description: 'Check a PDF for JavaScript, embedded files and launch actions — then strip them out.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-sanitize',
    keywords: ['sanitize', 'clean', 'safe', 'threat', 'javascript', 'pdf'],
  },
  {
    id: 'pdf-flatten',
    name: 'Flatten PDF',
    description: 'Flatten annotations into the page content and remove form fields.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-flatten',
    keywords: ['flatten', 'annotations', 'forms', 'pdf'],
  },
  {
    id: 'pdf-repair',
    name: 'Repair PDF',
    description: 'Rebuild the cross-reference table of a damaged PDF so it opens again.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf-repair',
    keywords: ['repair', 'fix', 'damaged', 'corrupt', 'pdf'],
  },
  {
    id: 'pdf-to-image',
    name: 'PDF to Image',
    description: 'Render PDF pages to PNG or JPEG and download them.',
    categories: ['pdf', 'conversion'],
    status: 'web',
    route: 'pdf-to-image',
    keywords: ['pdf', 'image', 'png', 'jpeg', 'render', 'page'],
    popular: true,
    formatChip: 'PDF → PNG',
  },
  {
    id: 'image-to-pdf',
    name: 'Image to PDF',
    description: 'Turn one or more images into a PDF document.',
    categories: ['pdf', 'conversion'],
    status: 'web',
    route: 'pdf-images-to-pdf',
    keywords: ['image', 'pdf', 'create', 'photo'],
    popular: true,
    formatChip: 'PNG → PDF',
  },
  {
    id: 'pdf-text',
    name: 'Extract PDF Text',
    description: 'Read the text out of a PDF — shown on the page and downloadable as TXT. EPUB/DOCX export runs in the CLI.',
    categories: ['pdf', 'conversion'],
    status: 'web',
    route: 'pdf-extract-text',
    keywords: ['extract', 'text', 'copy', 'content', 'pdf'],
    formatChip: 'PDF → TXT',
  },
  // ---- PDF (CLI-only / coming soon) ----
  {
    id: 'pdf-ocr',
    name: 'OCR PDF',
    description: 'Turn a scanned PDF into a searchable PDF with a real text layer. Runs in the CLI.',
    categories: ['pdf', 'ocr'],
    status: 'cli-only',
    cliCommand: 'openpixel pdf ocr input.pdf output.pdf',
    keywords: ['ocr', 'searchable', 'scanned', 'text', 'pdf'],
  },
  {
    id: 'pdf-protect',
    name: 'Protect PDF',
    description: 'Password-protect a PDF (RC4-128) with print/copy/modify permissions. Runs in the CLI.',
    categories: ['pdf'],
    status: 'cli-only',
    cliCommand: 'openpixel pdf protect --user-password <password> input.pdf output.pdf',
    keywords: ['protect', 'password', 'encrypt', 'lock', 'pdf'],
  },
  {
    id: 'pdf-unlock',
    name: 'Unlock PDF',
    description: 'Remove the password from a PDF you own. Runs in the CLI.',
    categories: ['pdf'],
    status: 'cli-only',
    cliCommand: 'openpixel pdf unlock --password <password> input.pdf output.pdf',
    keywords: ['unlock', 'password', 'decrypt', 'pdf'],
  },
  {
    id: 'pdf-watermark',
    name: 'Add Watermark',
    description: 'Add a diagonal text watermark to every page. Runs in the CLI.',
    categories: ['pdf'],
    status: 'cli-only',
    cliCommand: 'openpixel pdf watermark --text <text> input.pdf output.pdf',
    keywords: ['watermark', 'stamp', 'text', 'pdf'],
  },
  {
    id: 'pdf-sign',
    name: 'Sign PDF',
    description: 'Add a real CMS/PKCS#7 digital signature (RSA, SHA-256). Runs in the CLI — a private key must never enter the browser.',
    categories: ['pdf'],
    status: 'cli-only',
    cliCommand: 'openpixel pdf sign --key <key.pem> --cert <cert.pem> input.pdf output.pdf',
    keywords: ['sign', 'signature', 'certificate', 'digital', 'pdf'],
  },
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    description:
      'One-click DOCX export on the web is not built yet. Text extraction (TXT/HTML) works in the PDF workspace; full DOCX export runs in the CLI.',
    categories: ['pdf', 'conversion', 'document'],
    status: 'coming-soon',
    keywords: ['word', 'docx', 'convert', 'pdf'],
  },
  // ---- Document (CLI-only / coming soon) ----
  {
    id: 'docx-to-pdf',
    name: 'DOCX to PDF',
    description: 'Convert a Word document to PDF with LibreOffice. Runs in the CLI / desktop app.',
    categories: ['document', 'conversion'],
    status: 'cli-only',
    cliCommand: 'openpixel doc convert --to pdf input.docx',
    keywords: ['docx', 'word', 'pdf', 'document'],
  },
  {
    id: 'pdf-to-docx',
    name: 'PDF to DOCX',
    description: 'Convert a PDF to a Word document (text only — layout is not preserved). Runs in the CLI.',
    categories: ['document', 'conversion'],
    status: 'cli-only',
    cliCommand: 'openpixel doc convert --to docx input.pdf',
    keywords: ['pdf', 'docx', 'word', 'document'],
  },
  {
    id: 'txt-to-pdf',
    name: 'TXT to PDF',
    description: 'Convert a plain-text file to PDF. Runs in the CLI / desktop app.',
    categories: ['document', 'conversion'],
    status: 'cli-only',
    cliCommand: 'openpixel doc convert --to pdf input.txt',
    keywords: ['txt', 'text', 'pdf', 'document'],
  },
  {
    id: 'html-to-pdf',
    name: 'HTML to PDF',
    description: 'Convert an HTML file to PDF. Runs in the CLI / desktop app.',
    categories: ['document', 'conversion'],
    status: 'cli-only',
    cliCommand: 'openpixel doc convert --to pdf input.html',
    keywords: ['html', 'web', 'pdf', 'document'],
  },
  {
    id: 'md-to-pdf',
    name: 'Markdown to PDF',
    description: 'Convert a Markdown file to PDF. Runs in the CLI / desktop app.',
    categories: ['document', 'conversion'],
    status: 'cli-only',
    cliCommand: 'openpixel doc convert --to pdf input.md',
    keywords: ['markdown', 'md', 'pdf', 'document'],
  },
  {
    id: 'doc-text',
    name: 'Document Text Extraction',
    description: 'Extract the plain text of an Office or text document. Runs in the CLI.',
    categories: ['document'],
    status: 'cli-only',
    cliCommand: 'openpixel doc convert --to txt input.docx',
    keywords: ['extract', 'text', 'docx', 'document'],
  },
  {
    id: 'doc-viewer',
    name: 'Document Viewer',
    description: 'Preview Office documents in the browser. Not built yet.',
    categories: ['document'],
    status: 'coming-soon',
    keywords: ['view', 'preview', 'docx', 'document'],
  },
  // ---- OCR (web) ----
  {
    id: 'ocr',
    name: 'Image OCR',
    description: 'Read the text out of an image — English and Bengali, right in your browser.',
    categories: ['ocr'],
    status: 'web',
    route: 'ocr',
    keywords: ['ocr', 'text', 'read', 'scan', 'extract'],
    popular: true,
    formatChip: 'PNG → TXT',
  },
  {
    id: 'ocr-bengali',
    name: 'Bengali OCR',
    description: 'Read Bengali text out of an image. Choose Bengali in the OCR workspace.',
    categories: ['ocr'],
    status: 'web',
    route: 'ocr',
    keywords: ['bengali', 'bangla', 'ocr', 'text'],
  },
  {
    id: 'ocr-table',
    name: 'Table Extraction',
    description: 'Extract tables from images and scanned pages as structured data. Not built yet.',
    categories: ['ocr'],
    status: 'coming-soon',
    keywords: ['table', 'spreadsheet', 'rows', 'columns', 'ocr'],
  },
  // ---- Media (coming soon) ----
  {
    id: 'audio-convert',
    name: 'Audio Conversion',
    description: 'Convert audio files between formats. Not built yet.',
    categories: ['media', 'conversion'],
    status: 'coming-soon',
    keywords: ['audio', 'mp3', 'wav', 'sound', 'music'],
  },
  {
    id: 'video-convert',
    name: 'Video Conversion',
    description: 'Convert video files between formats. Not built yet.',
    categories: ['media', 'conversion'],
    status: 'coming-soon',
    keywords: ['video', 'mp4', 'movie', 'clip'],
  },
  {
    id: 'media-metadata',
    name: 'Media Metadata',
    description: 'Read audio and video metadata. Not built yet.',
    categories: ['media'],
    status: 'coming-soon',
    keywords: ['metadata', 'audio', 'video', 'info'],
  },
]


/**
 * Bengali tool descriptions (Nov 2026 policy change — see
 * `lib/i18n.ts`): descriptions are user-facing prose and are
 * translated, like the rest of the chrome. Tool NAMES stay
 * English. `toolDescription()` is the single lookup — cards
 * never read `description` directly when a language is known.
 * A missing entry falls back to the English description.
 */
export const TOOL_DESCRIPTIONS_BN: Record<string, string> = {
  convert: 'PNG, JPEG, WebP, BMP, TIFF, QOI, HEIC, JXL, JPEG 2000, ICO, PNM, TGA আর GIF-এর মধ্যে কনভার্ট করুন — আপনার ব্রাউজারেই।',
  resize: 'Fit, fill, pad বা ঠিক মাপে Resize করুন — প্রিসেট, অনুপাতের তালা আর কখনো বড় না করার সুরক্ষাসহ। আগে/পরে প্রিভিউ আছে।',
  'compress-image': 'লক্ষ্য সাইজ মোড দিয়ে ছবি ঠিক ফাইল সাইজে কমপ্রেস করুন, অথবা quality বেছে নিন। ব্যাচ + zip আছে।',
  batch: 'ছবির পুরো ফোল্ডার একসাথে কনভার্ট করুন — একসাথে সর্বোচ্চ ৪টি ফাইল, ফলাফলের zip-সহ।',
  metadata: 'যেকোনো ছবির ফরম্যাট, মাপ, রং, alpha, EXIF, ICC আর XMP তথ্য দেখুন।',
  crop: 'ছবি ঠিক আয়তক্ষেত্রে কেটে নিন। CLI-তে চলে — ওয়েবে ক্রপ টুল এখনো তৈরি হয়নি।',
  rotate: '৯০/১৮০/২৭০° ঘোরান বা অনুভূমিক/উল্লম্বভাবে উল্টান। CLI-তে চলে।',
  'bg-remove': 'ছবি থেকে ব্যাকগ্রাউন্ড সরান। এখনো তৈরি হয়নি — কোনো সংস্করণেই নয়।',
  'pdf-merge': 'একাধিক PDF একত্রে একটি করুন, আপনার বেছে নেওয়া ক্রমে।',
  'pdf-split': 'পেজের রেঞ্জ দিয়ে PDF ভাগ করুন — প্রতিটি রেঞ্জের জন্য একটি করে ডকুমেন্ট।',
  'pdf-rotate': 'পৃষ্ঠা ৯০°, ১৮০° বা ২৭০° ঘোরান — সব পৃষ্ঠা, অথবা শুধু বেছে নেওয়াগুলো।',
  'pdf-extract': 'PDF থেকে পৃষ্ঠা বের করে নতুন ডকুমেন্ট করুন।',
  'pdf-remove': 'PDF থেকে পৃষ্ঠা মুছে ফেলুন — বাকিগুলো ঠিক আগের মতোই থাকে।',
  'pdf-reorder': 'পৃষ্ঠাগুলো নতুন ক্রমে সাজান — প্রতিটি পৃষ্ঠা ঠিক একবার করে লিখুন।',
  'pdf-duplicate': 'PDF-এর ভেতরে পৃষ্ঠা কপি করুন — কপিগুলো আসলটির ঠিক পরেই যায়।',
  'pdf-reverse': 'পৃষ্ঠার ক্রম উল্টে দিন — শেষ পৃষ্ঠা প্রথমে।',
  'pdf-booklet': 'পৃষ্ঠাগুলো বুকলেট আকারে সাজান, ছাপিয়ে ভাঁজ করার জন্য প্রস্তুত।',
  'pdf-nup': 'এক পাতায় একাধিক পৃষ্ঠা রাখুন — কলাম আর সারি বেছে নিন।',
  'pdf-compress': 'PDF ছোট করুন — স্ক্রিন, ইবুক বা প্রিন্টার quality। ছবি ছোট করে আবার এনকোড করা হয়।',
  'pdf-edit': 'PDF-এ লেখা, হাইলাইট, পৃষ্ঠা নম্বর আর হেডার যোগ করুন।',
  'pdf-redact': 'PDF থেকে লেখা স্থায়ীভাবে মুছে ফেলুন — ফাইল থেকে মুছে যায়, ঢেকে দেওয়া হয় না।',
  'pdf-metadata': 'PDF-এর শিরোনাম, লেখক, বিষয় আর কীওয়ার্ড বদলান।',
  'pdf-sanitize': 'PDF-এ JavaScript, এমবেড করা ফাইল আর লঞ্চ অ্যাকশন আছে কি না দেখুন — তারপর সেগুলো সরিয়ে ফেলুন।',
  'pdf-flatten': 'অ্যানোটেশনগুলো পেজের ভেতরে বসিয়ে দিন আর ফর্ম ফিল্ড সরান।',
  'pdf-repair': 'নষ্ট PDF-এর ক্রস-রেফারেন্স টেবিল আবার তৈরি করুন, যাতে সেটি আবার খোলে।',
  'pdf-to-image': 'PDF-এর পৃষ্ঠাগুলো PNG বা JPEG হিসেবে রেন্ডার করে ডাউনলোড করুন।',
  'image-to-pdf': 'এক বা একাধিক ছবি থেকে PDF ডকুমেন্ট বানান।',
  'pdf-text': 'PDF থেকে লেখা পড়ুন — পেজে দেখানো হয় আর TXT হিসেবে ডাউনলোড করা যায়। EPUB/DOCX এক্সপোর্ট CLI-তে চলে।',
  'pdf-ocr': 'স্ক্যান করা PDF থেকে খোঁজার মতো PDF বানান, আসল টেক্সট লেয়ারসহ। CLI-তে চলে।',
  'pdf-protect': 'PDF পাসওয়ার্ড দিয়ে সুরক্ষিত করুন (RC4-128), প্রিন্ট/কপি/বদলানোর অনুমতিসহ। CLI-তে চলে।',
  'pdf-unlock': 'আপনার মালিকানাধীন PDF থেকে পাসওয়ার্ড সরান। CLI-তে চলে।',
  'pdf-watermark': 'প্রতিটি পেজে তির্যক লেখার ওয়াটারমার্ক যোগ করুন। CLI-তে চলে।',
  'pdf-sign': 'আসল CMS/PKCS#7 ডিজিটাল স্বাক্ষর যোগ করুন (RSA, SHA-256)। CLI-তে চলে — প্রাইভেট কি কখনো ব্রাউজারে আসবে না।',
  'pdf-to-word': 'ওয়েবে এক ক্লিকে DOCX এক্সপোর্ট এখনো তৈরি হয়নি। টেক্সট নিষ্কাশন (TXT/HTML) PDF ওয়ার্কস্পেসে চলে; সম্পূর্ণ DOCX এক্সপোর্ট CLI-তে চলে।',
  'docx-to-pdf': 'LibreOffice দিয়ে Word ডকুমেন্ট PDF-এ কনভার্ট করুন। CLI / ডেস্কটপ অ্যাপে চলে।',
  'pdf-to-docx': 'PDF Word ডকুমেন্টে কনভার্ট করুন (শুধু লেখা — লেআউট থাকে না)। CLI-তে চলে।',
  'txt-to-pdf': 'সাধারণ টেক্সট ফাইল PDF-এ কনভার্ট করুন। CLI / ডেস্কটপ অ্যাপে চলে।',
  'html-to-pdf': 'HTML ফাইল PDF-এ কনভার্ট করুন। CLI / ডেস্কটপ অ্যাপে চলে।',
  'md-to-pdf': 'Markdown ফাইল PDF-এ কনভার্ট করুন। CLI / ডেস্কটপ অ্যাপে চলে।',
  'doc-text': 'Office বা টেক্সট ডকুমেন্টের সাধারণ লেখা বের করুন। CLI-তে চলে।',
  'doc-viewer': 'ব্রাউজারে Office ডকুমেন্টের প্রিভিউ দেখুন। এখনো তৈরি হয়নি।',
  ocr: 'ছবি থেকে লেখা পড়ুন — ইংরেজি আর বাংলা, আপনার ব্রাউজারেই।',
  'ocr-bengali': 'ছবি থেকে বাংলা লেখা পড়ুন। OCR ওয়ার্কস্পেসে বাংলা বেছে নিন।',
  'ocr-table': 'ছবি আর স্ক্যান করা পেজ থেকে টেবিল বের করুন, গঠনবদ্ধ ডেটা হিসেবে। এখনো তৈরি হয়নি।',
  'audio-convert': 'অডিও ফাইল এক ফরম্যাট থেকে আরেক ফরম্যাটে কনভার্ট করুন। এখনো তৈরি হয়নি।',
  'video-convert': 'ভিডিও ফাইল এক ফরম্যাট থেকে আরেক ফরম্যাটে কনভার্ট করুন। এখনো তৈরি হয়নি।',
  'media-metadata': 'অডিও আর ভিডিওর মেটাডেটা পড়ুন। এখনো তৈরি হয়নি।',
}

/** The description to show for a tool in the given language. */
export function toolDescription(lang: 'en' | 'bn', tool: ToolEntry): string {
  return lang === 'bn' ? (TOOL_DESCRIPTIONS_BN[tool.id] ?? tool.description) : tool.description
}

export const POPULAR_TOOLS = TOOLS.filter((t) => t.popular)

/** Sidebar groups (prompt §8) — only destinations that exist. */
export interface NavItem {
  route: RouteId
  label: string
  icon: string
  /** Kept for the e2e suite: tool nav items carry the old tab ids. */
  tabId?: string
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { route: 'overview', label: 'Overview', icon: 'home' },
      { route: 'files', label: 'My Files', icon: 'folder' },
      { route: 'recent', label: 'Recent Files', icon: 'history' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { route: 'tools', label: 'All Tools', icon: 'grid', tabId: 'tab-tools' },
      { route: 'convert', label: 'Convert Image', icon: 'image', tabId: 'tab-convert' },
      { route: 'resize', label: 'Resize Image', icon: 'resize', tabId: 'tab-resize' },
      { route: 'pdf', label: 'PDF Tools', icon: 'pdf', tabId: 'tab-pdf' },
      { route: 'ocr', label: 'OCR', icon: 'ocr', tabId: 'tab-ocr' },
      { route: 'batch', label: 'Batch Convert', icon: 'batch', tabId: 'tab-batch' },
      { route: 'formats', label: 'Formats', icon: 'formats', tabId: 'tab-formats' },
    ],
  },
  {
    label: 'Account',
    items: [
      { route: 'settings', label: 'Settings', icon: 'settings', tabId: 'tab-settings' },
      { route: 'help', label: 'Help Center', icon: 'help' },
    ],
  },
]

export const ROUTE_TITLES: Record<RouteId, { title: string; crumb: string }> = {
  home: { title: 'Home', crumb: 'Home' },
  overview: { title: 'Workspace Overview', crumb: 'Workspace Overview' },
  tools: { title: 'All Tools', crumb: 'All Tools' },
  convert: { title: 'Convert Image', crumb: 'Convert Image' },
  resize: { title: 'Resize Image', crumb: 'Resize Image' },
  pdf: { title: 'PDF Tools', crumb: 'PDF Tools' },
  'pdf-merge': { title: 'Merge PDF', crumb: 'Merge PDF' },
  'pdf-split': { title: 'Split PDF', crumb: 'Split PDF' },
  'pdf-rotate': { title: 'Rotate PDF Pages', crumb: 'Rotate PDF Pages' },
  'pdf-extract': { title: 'Extract PDF Pages', crumb: 'Extract PDF Pages' },
  'pdf-remove': { title: 'Remove PDF Pages', crumb: 'Remove PDF Pages' },
  'pdf-reorder': { title: 'Reorder PDF Pages', crumb: 'Reorder PDF Pages' },
  'pdf-duplicate': { title: 'Duplicate PDF Pages', crumb: 'Duplicate PDF Pages' },
  'pdf-reverse': { title: 'Reverse PDF Pages', crumb: 'Reverse PDF Pages' },
  'pdf-booklet': { title: 'Booklet Layout', crumb: 'Booklet Layout' },
  'pdf-nup': { title: 'N-up Layout', crumb: 'N-up Layout' },
  'pdf-compress': { title: 'Compress PDF', crumb: 'Compress PDF' },
  'pdf-edit': { title: 'Edit PDF', crumb: 'Edit PDF' },
  'pdf-redact': { title: 'Redact PDF', crumb: 'Redact PDF' },
  'pdf-metadata': { title: 'PDF Metadata', crumb: 'PDF Metadata' },
  'pdf-sanitize': { title: 'Clean up PDF', crumb: 'Clean up PDF' },
  'pdf-flatten': { title: 'Flatten PDF', crumb: 'Flatten PDF' },
  'pdf-repair': { title: 'Repair PDF', crumb: 'Repair PDF' },
  'pdf-to-image': { title: 'PDF to Image', crumb: 'PDF to Image' },
  'pdf-images-to-pdf': { title: 'Image to PDF', crumb: 'Image to PDF' },
  'pdf-extract-text': { title: 'Extract PDF Text', crumb: 'Extract PDF Text' },
  ocr: { title: 'OCR', crumb: 'OCR' },
  batch: { title: 'Batch Convert', crumb: 'Batch Convert' },
  formats: { title: 'Formats', crumb: 'Formats' },
  files: { title: 'My Files', crumb: 'My Files' },
  recent: { title: 'Recent Files', crumb: 'Recent Files' },
  settings: { title: 'Settings', crumb: 'Settings' },
  help: { title: 'Help Center', crumb: 'Help Center' },
}

/** Case-insensitive tool search across name, description and keywords.
    In Bengali mode the Bengali description is searched too, so a
    Bengali query finds the tool whose card shows Bengali text. */
export function searchTools(query: string, lang: 'en' | 'bn' = 'en'): ToolEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return TOOLS
  return TOOLS.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (lang === 'bn' && (TOOL_DESCRIPTIONS_BN[t.id] ?? '').toLowerCase().includes(q)) ||
      t.keywords.some((k) => k.includes(q)),
  )
}
