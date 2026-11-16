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
  formatLabel,
} from '../lib/capabilities'

type Filter = 'all' | 'browser' | 'cli-only'

/**
 * Dashboard / overview: the full capability list, generated from the
 * engine registry (`src/data/capabilities.json` — see
 * `scripts/generate-capabilities.mjs`), with an honest "In browser"
 * column showing what the canvas path in this app can actually do.
 */
export function CapabilitiesTable() {
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
    if (decodes && encodes) return 'Decode + encode'
    if (decodes) return 'Decode only'
    if (encodes) return 'Encode only'
    if (canDecode || canEncode) return 'Engine only — use the CLI'
    return 'Not implemented'
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
      <Stack spacing={2}>
        <Typography variant="h5" component="h2" id="formats-heading">
          Format capabilities
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Generated from the Rust engine’s registry — run{' '}
          <Box component="code" sx={codeSx}>
            npm run generate:capabilities
          </Box>{' '}
          to regenerate it after any engine change. The “In browser” column is what this web app
          can do; everything else needs the native CLI ({' '}
          <Box component="code" sx={codeSx}>
            openpixel convert
          </Box>
          ) or the desktop app.
        </Typography>

        <ToggleButtonGroup
          exclusive
          value={filter}
          onChange={(_, value: Filter | null) => {
            if (value) setFilter(value)
          }}
          aria-label="Filter formats"
        >
          <ToggleButton value="all" aria-label="All formats">
            All formats ({CAPABILITIES.length})
          </ToggleButton>
          <ToggleButton value="browser" aria-label="Works in this browser">
            Works in this browser
          </ToggleButton>
          <ToggleButton value="cli-only" aria-label="CLI / desktop only">
            CLI / desktop only
          </ToggleButton>
        </ToggleButtonGroup>

        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 720 }}>
            <TableHead>
              <TableRow>
                <TableCell>Format</TableCell>
                <TableCell>Extensions</TableCell>
                <TableCell>Engine decode</TableCell>
                <TableCell>Engine encode</TableCell>
                <TableCell>Alpha</TableCell>
                <TableCell>Animation</TableCell>
                <TableCell>In browser</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((cap) => (
                <TableRow key={cap.format_id}>
                  <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                    {formatLabel(cap.format_id)}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                    {cap.extensions.map((e) => `.${e}`).join(', ')}
                  </TableCell>
                  <TableCell>{cap.can_decode ? 'Yes' : 'No'}</TableCell>
                  <TableCell>{cap.can_encode ? 'Yes' : 'No'}</TableCell>
                  <TableCell>{cap.supports_alpha ? 'Yes' : 'No'}</TableCell>
                  <TableCell>{cap.supports_animation ? 'Yes' : 'No'}</TableCell>
                  <TableCell>{browserNote(cap.format_id, cap.can_decode, cap.can_encode)}</TableCell>
                  <TableCell sx={{ fontSize: '0.85em' }}>{cap.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="body2" color="text.secondary">
          Showing {rows.length} of {CAPABILITIES.length} formats. HEIC/HEIF, APNG, RAW and PSD are
          planned in the engine and not convertible anywhere yet — the CLI reports them the same way.
        </Typography>
      </Stack>
    </Box>
  )
}
