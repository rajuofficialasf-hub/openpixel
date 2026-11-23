/**
 * PDF tools picker — the /pdf hub.
 *
 * Organized into 4 clear task groups (Organize, Convert, Compress &
 * Edit, Clean & Repair) plus a live search box so users can find any
 * of the 20+ PDF tools in seconds instead of scanning one flat wall.
 * A PDF dropped here travels with the user to the picked tool.
 */
import { useMemo, useState } from 'react'
import { Alert, Box, Grid, Stack, TextField, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { searchTools, TOOLS, type RouteId, type ToolEntry } from '../../lib/routes'
import { DropZone } from '../DropZone'
import { ToolCard } from '../ToolCard'
import { ToolPageHeader } from '../ToolPage'
import { useI18n } from '../../lib/use-i18n'
import { PdfFileSummary } from './shared'
import { usePdfFile, type PdfToolProps } from './usePdfFile'

interface PdfPickerProps extends PdfToolProps {
  onNavigate: (route: RouteId, opts?: { files?: File[] }) => void
}

interface PdfGroup {
  id: string
  titleKey: string
  subKey: string
  toolIds: string[]
}

const PDF_GROUPS: PdfGroup[] = [
  {
    id: 'organize',
    titleKey: 'pdf.groupOrganize',
    subKey: 'pdf.groupOrganizeSub',
    toolIds: [
      'pdf-merge',
      'pdf-split',
      'pdf-rotate',
      'pdf-extract',
      'pdf-remove',
      'pdf-reorder',
      'pdf-duplicate',
      'pdf-reverse',
      'pdf-booklet',
      'pdf-nup',
    ],
  },
  {
    id: 'convert',
    titleKey: 'pdf.groupConvert',
    subKey: 'pdf.groupConvertSub',
    toolIds: ['pdf-to-image', 'image-to-pdf', 'pdf-text'],
  },
  {
    id: 'edit',
    titleKey: 'pdf.groupEdit',
    subKey: 'pdf.groupEditSub',
    toolIds: ['pdf-compress', 'pdf-edit', 'pdf-redact', 'pdf-metadata'],
  },
  {
    id: 'clean',
    titleKey: 'pdf.groupClean',
    subKey: 'pdf.groupCleanSub',
    toolIds: ['pdf-sanitize', 'pdf-flatten', 'pdf-repair'],
  },
]

export function PdfPicker({ initialFiles, onInitialFilesConsumed, onNavigate }: PdfPickerProps) {
  const { t, lang } = useI18n()
  const pdf = usePdfFile('pdf', initialFiles, onInitialFilesConsumed)
  const [query, setQuery] = useState('')

  const pdfToolMap = useMemo(() => {
    const map = new Map<string, ToolEntry>()
    for (const tool of TOOLS) {
      if (tool.categories.includes('pdf')) map.set(tool.id, tool)
    }
    return map
  }, [])

  const cliPdfTools = useMemo(
    () => TOOLS.filter((tool) => tool.categories.includes('pdf') && tool.status !== 'web'),
    [],
  )

  const searchResults = useMemo(() => {
    if (!query.trim()) return null
    return searchTools(query, lang).filter((tool) => tool.categories.includes('pdf'))
  }, [query, lang])

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
    <Box component="section" aria-labelledby="pdf-heading" sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}>
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, flex: 'none', minWidth: 0 }}>
          <Box sx={{ minWidth: 0, flex: '1 1 260px' }}>
            <ToolPageHeader
              headingId="pdf-heading"
              title="PDF tools"
              description={t('pdf.pickerDesc')}
            />
          </Box>
          <TextField
            size="small"
            placeholder={t('pdf.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            inputProps={{ 'aria-label': t('pdf.searchPlaceholder') }}
            slotProps={{
              input: {
                startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} />,
              },
            }}
            sx={{ width: { xs: '100%', md: 320 } }}
          />
        </Box>

        {!pdf.file ? (
          <DropZone
            inputId="pdf-file"
            label={t('pdf.pickerDropLabel')}
            hint={t('pdf.pickerDropHint')}
            chooseLabel={t('common.choosePdf')}
            multiple={false}
            accept="application/pdf,.pdf"
            compact
            onFiles={(files) => void pdf.handleFiles(files)}
          />
        ) : (
          <>
            <PdfFileSummary pdf={pdf} />
            <Typography variant="caption" color="text.secondary">
              {t('pdf.pickerTravels')}
            </Typography>
          </>
        )}

        {pdf.loading && (
          <Typography role="status" variant="body2" color="text.secondary">
            {t('common.readingPdf')}
          </Typography>
        )}
        {pdf.error && <Alert severity="error">{pdf.error}</Alert>}

        <Box sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, overflowY: { lg: 'auto' }, pr: { lg: 0.5 } }}>
        {searchResults ? (
          searchResults.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('tools.noMatch')}
            </Typography>
          ) : (
            <Grid container spacing={1.5}>
              {searchResults.map((tool) => (
                <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 4, xl: 3 }}>
                  <ToolCard tool={tool} onNavigate={openTool} />
                </Grid>
              ))}
            </Grid>
          )
        ) : (
          <Stack spacing={2.5}>
            {PDF_GROUPS.map((group) => {
              const items = group.toolIds
                .map((id) => pdfToolMap.get(id))
                .filter((item): item is ToolEntry => item !== undefined)
              return (
                <Box key={group.id} component="section" aria-labelledby={`pdf-group-${group.id}`}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
                    <Typography variant="subtitle1" component="h3" fontWeight={600} id={`pdf-group-${group.id}`}>
                      {t(group.titleKey)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(group.subKey)}
                    </Typography>
                  </Box>
                  <Grid container spacing={1.5}>
                    {items.map((tool) => (
                      <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 4, xl: 3 }}>
                        <ToolCard tool={tool} onNavigate={openTool} />
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              )
            })}

            {cliPdfTools.length > 0 && (
              <Box component="section" aria-labelledby="pdf-group-cli">
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle1" component="h3" fontWeight={600} id="pdf-group-cli">
                    {t('pdf.groupCli')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('pdf.groupCliSub')}
                  </Typography>
                </Box>
                <Grid container spacing={1.5}>
                  {cliPdfTools.map((tool) => (
                    <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 4, xl: 3 }}>
                      <ToolCard tool={tool} onNavigate={openTool} />
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}
          </Stack>
        )}
        </Box>
      </Stack>
    </Box>
  )
}
