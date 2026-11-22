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
import { usePdfFile, type PdfToolProps } from './usePdfFile'

function opError(what: string, pageCount: number): string {
  return `Check the pages for ${what} — use pages 1–${pageCount}, e.g. "1,3" or "1-3".`
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
  const pdf = usePdfFile('pdf-rotate', initialFiles, onInitialFilesConsumed)
  const [pages, setPages] = useState('')
  const [degrees, setDegrees] = useState(90)
  const run = () => {
    const list = pages.trim() === '' ? null : parsePageList(pages, pdf.pageCount)
    if (list === null && pages.trim() !== '') {
      pdf.setError(opError('rotate', pdf.pageCount))
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
    label: 'Rotate',
    busyLabel: 'Rotating…',
    busyKey: 'Rotated PDF',
    onClick: run,
  }
  return (
    <PdfToolPage
      headingId="pdf-rotate-heading"
      title="Rotate PDF Pages"
      description="Rotate pages 90°, 180° or 270°. Leave the pages blank to rotate every page."
      pdf={pdf}
      primary={primary}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
        {pageListField({
          id: 'pdf-rotate-pages',
          label: 'Pages',
          placeholder: 'e.g. 1,3 or 1-3 (empty = all pages)',
          value: pages,
          onChange: setPages,
        })}
        <Box>
          <Typography variant="subtitle2" component="label" htmlFor="pdf-rotate-degrees">
            Rotation
          </Typography>
          <Select
            native
            id="pdf-rotate-degrees"
            value={degrees}
            onChange={(e) => setDegrees(Number(e.target.value))}
            aria-label="Rotation in degrees"
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
  const pdf = usePdfFile('pdf-extract', initialFiles, onInitialFilesConsumed)
  const [pages, setPages] = useState('')
  const run = () => {
    const list = parsePageList(pages, pdf.pageCount)
    if (!list) {
      pdf.setError(opError('extract', pdf.pageCount))
      return
    }
    void pdf.runOp('Extracted PDF', JSON.stringify({ kind: 'extract', pages: list }), 'extracted')
  }
  return (
    <PdfToolPage
      headingId="pdf-extract-heading"
      title="Extract PDF Pages"
      description="Pull pages out of a PDF into a new document — the original file is untouched."
      pdf={pdf}
      primary={{ id: 'pdf-extract-button', label: 'Extract', busyLabel: 'Extracting…', busyKey: 'Extracted PDF', onClick: run }}
    >
      {pageListField({ id: 'pdf-extract-pages', label: 'Pages to extract', placeholder: 'e.g. 1,3', value: pages, onChange: setPages })}
    </PdfToolPage>
  )
}

export function RemoveTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-remove', initialFiles, onInitialFilesConsumed)
  const [pages, setPages] = useState('')
  const run = () => {
    const list = parsePageList(pages, pdf.pageCount)
    if (!list) {
      pdf.setError(opError('remove', pdf.pageCount))
      return
    }
    void pdf.runOp('Removed pages', JSON.stringify({ kind: 'remove', pages: list }), 'removed')
  }
  return (
    <PdfToolPage
      headingId="pdf-remove-heading"
      title="Remove PDF Pages"
      description="Delete pages from a PDF — the remaining pages keep their order."
      pdf={pdf}
      primary={{ id: 'pdf-remove-button', label: 'Remove', busyLabel: 'Removing…', busyKey: 'Removed pages', onClick: run }}
    >
      {pageListField({ id: 'pdf-remove-pages', label: 'Pages to remove', placeholder: 'e.g. 2', value: pages, onChange: setPages })}
    </PdfToolPage>
  )
}

export function ReorderTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-reorder', initialFiles, onInitialFilesConsumed)
  const [order, setOrder] = useState('')
  const run = () => {
    const parsed = parseReorder(order, pdf.pageCount)
    if (!parsed) {
      pdf.setError(`Reorder must list every page exactly once, e.g. "3,1,2" for a ${pdf.pageCount}-page PDF.`)
      return
    }
    void pdf.runOp('Reordered PDF', JSON.stringify({ kind: 'reorder', order: parsed }), 'reordered')
  }
  return (
    <PdfToolPage
      headingId="pdf-reorder-heading"
      title="Reorder PDF Pages"
      description="Put the pages in a new order — list every page exactly once."
      pdf={pdf}
      primary={{ id: 'pdf-reorder-button', label: 'Reorder', busyLabel: 'Reordering…', busyKey: 'Reordered PDF', onClick: run }}
    >
      {pageListField({
        id: 'pdf-reorder-order',
        label: 'New order',
        placeholder: `e.g. ${pdf.pageCount >= 3 ? '3,1,2' : '1'} (every page exactly once)`,
        value: order,
        onChange: setOrder,
      })}
    </PdfToolPage>
  )
}

export function DuplicateTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-duplicate', initialFiles, onInitialFilesConsumed)
  const [pages, setPages] = useState('')
  const run = () => {
    const list = parsePageList(pages, pdf.pageCount)
    if (!list) {
      pdf.setError(opError('duplicate', pdf.pageCount))
      return
    }
    void pdf.runOp('Duplicated pages', JSON.stringify({ kind: 'duplicate', pages: list }), 'duplicated')
  }
  return (
    <PdfToolPage
      headingId="pdf-duplicate-heading"
      title="Duplicate PDF Pages"
      description="Copy pages inside a PDF — each copy goes right after its original."
      pdf={pdf}
      primary={{ id: 'pdf-duplicate-button', label: 'Duplicate', busyLabel: 'Duplicating…', busyKey: 'Duplicated pages', onClick: run }}
    >
      {pageListField({ id: 'pdf-duplicate-pages', label: 'Pages to duplicate', placeholder: 'e.g. 1', value: pages, onChange: setPages })}
    </PdfToolPage>
  )
}

export function ReverseTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-reverse', initialFiles, onInitialFilesConsumed)
  const run = () => void pdf.runOp('Reversed PDF', '{"kind":"reverse"}', 'reversed')
  return (
    <PdfToolPage
      headingId="pdf-reverse-heading"
      title="Reverse PDF Pages"
      description="Flip the page order — the last page becomes the first. No settings needed."
      pdf={pdf}
      primary={{ id: 'pdf-reverse-button', label: 'Reverse order', busyLabel: 'Reversing…', busyKey: 'Reversed PDF', onClick: run }}
    />
  )
}

export function BookletTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-booklet', initialFiles, onInitialFilesConsumed)
  const run = () => void pdf.runOp('Booklet PDF', '{"kind":"booklet"}', 'booklet')
  return (
    <PdfToolPage
      headingId="pdf-booklet-heading"
      title="Booklet Layout"
      description="Reorder the pages into a booklet layout, ready to print and fold. No settings needed."
      pdf={pdf}
      primary={{ id: 'pdf-booklet-button', label: 'Make booklet', busyLabel: 'Making booklet…', busyKey: 'Booklet PDF', onClick: run }}
    />
  )
}

export function NupTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-nup', initialFiles, onInitialFilesConsumed)
  const [cols, setCols] = useState(2)
  const [rows, setRows] = useState(2)
  const run = () =>
    void pdf.runOp('N-up PDF', JSON.stringify({ kind: 'nup', cols, rows }), 'nup')
  return (
    <PdfToolPage
      headingId="pdf-nup-heading"
      title="N-up Layout"
      description="Put several pages on one sheet — pick how many columns and rows."
      pdf={pdf}
      primary={{ id: 'pdf-nup-button', label: 'Make N-up', busyLabel: 'Laying out…', busyKey: 'N-up PDF', onClick: run }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap">
        <Box>
          <Typography variant="subtitle2" component="label" htmlFor="pdf-nup-cols">
            Columns
          </Typography>
          <Select native id="pdf-nup-cols" value={cols} onChange={(e) => setCols(Number(e.target.value))} aria-label="N-up columns" sx={{ mt: 0.5, display: 'block' }}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n} columns</option>
            ))}
          </Select>
        </Box>
        <Box>
          <Typography variant="subtitle2" component="label" htmlFor="pdf-nup-rows">
            Rows
          </Typography>
          <Select native id="pdf-nup-rows" value={rows} onChange={(e) => setRows(Number(e.target.value))} aria-label="N-up rows" sx={{ mt: 0.5, display: 'block' }}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n} rows</option>
            ))}
          </Select>
        </Box>
      </Stack>
    </PdfToolPage>
  )
}

export function SplitTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const pdf = usePdfFile('pdf-split', initialFiles, onInitialFilesConsumed)
  const [ranges, setRanges] = useState('')
  const run = () => {
    const parsed = parsePageRanges(ranges, pdf.pageCount)
    if (!parsed) {
      pdf.setError('Check the split ranges — use e.g. "1-3,5-7" with pages 1–' + pdf.pageCount + '.')
      return
    }
    void pdf.runOp('Split PDF', JSON.stringify({ kind: 'split', ranges: parsed }), 'split')
  }
  return (
    <PdfToolPage
      headingId="pdf-split-heading"
      title="Split PDF"
      description="Split a PDF into separate documents — one output file per range."
      pdf={pdf}
      primary={{ id: 'pdf-split-button', label: 'Split', busyLabel: 'Splitting…', busyKey: 'Split PDF', onClick: run }}
    >
      {pageListField({ id: 'pdf-split-ranges', label: 'Page ranges', placeholder: 'e.g. 1-3,5-7', value: ranges, onChange: setRanges })}
      <Typography variant="caption" color="text.secondary">
        One output document per range — each gets its own download below.
      </Typography>
    </PdfToolPage>
  )
}
