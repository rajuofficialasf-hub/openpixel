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
  | 'ocr'
  | 'batch'
  | 'formats'
  | 'files'
  | 'recent'
  | 'settings'
  | 'help'

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
  // ---- PDF (web) ----
  {
    id: 'pdf-merge',
    name: 'Merge PDF',
    description: 'Combine several PDFs into one, in the order you choose.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf',
    keywords: ['merge', 'combine', 'join', 'pdf'],
    popular: true,
  },
  {
    id: 'pdf-split',
    name: 'Split PDF',
    description: 'Split a PDF into separate files by page ranges.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf',
    keywords: ['split', 'separate', 'pages', 'extract', 'pdf'],
  },
  {
    id: 'pdf-compress',
    name: 'Compress PDF',
    description: 'Shrink a PDF — screen, ebook or printer quality. Images are downsampled and re-encoded.',
    categories: ['pdf', 'compression'],
    status: 'web',
    route: 'pdf',
    keywords: ['compress', 'smaller', 'size', 'optimize', 'pdf'],
    popular: true,
  },
  {
    id: 'pdf-to-image',
    name: 'PDF to Image',
    description: 'Render PDF pages to PNG or JPEG and download them.',
    categories: ['pdf', 'conversion'],
    status: 'web',
    route: 'pdf',
    keywords: ['pdf', 'image', 'png', 'jpeg', 'render', 'page'],
    popular: true,
  },
  {
    id: 'image-to-pdf',
    name: 'Image to PDF',
    description: 'Turn one or more images into a PDF document.',
    categories: ['pdf', 'conversion'],
    status: 'web',
    route: 'pdf',
    keywords: ['image', 'pdf', 'create', 'photo'],
    popular: true,
  },
  {
    id: 'pdf-edit',
    name: 'Edit PDF',
    description: 'Add text, images, shapes, highlights, comments, page numbers and headers to a PDF.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf',
    keywords: ['edit', 'annotate', 'text', 'overlay', 'pdf'],
  },
  {
    id: 'pdf-redact',
    name: 'Redact PDF',
    description: 'Permanently remove text from a PDF — deleted from the file, not covered up.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf',
    keywords: ['redact', 'remove', 'black out', 'sensitive', 'pdf'],
  },
  {
    id: 'pdf-pages',
    name: 'Organize PDF Pages',
    description: 'Rotate, extract, remove, reorder, duplicate, reverse, booklet and N-up page layouts.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf',
    keywords: ['pages', 'reorder', 'rotate', 'extract', 'delete', 'duplicate', 'pdf'],
  },
  {
    id: 'pdf-metadata',
    name: 'PDF Metadata',
    description: 'Read and edit a PDF’s title, author and other document information.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf',
    keywords: ['metadata', 'title', 'author', 'info', 'pdf'],
  },
  {
    id: 'pdf-repair',
    name: 'Repair & Sanitize PDF',
    description: 'Fix a damaged PDF and strip JavaScript, launch actions, embedded files and other threats.',
    categories: ['pdf'],
    status: 'web',
    route: 'pdf',
    keywords: ['repair', 'fix', 'sanitize', 'clean', 'safe', 'pdf'],
  },
  {
    id: 'pdf-text',
    name: 'Extract PDF Text',
    description: 'Extract the text of a PDF as TXT or HTML in the browser. EPUB/DOCX export runs in the CLI.',
    categories: ['pdf', 'conversion'],
    status: 'web',
    route: 'pdf',
    keywords: ['extract', 'text', 'copy', 'content', 'pdf'],
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
      { route: 'tools', label: 'All Tools', icon: 'grid' },
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
  ocr: { title: 'OCR', crumb: 'OCR' },
  batch: { title: 'Batch Convert', crumb: 'Batch Convert' },
  formats: { title: 'Formats', crumb: 'Formats' },
  files: { title: 'My Files', crumb: 'My Files' },
  recent: { title: 'Recent Files', crumb: 'Recent Files' },
  settings: { title: 'Settings', crumb: 'Settings' },
  help: { title: 'Help Center', crumb: 'Help Center' },
}

/** Case-insensitive tool search across name, description and keywords. */
export function searchTools(query: string): ToolEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return TOOLS
  return TOOLS.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.keywords.some((k) => k.includes(q)),
  )
}
