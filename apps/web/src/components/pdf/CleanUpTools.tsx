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
import { useI18n } from '../../lib/use-i18n'
import { usePdfFile, type PdfToolProps } from './usePdfFile'

function editNumber(value: string): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function RedactTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
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
      pdf.setError(pdf.wasmMissing(label))
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
    if (result.runsRemoved === 0) {
      pdf.setStatusKey('pdf.redactNone', { label })
    } else {
      pdf.setStatusKey('pdf.redactDone', {
        label,
        runs: result.runsRemoved,
        s: result.runsRemoved === 1 ? '' : 's',
        chars: result.charactersRemoved,
        s2: result.charactersRemoved === 1 ? '' : 's',
        pages: result.pagesTouched,
        s3: result.pagesTouched === 1 ? '' : 's',
      })
    }
    pdf.setBusy(null)
  }

  const handleRedactText = () => {
    if (redactText.trim() === '') {
      pdf.setError(t('pdf.redactTypeError'))
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
      pdf.setError(t('pdf.redactAreaError', { n: pdf.pageCount }))
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
      description={t('pdf.redactDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-redact-text-button', label: t('pdf.redactTextButton'), busyLabel: t('pdf.redacting'), busyKey: 'Redacted PDF', onClick: handleRedactText }}
      secondaryActions={[
        { id: 'pdf-redact-rect-button', label: t('pdf.redactAreaButton'), busyLabel: t('pdf.redacting'), busyKey: 'Redacted PDF', onClick: handleRedactRect },
      ]}
    >
      <Box>
        <Typography variant="subtitle2">{t('pdf.redactTextTitle')}</Typography>
        <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
          <TextField
            id="pdf-redact-text"
            size="small"
            label={t('pdf.redactTextLabel')}
            value={redactText}
            onChange={(e) => setRedactText(e.target.value)}
            sx={{ width: 280 }}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {t('pdf.redactTextNote')}
        </Typography>
      </Box>
      <Box>
        <Typography variant="subtitle2">{t('pdf.redactAreaTitle')}</Typography>
        <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" sx={{ mt: 0.5 }}>
          {rectField('pdf-redact-page', t('pdf.redactPage'), redactPage, setRedactPage, 90)}
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
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-metadata', initialFiles, onInitialFilesConsumed)
  const [metaTitle, setMetaTitle] = useState('')
  const [metaAuthor, setMetaAuthor] = useState('')
  const [metaSubject, setMetaSubject] = useState('')
  const [metaKeywords, setMetaKeywords] = useState('')

  const run = async () => {
    if (!pdf.bytes || !pdf.file) return
    if (metaTitle === '' && metaAuthor === '' && metaSubject === '' && metaKeywords === '') {
      pdf.setError(t('pdf.metaEmptyError'))
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
      pdf.setError(pdf.wasmMissing('Set metadata'))
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
    pdf.setStatus(t('pdf.metaDone'))
    pdf.setBusy(null)
  }

  const field = (id: string, label: string, value: string, onChange: (v: string) => void, width: number) => (
    <TextField id={id} size="small" label={label} value={value} onChange={(e) => onChange(e.target.value)} sx={{ width }} />
  )

  return (
    <PdfToolPage
      headingId="pdf-metadata-heading"
      title="PDF Metadata"
      description={t('pdf.metaDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-meta-button', label: t('pdf.metaButton'), busyLabel: t('pdf.metaSaving'), busyKey: 'Metadata PDF', onClick: () => void run() }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
        {field('pdf-meta-title', t('pdf.metaTitle'), metaTitle, setMetaTitle, 200)}
        {field('pdf-meta-author', t('pdf.metaAuthor'), metaAuthor, setMetaAuthor, 160)}
        {field('pdf-meta-subject', t('pdf.metaSubject'), metaSubject, setMetaSubject, 160)}
        {field('pdf-meta-keywords', t('pdf.metaKeywords'), metaKeywords, setMetaKeywords, 160)}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {t('pdf.metaNoteA')}
        <Typography component="code" variant="caption">openpixel pdf set-metadata --title ""</Typography>
        {t('pdf.metaNoteB')}
      </Typography>
    </PdfToolPage>
  )
}

export function SanitizeTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-sanitize', initialFiles, onInitialFilesConsumed)
  const [threats, setThreats] = useState<PdfThreats | null>(null)

  const handleInspect = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Threat check')
    pdf.setError(null)
    pdf.setStatus(null)
    const found = await pdfInspect(pdf.bytes)
    if (!found) {
      pdf.setError(pdf.wasmMissing('Threat check'))
      pdf.setBusy(null)
      return
    }
    setThreats(found)
    const total = found.javascript.length + found.embedded_files.length + found.launch_actions.length + found.auto_actions.length
    if (total === 0) {
      pdf.setStatus(t('pdf.threatClean'))
    } else {
      pdf.setStatusKey('pdf.threatFound', {
        total,
        s: total === 1 ? '' : 's',
        js: found.javascript.length,
        files: found.embedded_files.length,
        s2: found.embedded_files.length === 1 ? '' : 's',
        launch: found.launch_actions.length,
        s3: found.launch_actions.length === 1 ? '' : 's',
        auto: found.auto_actions.length,
        s4: found.auto_actions.length === 1 ? '' : 's',
      })
    }
    pdf.setBusy(null)
  }

  const handleSanitize = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Cleaned PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfSanitize(pdf.bytes)
    if (!result) {
      pdf.setError(pdf.wasmMissing('Clean up'))
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
    if (total === 0) {
      pdf.setStatus(t('pdf.cleanNone'))
    } else {
      pdf.setStatusKey('pdf.cleanDone', {
        js: result.javascriptRemoved,
        files: result.embeddedFilesRemoved,
        s: result.embeddedFilesRemoved === 1 ? '' : 's',
        launch: result.launchActionsRemoved,
        s2: result.launchActionsRemoved === 1 ? '' : 's',
        auto: result.autoActionsRemoved,
        s3: result.autoActionsRemoved === 1 ? '' : 's',
      })
    }
    pdf.setBusy(null)
  }

  const threatsSummary =
    threats !== null ? (
      <Typography variant="body2" role="status">
        {threats.javascript.length + threats.embedded_files.length + threats.launch_actions.length + threats.auto_actions.length === 0
          ? t('pdf.threatSummaryClean')
          : t('pdf.threatSummaryFound', {
              js: threats.javascript.length,
              files: threats.embedded_files.length,
              launch: threats.launch_actions.length,
              auto: threats.auto_actions.length,
            })}
      </Typography>
    ) : null

  return (
    <PdfToolPage
      headingId="pdf-sanitize-heading"
      title="Clean up PDF"
      description={t('pdf.sanitizeDesc')}
      pdf={pdf}
      extra={threatsSummary}
      primary={{ id: 'pdf-sanitize-button', label: t('pdf.sanitizeRemove'), busyLabel: t('pdf.sanitizeCleaning'), busyKey: 'Cleaned PDF', onClick: () => void handleSanitize() }}
      secondaryActions={[
        { id: 'pdf-inspect-button', label: t('pdf.sanitizeInspect'), busyLabel: t('pdf.sanitizeChecking'), busyKey: 'Threat check', onClick: () => void handleInspect(), variant: 'outlined' },
      ]}
    >
      <Typography variant="body2" color="text.secondary">
        {t('pdf.sanitizeNoteA')}
        <Typography component="code" variant="body2">openpixel pdf sign</Typography>
        {t('pdf.sanitizeNoteB')}
      </Typography>
    </PdfToolPage>
  )
}

export function FlattenTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-flatten', initialFiles, onInitialFilesConsumed)

  const run = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Flattened PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfFlatten(pdf.bytes)
    if (!result) {
      pdf.setError(pdf.wasmMissing('Flatten'))
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
    pdf.setStatusKey('pdf.flattenDone', {
      a: result.annotationsFlattened,
      s: result.annotationsFlattened === 1 ? '' : 's',
      d: result.annotationsDropped,
      f: result.formFieldsRemoved,
      s2: result.formFieldsRemoved === 1 ? '' : 's',
    })
    pdf.setBusy(null)
  }

  return (
    <PdfToolPage
      headingId="pdf-flatten-heading"
      title="Flatten PDF"
      description={t('pdf.flattenDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-flatten-button', label: t('pdf.flattenButton'), busyLabel: t('pdf.flattening'), busyKey: 'Flattened PDF', onClick: () => void run() }}
    >
      <Typography variant="body2" color="text.secondary">
        {t('pdf.flattenNote')}
      </Typography>
    </PdfToolPage>
  )
}

export function RepairTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-repair', initialFiles, onInitialFilesConsumed)

  const run = async () => {
    if (!pdf.bytes || !pdf.file) return
    pdf.setBusy('Repaired PDF')
    pdf.setError(null)
    pdf.setStatus(null)
    const result = await pdfRepair(pdf.bytes)
    if (!result) {
      pdf.setError(pdf.wasmMissing('Repair'))
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
    pdf.setStatusKey('pdf.repairDone', { recovery: result.recovery })
    pdf.setBusy(null)
  }

  return (
    <PdfToolPage
      headingId="pdf-repair-heading"
      title="Repair PDF"
      description={t('pdf.repairDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-repair-button', label: t('pdf.repairButton'), busyLabel: t('pdf.repairing'), busyKey: 'Repaired PDF', onClick: () => void run() }}
    >
      <Typography variant="body2" color="text.secondary">
        {t('pdf.repairNote')}
      </Typography>
    </PdfToolPage>
  )
}
