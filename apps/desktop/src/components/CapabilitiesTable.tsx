import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { FormatCapability } from '../lib/tauri'

interface CapabilitiesTableProps {
  capabilities: FormatCapability[]
}

/**
 * Format capability dashboard. The data comes live from the engine
 * registry (`get_capabilities`) on every launch — nothing here is
 * hand-written, so it cannot drift from what the engine can do.
 */
export function CapabilitiesTable({ capabilities }: CapabilitiesTableProps) {
  const decodable = capabilities.filter((c) => c.can_decode).length
  const encodable = capabilities.filter((c) => c.can_encode).length

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {capabilities.length} formats known to the engine · {decodable} decodable · {encodable}{' '}
        encodable. This list is read from the engine registry when the app starts, so it always
        matches the CLI (<code>openpixel formats</code>).
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Format</TableCell>
              <TableCell>Extensions</TableCell>
              <TableCell>Decode</TableCell>
              <TableCell>Encode</TableCell>
              <TableCell>Alpha</TableCell>
              <TableCell>Animation</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {capabilities.map((c) => (
              <TableRow key={c.format_id}>
                <TableCell sx={{ fontWeight: 600 }}>{c.format_id.toUpperCase()}</TableCell>
                <TableCell>.{c.extensions.join(', .')}</TableCell>
                <TableCell>{c.can_decode ? '✓' : '—'}</TableCell>
                <TableCell>{c.can_encode ? '✓' : '—'}</TableCell>
                <TableCell>{c.supports_alpha ? '✓' : '—'}</TableCell>
                <TableCell>{c.supports_animation ? '✓' : '—'}</TableCell>
                <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                  {c.status}
                  {c.native_dependency ? ` · needs ${c.native_dependency}` : ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">
        Not convertible anywhere yet: HEIC / HEIF, APNG, RAW, PSD (planned in the engine, reported
        as such by the CLI and by this app). SVG rasterises to an image but cannot be an output.
      </Typography>
    </Box>
  )
}
