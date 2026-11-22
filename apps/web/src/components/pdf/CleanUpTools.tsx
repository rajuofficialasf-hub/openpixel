/**
 * Clean-up tools — one focused page per tool. Redact really
 * removes text from the file; Metadata edits the document info;
 * Clean up checks for threats and strips them; Flatten inlines
 * annotations; Repair rebuilds the cross-reference table.
 *
 * Threat inspection is NOT a standalone tool: it produces no
 * file, it only reports — so it lives on the Clean up page as
 * the "Check for threats" step before "Remove threats".
 */
import { useState } from 'react'
import { Box, Stack, TextField, Typography } from '@mui/material'
import {
  pdfFlatten,
  pdfInspect,
  pdfOutputName,
  pdfRedact,
  pdfRepair,
  pdfSanitize,
  pdfSetMetadata,
  type PdfRedaction,
  type PdfThreats,
} from '../../lib/pdf'
import { PdfToolPage } from './shared'
import { usePdfFile, wasmMissing, type PdfToolProps } from './usePdfFile'

function editNumber(value: string): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function RedactTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-redact', initialFiles, onInitialFilesConsumed)
  const [redactText, setRedactText] = useState('')
  const [redactPage, setRedactPage] = useState('1')
  const [redactX, setRedactX] = useState('72')
  const [redactY, setRedactY] = useState('600')
  const [redactW, setRedactW] = useState('200')
  const [redactH, setRedactH] = useState('20')

  const runRedact = async (label: string, redactions: PdfRedaction[]) => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy(label)
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfRedact(pdf.bytes, redactions)
    if (!result) {
      pdf.setError(wasmMissing(label))
      pdf.setBusy(null)
      return
    }
    pdf.setResults([
      {
        label,
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(pdf.file.name, 'redacted'),
        pages: pdf.pageCount,
      },
    ])
    pdf.setStatus(
      result.runsRemoved === 0
        ? `${label}: nothing matched — the text was not found, so the file is unchanged.`
        : `${label}: ${result.runsRemoved} run${result.runsRemoved === 1 ? '' : 's'}, ${result.charactersRemoved} character${result.charactersRemoved === 1 ? '' : 's'} removed on ${result.pagesTouched} page${result.pagesTouched === 1 ? '' : 's'} — the text is gone from the file, not covered up.`,
    )
    pdf.setBusy(null)
  }

  const handleRedactText = () => {
    if (redactText.trim() === '') {
      pdf.setError('Type the text to redact.')
      return
    }
    void runRedact('Redacted PDF', [{ kind: 'text', page: null, text: redactText }])
  }

  const handleRedactRect = () => {
    const page = Number(redactPage)
    const x = editNumber(redactX)
    const y = editNumber(redactY)
    const w = editNumber(redactW)
    const h = editNumber(redactH)
    if (!Number.isInteger(page) || page < 1 || page > pdf.pageCount || x === null || y === null || w === null || h === null || w <= 0 || h <= 0) {
      pdf.setError('Check the redaction area — page 1–' + pdf.pageCount + ' and numbers for X/Y/width/height.')
      return
    }
    void runRedact('Redacted PDF', [{ kind: 'rect', page, x, y, width: w, height: h }])
  }

  const rectField = (id: string, label: string, value: string, onChange: (v: string) => void, width: number) => (
    <TextField id={id} size="small" label={label} type="number" value={value} onChange={(e) => onChange(e.target.value)} sx={{ width }} />
  )

  return (
    <PdfToolPage
      headingId="pdf-redact-heading"
      title="Redact PDF"
      description="Permanently remove text from a PDF — deleted from the file, not covered up. The removed text cannot be recovered from the output."
      pdf={pdf}
      primary={{ id: 'pdf-redact-text-button', label: 'Redact text', busyLabel: 'Redacting…', busyKey: 'Redacted PDF', onClick: handleRedactText }}
      secondaryActions={[
        { id: 'pdf-redact-rect-button', label: 'Redact area', busyLabel: 'Redacting…', busyKey: 'Redacted PDF', onClick: handleRedactRect },
      ]}
    >
      <Box>
        <Typography variant="subtitle2">Redact text</Typography>
        <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
          <TextField
            id="pdf-redact-text"
            size="small"
            label="Text to remove"
            value={redactText}
            onChange={(e) => setRedactText(e.target.value)}
            sx={{ width: 280 }}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          Every occurrence on every page, case-sensitive.
        </Typography>
      </Box>
      <Box>
        <Typography variant="subtitle2">Redact an area</Typography>
        <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
          {rectField('pdf-redact-page', 'Page', redactPage, setRedactPage, 90)}
          {rectField('pdf-redact-x', 'X (pt)', redactX, setRedactX, 90)}
          {rectField('pdf-redact-y', 'Y (pt)', redactY, setRedactY, 90)}
          {rectField('pdf-redact-w', 'Width (pt)', redactW, setRedactW, 100)}
          {rectField('pdf-redact-h', 'Height (pt)', redactH, setRedactH, 100)}
        </Stack>
      </Box>
    </PdfToolPage>
  )
}

export function MetadataTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-metadata', initialFiles, onInitialFilesConsumed)
  const [metaTitle, setMetaTitle] = useState('')
  const [metaAuthor, setMetaAuthor] = useState('')
  const [metaSubject, setMetaSubject] = useState('')
  const [metaKeywords, setMetaKeywords] = useState('')

  const run = async () => {
    if (!pdf.bytes || !pdf.file) return
    if (metaTitle === '' && metaAuthor === '' && metaSubject === '' && metaKeywords === '') {
      pdf.setError('Type at least one metadata field — leave a field blank to keep it, or clear it from the CLI with an empty string.')
      return
    }
    pdf.setBusy('Metadata PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const out = await pdfSetMetadata(pdf.bytes, {
      title: metaTitle === '' ? null : metaTitle,
      author: metaAuthor === '' ? null : metaAuthor,
      subject: metaSubject === '' ? null : metaSubject,
      keywords: metaKeywords === '' ? null : metaKeywords,
    })
    if (!out) {
      pdf.setError(wasmMissing('Set metadata'))
      pdf.setBusy(null)
      return
    }
    pdf.setResults([
      {
        label: 'Metadata PDF',
        blob: new Blob([out as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(pdf.file.name, 'metadata'),
        pages: pdf.pageCount,
      },
    ])
    pdf.setStatus('Metadata PDF: title/author/subject/keywords updated (blank fields were left unchanged).')
    pdf.setBusy(null)
  }

  const field = (id: string, label: string, value: string, onChange: (v: string) => void, width: number) => (
    <TextField id={id} size="small" label={label} value={value} onChange={(e) => onChange(e.target.value)} sx={{ width }} />
  )

  return (
    <PdfToolPage
      headingId="pdf-metadata-heading"
      title="PDF Metadata"
      description="Edit a PDF's title, author, subject and keywords."
      pdf={pdf}
      primary={{ id: 'pdf-meta-button', label: 'Set metadata', busyLabel: 'Saving…', busyKey: 'Metadata PDF', onClick: () => void run() }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
        {field('pdf-meta-title', 'Title', metaTitle, setMetaTitle, 200)}
        {field('pdf-meta-author', 'Author', metaAuthor, setMetaAuthor, 160)}
        {field('pdf-meta-subject', 'Subject', metaSubject, setMetaSubject, 160)}
        {field('pdf-meta-keywords', 'Keywords', metaKeywords, setMetaKeywords, 160)}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Blank fields are left unchanged. To clear a field, use the native CLI
        (`openpixel pdf set-metadata --title ""`).
      </Typography>
    </PdfToolPage>
  )
}

export function SanitizeTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-sanitize', initialFiles, onInitialFilesConsumed)
  const [threats, setThreats] = useState<PdfThreats | null>(null)

  const handleInspect = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Threat check')
    pdf.setError(null)
    pdf.setStatus(null)
    const found = await pdfInspect(pdf.bytes)
    if (!found) {
      pdf.setError(wasmMissing('Threat check'))
      pdf.setBusy(null)
      return
    }
    setThreats(found)
    const total = found.javascript.length + found.embedded_files.length + found.launch_actions.length + found.auto_actions.length
    pdf.setStatus(
      total === 0
        ? 'Threat check: clean — no JavaScript, embedded files, launch actions or auto-actions found.'
        : `Threat check: ${total} threat${total === 1 ? '' : 's'} found — ${found.javascript.length} JavaScript, ${found.embedded_files.length} embedded file${found.embedded_files.length === 1 ? '' : 's'}, ${found.launch_actions.length} launch action${found.launch_actions.length === 1 ? '' : 's'}, ${found.auto_actions.length} auto-action${found.auto_actions.length === 1 ? '' : 's'}. Use "Remove threats" to strip them.`,
    )
    pdf.setBusy(null)
  }

  const handleSanitize = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Cleaned PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfSanitize(pdf.bytes)
    if (!result) {
      pdf.setError(wasmMissing('Clean up'))
      pdf.setBusy(null)
      return
    }
    pdf.setResults([
      {
        label: 'Cleaned PDF',
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(pdf.file.name, 'cleaned'),
        pages: pdf.pageCount,
      },
    ])
    const total = result.javascriptRemoved + result.embeddedFilesRemoved + result.launchActionsRemoved + result.autoActionsRemoved
    pdf.setStatus(
      total === 0
        ? 'Cleaned PDF: nothing dangerous was found — the file is unchanged.'
        : `Cleaned PDF: ${result.javascriptRemoved} JavaScript, ${result.embeddedFilesRemoved} embedded file${result.embeddedFilesRemoved === 1 ? '' : 's'}, ${result.launchActionsRemoved} launch action${result.launchActionsRemoved === 1 ? '' : 's'}, ${result.autoActionsRemoved} auto-action${result.autoActionsRemoved === 1 ? '' : 's'} removed. The document is kept; the dangerous parts are gone, not hidden.`,
    )
    pdf.setBusy(null)
  }

  const threatsSummary =
    threats !== null ? (
      <Typography variant="body2" role="status">
        {threats.javascript.length + threats.embedded_files.length + threats.launch_actions.length + threats.auto_actions.length === 0
          ? 'Threat check: clean — no JavaScript, embedded files, launch actions or auto-actions.'
          : `Threats found: ${threats.javascript.length} JavaScript, ${threats.embedded_files.length} embedded file(s), ${threats.launch_actions.length} launch action(s), ${threats.auto_actions.length} auto-action(s).`}
      </Typography>
    ) : null

  return (
    <PdfToolPage
      headingId="pdf-sanitize-heading"
      title="Clean up PDF"
      description="Check a PDF for JavaScript, embedded files and launch actions — then strip them out. The document is kept; only the dangerous parts go."
      pdf={pdf}
      extra={threatsSummary}
      primary={{ id: 'pdf-sanitize-button', label: 'Remove threats', busyLabel: 'Cleaning…', busyKey: 'Cleaned PDF', onClick: () => void handleSanitize() }}
      secondaryActions={[
        { id: 'pdf-inspect-button', label: 'Check for threats', busyLabel: 'Checking…', busyKey: 'Threat check', onClick: () => void handleInspect(), variant: 'outlined' },
      ]}
    >
      <Typography variant="body2" color="text.secondary">
        First check what is inside the file, then remove it. Digital signatures need a private key, so signing
        stays in the native CLI (`openpixel pdf sign`) and the desktop app — the browser never receives your key.
      </Typography>
    </PdfToolPage>
  )
}

export function FlattenTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-flatten', initialFiles, onInitialFilesConsumed)

  const run = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Flattened PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfFlatten(pdf.bytes)
    if (!result) {
      pdf.setError(wasmMissing('Flatten'))
      pdf.setBusy(null)
      return
    }
    pdf.setResults([
      {
        label: 'Flattened PDF',
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(pdf.file.name, 'flattened'),
        pages: pdf.pageCount,
      },
    ])
    pdf.setStatus(
      `Flattened PDF: ${result.annotationsFlattened} annotation${result.annotationsFlattened === 1 ? '' : 's'} flattened, ${result.annotationsDropped} dropped, ${result.formFieldsRemoved} form field${result.formFieldsRemoved === 1 ? '' : 's'} removed.`,
    )
    pdf.setBusy(null)
  }

  return (
    <PdfToolPage
      headingId="pdf-flatten-heading"
      title="Flatten PDF"
      description="Flatten annotations into the page content and remove form fields — what you see is what the file keeps."
      pdf={pdf}
      primary={{ id: 'pdf-flatten-button', label: 'Flatten annotations', busyLabel: 'Flattening…', busyKey: 'Flattened PDF', onClick: () => void run() }}
    >
      <Typography variant="body2" color="text.secondary">
        Annotations without an appearance are dropped and counted — never faked into the output.
      </Typography>
    </PdfToolPage>
  )
}

export function RepairTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-repair', initialFiles, onInitialFilesConsumed)

  const run = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Repaired PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfRepair(pdf.bytes)
    if (!result) {
      pdf.setError(wasmMissing('Repair'))
      pdf.setBusy(null)
      return
    }
    pdf.setResults([
      {
        label: 'Repaired PDF',
        blob: new Blob([result.data as BlobPart], { type: 'application/pdf' }),
        filename: pdfOutputName(pdf.file.name, 'repaired'),
        pages: pdf.pageCount,
      },
    ])
    pdf.setStatus(`Repaired PDF: cross-reference table read "${result.recovery}".`)
    pdf.setBusy(null)
  }

  return (
    <PdfToolPage
      headingId="pdf-repair-heading"
      title="Repair PDF"
      description="Rebuild the cross-reference table of a damaged PDF so it opens again."
      pdf={pdf}
      primary={{ id: 'pdf-repair-button', label: 'Repair file', busyLabel: 'Repairing…', busyKey: 'Repaired PDF', onClick: () => void run() }}
    >
      <Typography variant="body2" color="text.secondary">
        A healthy file comes back with the cross-reference table read "as written".
      </Typography>
    </PdfToolPage>
  )
}
