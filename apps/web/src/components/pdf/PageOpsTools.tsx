/**
 * Page-operation tools — one focused page per tool. Each is a
 * thin wrapper over the shared `PdfToolPage` shell: its own
 * settings, its own primary action, nothing else on the page.
 * All run through the one WASM `pdf_process` call (`runOp`).
 */
import { useState } from 'react'
import { Box, Select, Stack, TextField, Typography } from '@mui/material'
import { parsePageList, parsePageRanges, parseReorder } from '../../lib/pdf'
import { PdfToolPage, type PdfToolAction } from './shared'
import { useI18n } from '../../lib/use-i18n'
import { usePdfFile, type PdfToolProps } from './usePdfFile'

function opError(t: (key: string, vars?: Record<string, string | number>) => string, whatKey: string, pageCount: number): string {
  return t('pdf.opError', { what: t(whatKey), n: pageCount })
}

function pageListField(props: {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Box>
      <Typography variant="subtitle2" component="label" htmlFor={props.id}>
        {props.label}
      </Typography>
      <TextField
        id={props.id}
        size="small"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        sx={{ width: 280, mt: 0.5, display: 'block' }}
      />
    </Box>
  )
}

export function RotateTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-rotate', initialFiles, onInitialFilesConsumed)
  const [pages, setPages] = useState('')
  const [degrees, setDegrees] = useState(90)
  const run = () => {
    const list = pages.trim() === '' ? null : parsePageList(pages, pdf.pageCount)
    if (list === null && pages.trim() !== '') {
      pdf.setError(opError(t, 'pdf.opRotate', pdf.pageCount))
      return
    }
    void pdf.runOp(
      'Rotated PDF',
      JSON.stringify({ kind: 'rotate', pages: list ?? undefined, degrees }),
      'rotated',
    )
  }
  const primary: PdfToolAction = {
    id: 'pdf-rotate-button',
    label: t('pdf.rotateButton'),
    busyLabel: t('pdf.rotating'),
    busyKey: 'Rotated PDF',
    onClick: run,
  }
  return (
    <PdfToolPage
      headingId="pdf-rotate-heading"
      title="Rotate PDF Pages"
      description={t('pdf.rotateDesc')}
      pdf={pdf}
      primary={primary}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
        {pageListField({
          id: 'pdf-rotate-pages',
          label: t('pdf.rotatePages'),
          placeholder: t('pdf.rotatePlaceholder'),
          value: pages,
          onChange: setPages,
        })}
        <Box>
          <Typography variant="subtitle2" component="label" htmlFor="pdf-rotate-degrees">
            {t('pdf.rotateRotation')}
          </Typography>
          <Select
            native
            id="pdf-rotate-degrees"
            value={degrees}
            onChange={(e) => setDegrees(Number(e.target.value))}
            aria-label={t('pdf.rotateAria')}
            sx={{ mt: 0.5, display: 'block' }}
          >
            <option value={90}>90°</option>
            <option value={180}>180°</option>
            <option value={270}>270°</option>
          </Select>
        </Box>
      </Stack>
    </PdfToolPage>
  )
}

export function ExtractTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-extract', initialFiles, onInitialFilesConsumed)
  const [pages, setPages] = useState('')
  const run = () => {
    const list = parsePageList(pages, pdf.pageCount)
    if (!list) {
      pdf.setError(opError(t, 'pdf.opExtract', pdf.pageCount))
      return
    }
    void pdf.runOp('Extracted PDF', JSON.stringify({ kind: 'extract', pages: list }), 'extracted')
  }
  return (
    <PdfToolPage
      headingId="pdf-extract-heading"
      title="Extract PDF Pages"
      description={t('pdf.extractDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-extract-button', label: t('pdf.extractButton'), busyLabel: t('pdf.extracting'), busyKey: 'Extracted PDF', onClick: run }}
    >
      {pageListField({ id: 'pdf-extract-pages', label: t('pdf.extractPages'), placeholder: t('pdf.extractPlaceholder'), value: pages, onChange: setPages })}
    </PdfToolPage>
  )
}

export function RemoveTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-remove', initialFiles, onInitialFilesConsumed)
  const [pages, setPages] = useState('')
  const run = () => {
    const list = parsePageList(pages, pdf.pageCount)
    if (!list) {
      pdf.setError(opError(t, 'pdf.opRemove', pdf.pageCount))
      return
    }
    void pdf.runOp('Removed pages', JSON.stringify({ kind: 'remove', pages: list }), 'removed')
  }
  return (
    <PdfToolPage
      headingId="pdf-remove-heading"
      title="Remove PDF Pages"
      description={t('pdf.removeDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-remove-button', label: t('pdf.removeButton'), busyLabel: t('pdf.removing'), busyKey: 'Removed pages', onClick: run }}
    >
      {pageListField({ id: 'pdf-remove-pages', label: t('pdf.removePages'), placeholder: t('pdf.removePlaceholder'), value: pages, onChange: setPages })}
    </PdfToolPage>
  )
}

export function ReorderTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-reorder', initialFiles, onInitialFilesConsumed)
  const [order, setOrder] = useState('')
  const run = () => {
    const parsed = parseReorder(order, pdf.pageCount)
    if (!parsed) {
      pdf.setError(t('pdf.reorderError', { n: pdf.pageCount }))
      return
    }
    void pdf.runOp('Reordered PDF', JSON.stringify({ kind: 'reorder', order: parsed }), 'reordered')
  }
  return (
    <PdfToolPage
      headingId="pdf-reorder-heading"
      title="Reorder PDF Pages"
      description={t('pdf.reorderDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-reorder-button', label: t('pdf.reorderButton'), busyLabel: t('pdf.reordering'), busyKey: 'Reordered PDF', onClick: run }}
    >
      {pageListField({
        id: 'pdf-reorder-order',
        label: t('pdf.reorderOrder'),
        placeholder: t('pdf.reorderPlaceholder', { example: pdf.pageCount >= 3 ? '3,1,2' : '1' }),
        value: order,
        onChange: setOrder,
      })}
    </PdfToolPage>
  )
}

export function DuplicateTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-duplicate', initialFiles, onInitialFilesConsumed)
  const [pages, setPages] = useState('')
  const run = () => {
    const list = parsePageList(pages, pdf.pageCount)
    if (!list) {
      pdf.setError(opError(t, 'pdf.opDuplicate', pdf.pageCount))
      return
    }
    void pdf.runOp('Duplicated pages', JSON.stringify({ kind: 'duplicate', pages: list }), 'duplicated')
  }
  return (
    <PdfToolPage
      headingId="pdf-duplicate-heading"
      title="Duplicate PDF Pages"
      description={t('pdf.duplicateDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-duplicate-button', label: t('pdf.duplicateButton'), busyLabel: t('pdf.duplicating'), busyKey: 'Duplicated pages', onClick: run }}
    >
      {pageListField({ id: 'pdf-duplicate-pages', label: t('pdf.duplicatePages'), placeholder: t('pdf.duplicatePlaceholder'), value: pages, onChange: setPages })}
    </PdfToolPage>
  )
}

export function ReverseTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-reverse', initialFiles, onInitialFilesConsumed)
  const run = () => void pdf.runOp('Reversed PDF', '{"kind":"reverse"}', 'reversed')
  return (
    <PdfToolPage
      headingId="pdf-reverse-heading"
      title="Reverse PDF Pages"
      description={t('pdf.reverseDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-reverse-button', label: t('pdf.reverseButton'), busyLabel: t('pdf.reversing'), busyKey: 'Reversed PDF', onClick: run }}
    />
  )
}

export function BookletTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-booklet', initialFiles, onInitialFilesConsumed)
  const run = () => void pdf.runOp('Booklet PDF', '{"kind":"booklet"}', 'booklet')
  return (
    <PdfToolPage
      headingId="pdf-booklet-heading"
      title="Booklet Layout"
      description={t('pdf.bookletDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-booklet-button', label: t('pdf.bookletButton'), busyLabel: t('pdf.bookletMaking'), busyKey: 'Booklet PDF', onClick: run }}
    />
  )
}

export function NupTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-nup', initialFiles, onInitialFilesConsumed)
  const [cols, setCols] = useState(2)
  const [rows, setRows] = useState(2)
  const run = () =>
    void pdf.runOp('N-up PDF', JSON.stringify({ kind: 'nup', cols, rows }), 'nup')
  return (
    <PdfToolPage
      headingId="pdf-nup-heading"
      title="N-up Layout"
      description={t('pdf.nupDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-nup-button', label: t('pdf.nupButton'), busyLabel: t('pdf.nupLayingOut'), busyKey: 'N-up PDF', onClick: run }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
        <Box>
          <Typography variant="subtitle2" component="label" htmlFor="pdf-nup-cols">
            {t('pdf.nupCols')}
          </Typography>
          <Select native id="pdf-nup-cols" value={cols} onChange={(e) => setCols(Number(e.target.value))} aria-label={t('pdf.nupColsAria')} sx={{ mt: 0.5, display: 'block' }}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{t('pdf.nupColsN', { n })}</option>
            ))}
          </Select>
        </Box>
        <Box>
          <Typography variant="subtitle2" component="label" htmlFor="pdf-nup-rows">
            {t('pdf.nupRows')}
          </Typography>
          <Select native id="pdf-nup-rows" value={rows} onChange={(e) => setRows(Number(e.target.value))} aria-label={t('pdf.nupRowsAria')} sx={{ mt: 0.5, display: 'block' }}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{t('pdf.nupRowsN', { n })}</option>
            ))}
          </Select>
        </Box>
      </Stack>
    </PdfToolPage>
  )
}

export function SplitTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const pdf = usePdfFile('pdf-split', initialFiles, onInitialFilesConsumed)
  const [ranges, setRanges] = useState('')
  const run = () => {
    const parsed = parsePageRanges(ranges, pdf.pageCount)
    if (!parsed) {
      pdf.setError(t('pdf.splitError', { n: pdf.pageCount }))
      return
    }
    void pdf.runOp('Split PDF', JSON.stringify({ kind: 'split', ranges: parsed }), 'split')
  }
  return (
    <PdfToolPage
      headingId="pdf-split-heading"
      title="Split PDF"
      description={t('pdf.splitDesc')}
      pdf={pdf}
      primary={{ id: 'pdf-split-button', label: t('pdf.splitButton'), busyLabel: t('pdf.splitting'), busyKey: 'Split PDF', onClick: run }}
    >
      {pageListField({ id: 'pdf-split-ranges', label: t('pdf.splitRanges'), placeholder: t('pdf.splitPlaceholder'), value: ranges, onChange: setRanges })}
      <Typography variant="caption" color="text.secondary">
        {t('pdf.splitNote')}
      </Typography>
    </PdfToolPage>
  )
}
