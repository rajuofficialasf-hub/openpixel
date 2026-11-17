/**
 * Workspace (prompt §12–13): dashboard, My Files, Recent Files.
 *
 * Everything here reads the local activity history
 * (`lib/activity.ts`) — file names, sizes, types, tools and dates
 * only. There is no server and no stored file content, so there
 * is no download or preview of an old file: the honest actions
 * are "open the tool again" and "remove from history". Empty
 * until the user processes something — never invented files.
 */
import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import DeleteIcon from '@mui/icons-material/Delete'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import GridViewIcon from '@mui/icons-material/GridView'
import ViewListIcon from '@mui/icons-material/ViewList'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import {
  activityStoreBytes,
  formatBytes,
  formatDate,
  loadActivity,
  removeActivity,
  toggleStar,
  type ActivityEntry,
} from '../lib/activity'
import { ROUTE_TITLES, type RouteId } from '../lib/routes'

interface WorkspaceProps {
  onNavigate: (route: RouteId) => void
}

function typeLabel(fileType: string): string {
  if (!fileType) return 'File'
  const lower = fileType.toLowerCase()
  if (lower.startsWith('image/')) return lower.slice(6).toUpperCase()
  if (lower === 'application/pdf' || lower === 'pdf') return 'PDF'
  if (lower.includes('word') || lower.endsWith('.docx')) return 'DOCX'
  if (lower.includes('sheet') || lower.endsWith('.xlsx')) return 'XLSX'
  if (lower.startsWith('text/')) return 'Text'
  return fileType
}

function toolLabel(route: string): string {
  return ROUTE_TITLES[route as RouteId]?.title ?? route
}

function useEntries() {
  const [entries, setEntries] = useState<ActivityEntry[]>(() => loadActivity())
  const refresh = () => setEntries(loadActivity())
  return { entries, refresh }
}

export function WorkspaceDashboard({ onNavigate }: WorkspaceProps) {
  const { entries, refresh } = useEntries()
  const totalFiles = entries.length
  const toolsUsed = new Set(entries.map((e) => e.tool)).size
  const last = entries[0]
  const storeBytes = activityStoreBytes()

  const recent = entries.slice(0, 8)

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h2" id="workspace-heading">
          Welcome back
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          Your workspace on this device. Everything below comes from files you processed here — nothing is
          uploaded, and nothing is invented.
        </Typography>
      </Box>

      <Grid container spacing={2}>
        {[
          { label: 'Total files processed', value: String(totalFiles) },
          { label: 'Tools used', value: String(toolsUsed) },
          { label: 'History stored', value: formatBytes(storeBytes) },
          { label: 'Last activity', value: last ? formatDate(last.at) : '—' },
        ].map((card) => (
          <Grid key={card.label} size={{ xs: 6, lg: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  {card.label}
                </Typography>
                <Typography variant="h5" component="p" sx={{ mt: 0.5 }}>
                  {card.value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Box component="section" aria-labelledby="workspace-recent-heading">
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6" component="h3" id="workspace-recent-heading">
            Recent files
          </Typography>
          <Button size="small" onClick={() => onNavigate('recent')}>
            View all
          </Button>
        </Box>
        {recent.length === 0 ? (
          <EmptyHistory onNavigate={onNavigate} />
        ) : (
          <TableContainer component={Card}>
            <Table size="small" aria-label="Recent files">
              <TableHead>
                <TableRow>
                  <TableCell>File name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell>Tool</TableCell>
                  <TableCell>Last modified</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recent.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.fileName}</TableCell>
                    <TableCell>{typeLabel(e.fileType)}</TableCell>
                    <TableCell>{formatBytes(e.fileSize)}</TableCell>
                    <TableCell>{toolLabel(e.tool)}</TableCell>
                    <TableCell>{formatDate(e.at)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => onNavigate(e.tool as RouteId)}>
                        Open tool
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <Box component="section" aria-labelledby="workspace-activity-heading">
        <Typography variant="h6" component="h3" id="workspace-activity-heading" sx={{ mb: 1 }}>
          Recent activity
        </Typography>
        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No activity yet — process a file and it will show up here.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {entries.slice(0, 8).map((e) => (
              <Box key={e.id} sx={{ display: 'flex', gap: 2, alignItems: 'baseline' }}>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 150 }}>
                  {formatDate(e.at)}
                </Typography>
                <Typography variant="body2">
                  {e.fileName} — {toolLabel(e.tool)}: {e.result}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      <Box component="section" aria-labelledby="workspace-storage-heading">
        <Typography variant="h6" component="h3" id="workspace-storage-heading" sx={{ mb: 1 }}>
          Storage
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Your files are never stored on this device — only their names, sizes and results are remembered, using{' '}
          {formatBytes(storeBytes)} of browser storage. Clear it any time in Settings.
        </Typography>
        <Button
          size="small"
          sx={{ mt: 1 }}
          onClick={() => {
            if (window.confirm('Clear the whole activity history on this device?')) {
              localStorage.removeItem('openpixel.activity.v1')
              refresh()
            }
          }}
        >
          Clear history
        </Button>
      </Box>
    </Stack>
  )
}

function EmptyHistory({ onNavigate }: { onNavigate: (route: RouteId) => void }) {
  return (
    <Card>
      <CardContent sx={{ textAlign: 'center', py: 5 }}>
        <FolderOpenIcon color="action" sx={{ fontSize: 40 }} />
        <Typography variant="subtitle1" sx={{ mt: 1 }}>
          No files yet
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto', mt: 0.5 }}>
          Process a file — convert an image, compress a PDF, run OCR — and it will appear here with its name,
          size and result.
        </Typography>
        <Button variant="contained" sx={{ mt: 2 }} onClick={() => onNavigate('convert')}>
          Convert an image
        </Button>
      </CardContent>
    </Card>
  )
}

export function MyFilesPage({ onNavigate }: WorkspaceProps) {
  const { entries, refresh } = useEntries()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'pdf' | 'other'>('all')
  const [sort, setSort] = useState<'date' | 'size' | 'name'>('date')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = entries.filter((e) => !q || e.fileName.toLowerCase().includes(q))
    if (typeFilter === 'image') list = list.filter((e) => e.fileType.startsWith('image/'))
    else if (typeFilter === 'pdf') list = list.filter((e) => e.fileType === 'application/pdf' || e.fileType === 'pdf')
    else if (typeFilter === 'other')
      list = list.filter((e) => !e.fileType.startsWith('image/') && e.fileType !== 'application/pdf')
    const sorted = [...list]
    if (sort === 'date') sorted.sort((a, b) => b.at - a.at)
    else if (sort === 'size') sorted.sort((a, b) => b.fileSize - a.fileSize)
    else sorted.sort((a, b) => a.fileName.localeCompare(b.fileName))
    return sorted
  }, [entries, query, typeFilter, sort])

  const remove = (id: string) => {
    removeActivity(id)
    refresh()
  }
  const star = (id: string) => {
    toggleStar(id)
    refresh()
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h2" id="files-heading">
          My Files
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          Files you processed on this device. Only names, sizes and results are kept — the files themselves are
          not stored, so open the tool again to process a file once more.
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search by file name…"
          aria-label="Search files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: 1, minWidth: 200 }}
        />
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel id="files-type-label">Type</InputLabel>
          <Select labelId="files-type-label" label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
            <MenuItem value="all">All types</MenuItem>
            <MenuItem value="image">Images</MenuItem>
            <MenuItem value="pdf">PDFs</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel id="files-sort-label">Sort</InputLabel>
          <Select labelId="files-sort-label" label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <MenuItem value="date">Newest first</MenuItem>
            <MenuItem value="size">Largest first</MenuItem>
            <MenuItem value="name">Name A–Z</MenuItem>
          </Select>
        </FormControl>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(_, next) => next && setView(next)}
          aria-label="File view"
          size="small"
        >
          <ToggleButton value="grid" aria-label="Grid view">
            <GridViewIcon />
          </ToggleButton>
          <ToggleButton value="list" aria-label="List view">
            <ViewListIcon />
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {filtered.length === 0 ? (
        <EmptyHistory onNavigate={onNavigate} />
      ) : view === 'grid' ? (
        <Grid container spacing={2}>
          {filtered.map((e) => (
            <Grid key={e.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.fileName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {typeLabel(e.fileType)} · {formatBytes(e.fileSize)} · {formatDate(e.at)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {toolLabel(e.tool)}: {e.result}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      aria-label={e.starred ? `Unstar ${e.fileName}` : `Star ${e.fileName}`}
                      onClick={() => star(e.id)}
                    >
                      {e.starred ? <StarIcon color="primary" /> : <StarBorderIcon />}
                    </IconButton>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                    <Button size="small" startIcon={<OpenInNewIcon />} onClick={() => onNavigate(e.tool as RouteId)}>
                      Open tool
                    </Button>
                    <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => remove(e.id)}>
                      Remove
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        <TableContainer component={Card}>
          <Table size="small" aria-label="My files">
            <TableHead>
              <TableRow>
                <TableCell>File name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Tool</TableCell>
                <TableCell>Last modified</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.fileName}</TableCell>
                  <TableCell>{typeLabel(e.fileType)}</TableCell>
                  <TableCell>{formatBytes(e.fileSize)}</TableCell>
                  <TableCell>{toolLabel(e.tool)}</TableCell>
                  <TableCell>{formatDate(e.at)}</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" aria-label={`Star ${e.fileName}`} onClick={() => star(e.id)}>
                      {e.starred ? <StarIcon color="primary" fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                    </IconButton>
                    <IconButton size="small" aria-label={`Remove ${e.fileName}`} onClick={() => remove(e.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {filtered.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {filtered.length} file{filtered.length === 1 ? '' : 's'} · starred files are marked with a star.
        </Typography>
      )}
    </Stack>
  )
}

export function RecentFilesPage({ onNavigate }: WorkspaceProps) {
  const { entries } = useEntries()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => !q || e.fileName.toLowerCase().includes(q) || toolLabel(e.tool).toLowerCase().includes(q))
  }, [entries, query])

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h2" id="recent-heading">
          Recent Files
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          Everything you processed recently, newest first.
        </Typography>
      </Box>
      <TextField
        size="small"
        placeholder="Search files or tools…"
        aria-label="Search recent files"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ maxWidth: 360 }}
      />
      {filtered.length === 0 ? (
        <EmptyHistory onNavigate={onNavigate} />
      ) : (
        <TableContainer component={Card}>
          <Table size="small" aria-label="Recent files">
            <TableHead>
              <TableRow>
                <TableCell>File name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Tool</TableCell>
                <TableCell>Result</TableCell>
                <TableCell>Last modified</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.fileName}</TableCell>
                  <TableCell>{typeLabel(e.fileType)}</TableCell>
                  <TableCell>{formatBytes(e.fileSize)}</TableCell>
                  <TableCell>{toolLabel(e.tool)}</TableCell>
                  <TableCell>{e.result}</TableCell>
                  <TableCell>{formatDate(e.at)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => onNavigate(e.tool as RouteId)}>
                      Open tool
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  )
}
