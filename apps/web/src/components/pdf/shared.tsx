/**
 * Shared building blocks for the per-tool PDF pages.
 *
 * One tool = one page (user correction, 17 Nov 2026): every PDF
 * tool page is a thin component over `usePdfFile` + `PdfToolPage`.
 * The hook lives in `usePdfFile.ts`; this file only exports
 * components. The shell renders the one shared pattern from the
 * master prompt §6 — header, upload, file summary, settings, ONE
 * primary action, result. A tool page only adds its own settings
 * controls and its own handler.
 *
 * The Edit tool is the exception: it keeps the 3-panel editor
 * layout (thumbnails / preview / tools) and uses `usePdfFile`
 * directly instead of this shell.
 */
import type { ReactNode } from 'react'
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import DownloadIcon from '@mui/icons-material/Download'
import { formatBytes } from '../../lib/capabilities'
import { DropZone } from '../DropZone'
import { ToolPageHeader } from '../ToolPage'
import { downloadBlob, type UsePdfFile } from './usePdfFile'
import { useI18n } from '../../lib/i18n'

export function WasmWarning() {
  return (
    <Box
      role="status"
      sx={{
        borderRadius: 3,
        border: 1,
        borderColor: (t) => alpha(t.palette.warning.main, 0.4),
        bgcolor: (t) => alpha(t.palette.warning.main, 0.08),
        p: 2.5,
      }}
    >
      <Typography variant="body2">
        The WASM engine is not loaded, so PDF page operations are unavailable here — previews and PDF to image
        still work. Rebuild the web app with <Typography component="code" variant="body2">npm run build:wasm</Typography>.
      </Typography>
    </Box>
  )
}

/** File name, size and page count, with the "different file" switch. */
export function PdfFileSummary({ pdf }: { pdf: UsePdfFile }) {
  const { t } = useI18n()
  if (!pdf.file) return null
  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <Typography variant="body1" fontWeight={600} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
            {pdf.file.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatBytes(pdf.file.size)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('common.pages')}: <Box component="span" id="pdf-page-count" sx={{ color: 'text.primary', fontWeight: 500 }}>{pdf.pageCount}</Box>
          </Typography>
          <Button type="button" variant="outlined" size="small" onClick={pdf.clearFile}>
            {t('common.chooseDifferentFile')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

/** Status line + download buttons + error — the shared result state. */
export function PdfResultBoxes({ pdf }: { pdf: UsePdfFile }) {
  const { t } = useI18n()
  return (
    <>
      {pdf.status && pdf.results.length > 0 && (
        <Box
          role="status"
          sx={{
            borderRadius: 3,
            border: 1,
            borderColor: (t) => alpha(t.palette.success.main, 0.4),
            bgcolor: (t) => alpha(t.palette.success.main, 0.08),
            p: 2.5,
          }}
        >
          <Typography variant="body1" fontWeight={600} color="success.main" id="pdf-result-status">
            {pdf.status}
          </Typography>
          <Stack direction="row" flexWrap="wrap" spacing={1.5} sx={{ mt: 1.5 }}>
            {pdf.results.map((r, i) => (
              <Button
                key={r.filename}
                type="button"
                variant="contained"
                color="success"
                id={`pdf-download-${i}`}
                startIcon={<DownloadIcon />}
                onClick={() => downloadBlob(r.blob, r.filename)}
              >
                {t('common.download')} {r.filename}
              </Button>
            ))}
          </Stack>
        </Box>
      )}

      {pdf.status && pdf.results.length === 0 && (
        <Box
          role="status"
          sx={{
            borderRadius: 3,
            border: 1,
            borderColor: (t) => alpha(t.palette.success.main, 0.4),
            bgcolor: (t) => alpha(t.palette.success.main, 0.08),
            p: 2.5,
          }}
        >
          <Typography variant="body1" fontWeight={600} color="success.main" id="pdf-result-status">
            {pdf.status}
          </Typography>
        </Box>
      )}

      {pdf.error && <Alert severity="error">{pdf.error}</Alert>}
    </>
  )
}

export interface PdfToolAction {
  id: string
  label: string
  /** Text while this action is running (`busy` equals `busyKey`). */
  busyLabel: string
  /** The label the handler sets with `setBusy` — the shell matches on it. */
  busyKey: string
  onClick: () => void
  disabled?: boolean
  variant?: 'contained' | 'outlined'
}

interface PdfToolPageProps {
  headingId: string
  title: string
  description: ReactNode
  pdf: UsePdfFile
  /** DropZone label for the single-PDF upload (default "Drop a PDF here"). */
  uploadLabel?: string
  uploadHint?: string
  /** Replace the default PDF DropZone entirely (images tool). */
  upload?: ReactNode
  /** Replace the default file summary (images tool). */
  summary?: ReactNode
  /** Override the "a file is loaded" gate (images tool: images loaded, no PDF). */
  ready?: boolean
  /** Shown between the file summary and the settings card (e.g. the info card). */
  beforeSettings?: ReactNode
  /** Overline for the settings card (default "Settings"). */
  settingsLabel?: string
  children?: ReactNode
  primary: PdfToolAction
  secondaryActions?: PdfToolAction[]
  /** Shown between the actions and the result (e.g. extracted text, threat list). */
  extra?: ReactNode
}

function ActionButton({ pdf, action }: { pdf: UsePdfFile; action: PdfToolAction }) {
  const running = pdf.busy === action.busyKey
  return (
    <Button
      type="button"
      variant={action.variant ?? 'contained'}
      id={action.id}
      onClick={action.onClick}
      disabled={pdf.busy !== null || action.disabled}
    >
      {running ? action.busyLabel : action.label}
    </Button>
  )
}

/**
 * The one shared tool-page pattern (master prompt §6): header,
 * upload, file summary, settings, ONE primary action, result.
 * Settings and actions only appear once a file is loaded — the
 * tool cannot run without one.
 */
export function PdfToolPage({
  headingId,
  title,
  description,
  pdf,
  uploadLabel = 'Drop a PDF here',
  uploadHint = 'One PDF at a time. Everything runs locally — nothing is uploaded.',
  upload,
  summary,
  ready,
  beforeSettings,
  settingsLabel,
  children,
  primary,
  secondaryActions,
  extra,
}: PdfToolPageProps) {
  const { t } = useI18n()
  const loaded = ready ?? pdf.file !== null
  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      sx={{
        // In the AppShell viewport-fit workspace (all pdf-* routes
        // on desktop) the shell fills the remaining height and
        // scrolls inside itself when taller than the viewport —
        // the document itself never scrolls. On mobile / normal
        // pages this is a no-op (height is content height).
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
      }}
    >
      <Stack spacing={2} sx={{ maxWidth: 860 }}>
        <ToolPageHeader headingId={headingId} title={title} description={description} />

        {pdf.wasmReady === false && <WasmWarning />}

        {!loaded && (
          upload ?? (
            <DropZone
              inputId="pdf-file"
              label={uploadLabel}
              hint={uploadHint}
              multiple={false}
              accept="application/pdf,.pdf"
              compact
              onFiles={(files) => void pdf.handleFiles(files)}
            />
          )
        )}

        {pdf.loading && (
          <Typography role="status" variant="body2" color="text.secondary">
            {t('common.readingPdf')}
          </Typography>
        )}

        {loaded && (summary ?? <PdfFileSummary pdf={pdf} />)}

        {loaded && beforeSettings}

        {loaded && children && (
          <Card>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                {settingsLabel ?? t('common.settings')}
              </Typography>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {children}
              </Stack>
            </CardContent>
          </Card>
        )}

        {loaded && (
          <Stack direction="row" spacing={1.5} flexWrap="wrap">
            <ActionButton pdf={pdf} action={primary} />
            {secondaryActions?.map((a) => <ActionButton key={a.id} pdf={pdf} action={a} />)}
          </Stack>
        )}

        {extra}
        <PdfResultBoxes pdf={pdf} />
      </Stack>
    </Box>
  )
}
