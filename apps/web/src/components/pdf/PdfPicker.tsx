/**
 * PDF tools picker — the /pdf hub. One tool = one page: the
 * user picks a tool FIRST (this page), and only that tool's
 * focused page shows next. A PDF dropped here (or handed over
 * from the homepage) travels with the user to the picked tool —
 * except Image to PDF, which takes images, not a PDF.
 *
 * Web tools open their page; CLI-only tools show the exact
 * command (ToolCard dialog); coming-soon tools are labelled
 * and never look clickable.
 */
import { useMemo } from 'react'
import { Alert, Box, Grid, Stack, Typography } from '@mui/material'
import { TOOLS, type RouteId } from '../../lib/routes'
import { DropZone } from '../DropZone'
import { ToolCard } from '../ToolCard'
import { ToolPageHeader } from '../ToolPage'
import { PdfFileSummary } from './shared'
import { usePdfFile, type PdfToolProps } from './usePdfFile'

const STATUS_RANK = { web: 0, 'cli-only': 1, 'coming-soon': 2 } as const

interface PdfPickerProps extends PdfToolProps {
  onNavigate: (route: RouteId, opts?: { files?: File[] }) => void
}

export function PdfPicker({ initialFiles, onInitialFilesConsumed, onNavigate }: PdfPickerProps) {
  const pdf = usePdfFile('pdf', initialFiles, onInitialFilesConsumed)

  const pdfTools = useMemo(
    () =>
      TOOLS.filter((t) => t.categories.includes('pdf')).sort(
        (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
      ),
    [],
  )

  const openTool = (route: RouteId) => {
    // Image to PDF takes images, not a PDF — never hand it one.
    if (route === 'pdf-images-to-pdf') {
      onNavigate(route)
      return
    }
    if (pdf.file) onNavigate(route, { files: [pdf.file] })
    else onNavigate(route)
  }

  return (
    <Box component="section" aria-labelledby="pdf-heading">
      <Stack spacing={3}>
        <ToolPageHeader
          headingId="pdf-heading"
          title="PDF tools"
          description="Pick a tool first — then drop your PDF on that tool's page. Everything runs in your browser; nothing is uploaded."
        />

        {!pdf.file ? (
          <DropZone
            inputId="pdf-file"
            label="Drop a PDF here — it travels with you to the tool you pick"
            hint="Optional: you can also upload on the tool's own page. One PDF at a time."
            chooseLabel="Choose a PDF"
            multiple={false}
            accept="application/pdf,.pdf"
            compact
            onFiles={(files) => void pdf.handleFiles(files)}
          />
        ) : (
          <>
            <PdfFileSummary pdf={pdf} />
            <Typography variant="body2" color="text.secondary">
              This file will go with you to the tool you pick below.
            </Typography>
          </>
        )}

        {pdf.loading && (
          <Typography role="status" variant="body2" color="text.secondary">
            Reading PDF…
          </Typography>
        )}
        {pdf.error && <Alert severity="error">{pdf.error}</Alert>}

        <Grid container spacing={2}>
          {pdfTools.map((tool) => (
            <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <ToolCard tool={tool} onNavigate={openTool} />
            </Grid>
          ))}
        </Grid>

        <Box
          role="status"
          sx={{
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            p: 3,
          }}
        >
          <Typography variant="body2">
            Insert and replace pages need the native CLI or desktop app — they are not available in the browser.
            Rendering with PDFium is CLI/desktop-only too (<Typography component="code" variant="body2">openpixel pdf render</Typography>).
            Office documents (Word, Excel, PowerPoint) convert only in the CLI or desktop app (
            <Typography component="code" variant="body2">openpixel doc convert</Typography>) — LibreOffice cannot
            run in a browser.
          </Typography>
        </Box>
      </Stack>
    </Box>
  )
}
