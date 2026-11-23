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
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import DownloadIcon from '@mui/icons-material/Download'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import GridViewIcon from '@mui/icons-material/GridView'
import ViewListIcon from '@mui/icons-material/ViewList'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import {
  activityStoreBytes,
  clearActivity,
  formatActivityResult,
  formatBytes,
  formatDate,
  loadActivity,
  removeActivity,
  toggleStar,
  type ActivityEntry,
} from '../lib/activity'
import { clearStashedFiles, getStashedFile, listStashedSummary } from '../lib/file-stash'
import { ROUTE_TITLES, type RouteId } from '../lib/routes'
import { plural } from '../lib/i18n'
import { useI18n } from '../lib/use-i18n'
import { useNavigation } from './layout/navigation'

interface WorkspaceProps {
  onNavigate: (route: RouteId) => void
}

function triggerFileDownload(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function typeLabel(fileType: string, lang: 'en' | 'bn' = 'en'): string {
  if (!fileType) return lang === 'bn' ? 'ফাইল' : 'File'
  const lower = fileType.toLowerCase()
  if (lower.startsWith('image/')) return lower.slice(6).toUpperCase()
  if (lower === 'application/pdf' || lower === 'pdf') return 'PDF'
  if (lower.includes('word') || lower.endsWith('.docx')) return 'DOCX'
  if (lower.includes('sheet') || lower.endsWith('.xlsx')) return 'XLSX'
  if (lower.startsWith('text/')) return lang === 'bn' ? 'লেখা' : 'Text'
  return fileType
}

function toolLabel(route: string): string {
  return ROUTE_TITLES[route as RouteId]?.title ?? route
}

function useEntries() {
  const [entries, setEntries] = useState<ActivityEntry[]>(() => loadActivity())
  const [cachedIds, setCachedIds] = useState<Set<string>>(() => new Set())
  const [cachedBytes, setCachedBytes] = useState(0)

  const refreshCache = useCallback(() => {
    void listStashedSummary().then(({ ids, totalBytes }) => {
      setCachedIds(ids)
      setCachedBytes(totalBytes)
    })
  }, [])

  useEffect(() => {
    refreshCache()
  }, [refreshCache])

  const refresh = useCallback(() => {
    setEntries(loadActivity())
    refreshCache()
  }, [refreshCache])

  return { entries, cachedIds, cachedBytes, refresh }
}

export function WorkspaceDashboard({ onNavigate }: WorkspaceProps) {
  const { t, lang } = useI18n()
  const { navigate } = useNavigation()
  const { entries, cachedIds, cachedBytes, refresh } = useEntries()
  const totalFiles = entries.length
  const toolsUsed = new Set(entries.map((e) => e.tool)).size
  const last = entries[0]
  const storeBytes = activityStoreBytes()

  const recent = entries.slice(0, 8)

  const handleRedownload = async (id: string) => {
    const file = await getStashedFile(id)
    if (file) triggerFileDownload(file)
  }

  const handleReuse = async (entry: ActivityEntry) => {
    const file = await getStashedFile(entry.id)
    if (file) navigate(entry.tool as RouteId, { files: [file] })
    else onNavigate(entry.tool as RouteId)
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h2" id="workspace-heading">
          {t('ws.welcome')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          {t('ws.intro')}
        </Typography>
      </Box>

      <Grid container spacing={2}>
        {[
          { label: t('ws.statTotal'), value: String(totalFiles) },
          { label: t('ws.statTools'), value: String(toolsUsed) },
          { label: t('ws.statHistory'), value: formatBytes(storeBytes) },
          { label: t('ws.statLast'), value: last ? formatDate(last.at, lang) : '—' },
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
            {t('ws.recentFiles')}
          </Typography>
          <Button size="small" onClick={() => onNavigate('recent')}>
            {t('ws.viewAll')}
          </Button>
        </Box>
        {recent.length === 0 ? (
          <EmptyHistory onNavigate={onNavigate} />
        ) : (
          <TableContainer component={Card}>
            <Table size="small" aria-label={t('ws.ariaRecent')}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('ws.fileName')}</TableCell>
                  <TableCell>{t('ws.fileType')}</TableCell>
                  <TableCell>{t('ws.fileSize')}</TableCell>
                  <TableCell>{t('ws.fileTool')}</TableCell>
                  <TableCell>{t('ws.lastModified')}</TableCell>
                  <TableCell align="right">{t('ws.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recent.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.fileName}</TableCell>
                    <TableCell>{typeLabel(e.fileType, lang)}</TableCell>
                    <TableCell>{formatBytes(e.fileSize)}</TableCell>
                    <TableCell>{toolLabel(e.tool)}</TableCell>
                    <TableCell>{formatDate(e.at, lang)}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        {cachedIds.has(e.id) && (
                          <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 15 }} />} onClick={() => void handleRedownload(e.id)}>
                            {t('ws.redownload')}
                          </Button>
                        )}
                        <Button size="small" onClick={() => void handleReuse(e)}>
                          {cachedIds.has(e.id) ? t('ws.openWithFile') : t('common.openTool')}
                        </Button>
                      </Stack>
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
          {t('ws.recentActivity')}
        </Typography>
        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('ws.noActivity')}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {entries.slice(0, 8).map((e) => (
              <Box key={e.id} sx={{ display: 'flex', gap: 2, alignItems: 'baseline' }}>
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 150 }}>
                  {formatDate(e.at, lang)}
                </Typography>
                <Typography variant="body2">
                  {e.fileName} — {toolLabel(e.tool)}: {formatActivityResult(lang, e)}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      <Box component="section" aria-labelledby="workspace-storage-heading">
        <Typography variant="h6" component="h3" id="workspace-storage-heading" sx={{ mb: 1 }}>
          {t('ws.storage')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('ws.storageText', { bytes: formatBytes(storeBytes) })}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('ws.cachedStorage', { bytes: formatBytes(cachedBytes) })}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
          {cachedBytes > 0 && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                void clearStashedFiles().then(refresh)
              }}
            >
              {t('ws.clearCache')}
            </Button>
          )}
          <Button
            size="small"
            onClick={() => {
              if (window.confirm(t('ws.clearConfirm'))) {
                clearActivity()
                refresh()
              }
            }}
          >
            {t('common.clearHistory')}
          </Button>
        </Stack>
      </Box>
    </Stack>
  )
}

function EmptyHistory({ onNavigate }: { onNavigate: (route: RouteId) => void }) {
  const { t } = useI18n()
  return (
    <Card>
      <CardContent sx={{ textAlign: 'center', py: 4 }}>
        <FolderOpenIcon color="action" sx={{ fontSize: 40 }} />
        <Typography variant="subtitle1" sx={{ mt: 1 }}>
          {t('ws.noFiles')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto', mt: 0.5 }}>
          {t('ws.noFilesText')}
        </Typography>
        <Button variant="contained" sx={{ mt: 2 }} onClick={() => onNavigate('convert')}>
          {t('ws.convertImage')}
        </Button>
      </CardContent>
    </Card>
  )
}

export function MyFilesPage({ onNavigate }: WorkspaceProps) {
  const { t, lang } = useI18n()
  const { navigate } = useNavigation()
  const { entries, cachedIds, refresh } = useEntries()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'pdf' | 'other'>('all')
  const [sort, setSort] = useState<'date' | 'size' | 'name'>('date')

  const handleRedownload = async (id: string) => {
    const file = await getStashedFile(id)
    if (file) triggerFileDownload(file)
  }

  const handleReuse = async (entry: ActivityEntry) => {
    const file = await getStashedFile(entry.id)
    if (file) navigate(entry.tool as RouteId, { files: [file] })
    else onNavigate(entry.tool as RouteId)
  }

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
          {t('ws.myFiles')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          {t('ws.myFilesIntro')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder={t('ws.searchFiles')}
          inputProps={{ 'aria-label': t('ws.ariaSearchFiles') }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: 1, minWidth: 200 }}
        />
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel id="files-type-label">{t('ws.type')}</InputLabel>
          <Select labelId="files-type-label" label={t('ws.type')} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
            <MenuItem value="all">{t('ws.allTypes')}</MenuItem>
            <MenuItem value="image">{t('ws.images')}</MenuItem>
            <MenuItem value="pdf">{t('ws.pdfs')}</MenuItem>
            <MenuItem value="other">{t('ws.other')}</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel id="files-sort-label">{t('tools.sort')}</InputLabel>
          <Select labelId="files-sort-label" label={t('tools.sort')} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <MenuItem value="date">{t('ws.newest')}</MenuItem>
            <MenuItem value="size">{t('ws.largest')}</MenuItem>
            <MenuItem value="name">{t('ws.nameAz')}</MenuItem>
          </Select>
        </FormControl>
        <ToggleButtonGroup
          value={view}
          exclusive
          onChange={(_, next) => next && setView(next)}
          aria-label={t('ws.ariaFileView')}
          size="small"
        >
          <ToggleButton value="grid" aria-label={t('ws.ariaGrid')}>
            <GridViewIcon />
          </ToggleButton>
          <ToggleButton value="list" aria-label={t('ws.ariaList')}>
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
                        {typeLabel(e.fileType, lang)} · {formatBytes(e.fileSize)} · {formatDate(e.at, lang)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {toolLabel(e.tool)}: {formatActivityResult(lang, e)}
                      </Typography>
                      {cachedIds.has(e.id) && (
                        <Chip
                          size="small"
                          color="success"
                          variant="outlined"
                          label={t('ws.cachedBadge')}
                          sx={{ mt: 0.75, height: 22, fontSize: '0.7rem' }}
                        />
                      )}
                    </Box>
                    <IconButton
                      size="small"
                      aria-label={e.starred ? t('ws.ariaUnstar', { name: e.fileName }) : t('ws.ariaStar', { name: e.fileName })}
                      onClick={() => star(e.id)}
                    >
                      {e.starred ? <StarIcon color="primary" /> : <StarBorderIcon />}
                    </IconButton>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                    {cachedIds.has(e.id) && (
                      <Button size="small" variant="contained" startIcon={<DownloadIcon />} onClick={() => void handleRedownload(e.id)}>
                        {t('ws.redownload')}
                      </Button>
                    )}
                    <Button size="small" startIcon={<OpenInNewIcon />} onClick={() => void handleReuse(e)}>
                      {cachedIds.has(e.id) ? t('ws.openWithFile') : t('common.openTool')}
                    </Button>
                    <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => remove(e.id)}>
                      {t('common.remove')}
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        <TableContainer component={Card}>
          <Table size="small" aria-label={t('ws.ariaMyFiles')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('ws.fileName')}</TableCell>
                <TableCell>{t('ws.fileType')}</TableCell>
                <TableCell>{t('ws.fileSize')}</TableCell>
                <TableCell>{t('ws.fileTool')}</TableCell>
                <TableCell>{t('ws.lastModified')}</TableCell>
                <TableCell align="right">{t('ws.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.fileName}</TableCell>
                  <TableCell>{typeLabel(e.fileType, lang)}</TableCell>
                  <TableCell>{formatBytes(e.fileSize)}</TableCell>
                  <TableCell>{toolLabel(e.tool)}</TableCell>
                  <TableCell>{formatDate(e.at, lang)}</TableCell>
                  <TableCell align="right">
                    {cachedIds.has(e.id) && (
                      <IconButton size="small" aria-label={t('ws.redownload')} onClick={() => void handleRedownload(e.id)}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    )}
                    <IconButton
                      size="small"
                      aria-label={e.starred ? t('ws.ariaUnstar', { name: e.fileName }) : t('ws.ariaStar', { name: e.fileName })}
                      onClick={() => star(e.id)}
                    >
                      {e.starred ? <StarIcon color="primary" fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                    </IconButton>
                    <IconButton size="small" aria-label={t('ws.ariaRemove', { name: e.fileName })} onClick={() => remove(e.id)}>
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
          {t('ws.filesCount', { n: filtered.length, s: plural(lang, filtered.length) })}
        </Typography>
      )}
    </Stack>
  )
}

export function RecentFilesPage({ onNavigate }: WorkspaceProps) {
  const { t, lang } = useI18n()
  const { navigate } = useNavigation()
  const { entries, cachedIds } = useEntries()
  const [query, setQuery] = useState('')

  const handleRedownload = async (id: string) => {
    const file = await getStashedFile(id)
    if (file) triggerFileDownload(file)
  }

  const handleReuse = async (entry: ActivityEntry) => {
    const file = await getStashedFile(entry.id)
    if (file) navigate(entry.tool as RouteId, { files: [file] })
    else onNavigate(entry.tool as RouteId)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => !q || e.fileName.toLowerCase().includes(q) || toolLabel(e.tool).toLowerCase().includes(q))
  }, [entries, query])

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h2" id="recent-heading">
          {t('ws.recentTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          {t('ws.recentIntro')}
        </Typography>
      </Box>
      <TextField
        size="small"
        placeholder={t('ws.searchRecent')}
        inputProps={{ 'aria-label': t('ws.ariaSearchRecent') }}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ maxWidth: 360 }}
      />
      {filtered.length === 0 ? (
        <EmptyHistory onNavigate={onNavigate} />
      ) : (
        <TableContainer component={Card}>
          <Table size="small" aria-label={t('ws.ariaRecent')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('ws.fileName')}</TableCell>
                <TableCell>{t('ws.fileType')}</TableCell>
                <TableCell>{t('ws.fileSize')}</TableCell>
                <TableCell>{t('ws.fileTool')}</TableCell>
                <TableCell>{t('ws.fileResult')}</TableCell>
                <TableCell>{t('ws.lastModified')}</TableCell>
                <TableCell align="right">{t('ws.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.fileName}</TableCell>
                  <TableCell>{typeLabel(e.fileType, lang)}</TableCell>
                  <TableCell>{formatBytes(e.fileSize)}</TableCell>
                  <TableCell>{toolLabel(e.tool)}</TableCell>
                  <TableCell>{formatActivityResult(lang, e)}</TableCell>
                  <TableCell>{formatDate(e.at, lang)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {cachedIds.has(e.id) && (
                        <Button size="small" startIcon={<DownloadIcon sx={{ fontSize: 15 }} />} onClick={() => void handleRedownload(e.id)}>
                          {t('ws.redownload')}
                        </Button>
                      )}
                      <Button size="small" onClick={() => void handleReuse(e)}>
                        {cachedIds.has(e.id) ? t('ws.openWithFile') : t('common.openTool')}
                      </Button>
                    </Stack>
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
