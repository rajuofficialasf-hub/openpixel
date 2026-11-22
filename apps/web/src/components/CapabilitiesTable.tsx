import { useState } from 'react'
import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import {
  BROWSER_DECODABLE,
  BROWSER_ENCODABLE,
  CAPABILITIES,
  formatName,
} from '../lib/capabilities'
import { ToolPageHeader } from './ToolPage'
import { useI18n } from '../lib/use-i18n'

type Filter = 'all' | 'browser' | 'cli-only'

/**
 * Dashboard / overview: the full capability list, generated from the
 * engine registry (`src/data/capabilities.json` — see
 * `scripts/generate-capabilities.mjs`), with an honest "In browser"
 * column showing what the canvas path in this app can actually do.
 */
export function CapabilitiesTable() {
  const { t } = useI18n()
  const [filter, setFilter] = useState<Filter>('all')

  const rows = CAPABILITIES.filter((cap) => {
    if (filter === 'browser') {
      return BROWSER_DECODABLE.includes(cap.format_id) || BROWSER_ENCODABLE.includes(cap.format_id)
    }
    if (filter === 'cli-only') {
      return !BROWSER_DECODABLE.includes(cap.format_id) && !BROWSER_ENCODABLE.includes(cap.format_id)
    }
    return true
  })

  const browserNote = (formatId: string, canDecode: boolean, canEncode: boolean): string => {
    const decodes = BROWSER_DECODABLE.includes(formatId)
    const encodes = BROWSER_ENCODABLE.includes(formatId)
    if (decodes && encodes) return t('fmt.both')
    if (decodes) return t('fmt.decodeOnly')
    if (encodes) return t('fmt.encodeOnly')
    if (canDecode || canEncode) return t('fmt.engineOnly')
    return t('fmt.notImpl')
  }

  const codeSx = {
    fontFamily: 'monospace',
    fontSize: '0.85em',
    bgcolor: 'action.hover',
    px: 0.5,
    borderRadius: 0.5,
  }

  return (
    <Box component="section" aria-labelledby="formats-heading">
      <Stack spacing={3}>
        <ToolPageHeader
          headingId="formats-heading"
          title={t('fmt.title')}
          description={
            <>
              {t('fmt.descA')}{' '}
              <Box component="code" sx={codeSx}>
                npm run generate:capabilities
              </Box>{' '}
              {t('fmt.descB')}
              <Box component="code" sx={codeSx}>
                openpixel convert
              </Box>
              {t('fmt.descC')}
            </>
          }
        />

        <ToggleButtonGroup
          exclusive
          value={filter}
          onChange={(_, value: Filter | null) => {
            if (value) setFilter(value)
          }}
          aria-label={t('fmt.filterAria')}
        >
          <ToggleButton value="all" aria-label={t('fmt.all')}>
            {t('fmt.all')}
            <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.secondary', ml: 1 }}>
              {CAPABILITIES.length}
            </Box>
          </ToggleButton>
          <ToggleButton value="browser" aria-label={t('fmt.browser')}>
            {t('fmt.browser')}
          </ToggleButton>
          <ToggleButton value="cli-only" aria-label={t('fmt.cliOnly')}>
            {t('fmt.cliOnly')}
          </ToggleButton>
        </ToggleButtonGroup>

        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 720 }}>
            <TableHead>
              <TableRow>
                <TableCell>{t('fmt.colFormat')}</TableCell>
                <TableCell>{t('fmt.colExtensions')}</TableCell>
                <TableCell>{t('fmt.colDecode')}</TableCell>
                <TableCell>{t('fmt.colEncode')}</TableCell>
                <TableCell>{t('fmt.colAlpha')}</TableCell>
                <TableCell>{t('fmt.colAnimation')}</TableCell>
                <TableCell>{t('fmt.colBrowser')}</TableCell>
                <TableCell>{t('fmt.colStatus')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((cap) => (
                <TableRow key={cap.format_id}>
                  <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                    {formatName(cap.format_id)}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                    {cap.extensions.map((e) => `.${e}`).join(', ')}
                  </TableCell>
                  <TableCell sx={{ color: cap.can_decode ? 'text.secondary' : 'text.disabled' }}>
                    {cap.can_decode ? t('fmt.yes') : t('fmt.no')}
                  </TableCell>
                  <TableCell sx={{ color: cap.can_encode ? 'text.secondary' : 'text.disabled' }}>
                    {cap.can_encode ? t('fmt.yes') : t('fmt.no')}
                  </TableCell>
                  <TableCell sx={{ color: cap.supports_alpha ? 'text.secondary' : 'text.disabled' }}>
                    {cap.supports_alpha ? t('fmt.yes') : t('fmt.no')}
                  </TableCell>
                  <TableCell sx={{ color: cap.supports_animation ? 'text.secondary' : 'text.disabled' }}>
                    {cap.supports_animation ? t('fmt.yes') : t('fmt.no')}
                  </TableCell>
                  <TableCell sx={{ minWidth: 150 }}>{browserNote(cap.format_id, cap.can_decode, cap.can_encode)}</TableCell>
                  <TableCell sx={{ fontSize: '0.85em' }}>{cap.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="body2" color="text.secondary">
          {t('fmt.footer', { shown: rows.length, total: CAPABILITIES.length })}
        </Typography>
      </Stack>
    </Box>
  )
}
