/**
 * All Tools directory (prompt §10): search, category filter,
 * popular tools, recently used (from real local activity only),
 * sort. Tools are grouped by category; the Media category shows
 * the honest empty state — no media tools exist yet.
 */
import { useMemo, useState } from 'react'
import {
  Box,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { CATEGORIES, ROUTE_TITLES, searchTools, TOOLS, type RouteId, type ToolCategory } from '../lib/routes'
import { formatDate, loadActivity } from '../lib/activity'
import { ToolCard } from './ToolCard'

export type ToolsCategoryFilter = ToolCategory | 'all'

interface ToolsDirectoryProps {
  query: string
  onQueryChange: (query: string) => void
  category: ToolsCategoryFilter
  onCategoryChange: (category: ToolsCategoryFilter) => void
  onNavigate: (route: RouteId) => void
}

export function ToolsDirectory({ query, onQueryChange, category, onCategoryChange, onNavigate }: ToolsDirectoryProps) {
  const [sort, setSort] = useState<'recommended' | 'name'>('recommended')
  const activity = useMemo(() => loadActivity(), [])

  const searched = useMemo(() => searchTools(query), [query])
  const filtered = useMemo(
    () => (category === 'all' ? searched : searched.filter((t) => t.categories.includes(category))),
    [searched, category],
  )
  const sorted = useMemo(
    () =>
      sort === 'name' ? [...filtered].sort((a, b) => a.name.localeCompare(b.name)) : filtered,
    [filtered, sort],
  )

  const showSections = !query.trim() && category === 'all'
  const recentUsed = useMemo(() => {
    const seen = new Set<string>()
    const out: { route: RouteId; fileName: string; at: number }[] = []
    for (const entry of activity) {
      const route = entry.tool as RouteId
      if (!ROUTE_TITLES[route] || seen.has(route)) continue
      seen.add(route)
      out.push({ route, fileName: entry.fileName, at: entry.at })
      if (out.length >= 4) break
    }
    return out
  }, [activity])

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h2" id="tools-heading">
          All Tools
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          Discover everything you can do with OpenPixel Studio. Tools that run in the browser open straight away;
          tools that need the CLI or desktop app say so — and show the exact command.
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search by tool name or what it does…"
          aria-label="Search tools"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          slotProps={{ input: { startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} /> } }}
          sx={{ flex: 1, minWidth: 240 }}
        />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="tools-sort-label">Sort</InputLabel>
          <Select
            labelId="tools-sort-label"
            label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as 'recommended' | 'name')}
          >
            <MenuItem value="recommended">Recommended</MenuItem>
            <MenuItem value="name">Name A–Z</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }} role="group" aria-label="Filter by category">
        <Chip
          label="All"
          clickable
          color={category === 'all' ? 'primary' : 'default'}
          onClick={() => onCategoryChange('all')}
        />
        {CATEGORIES.map((c) => (
          <Chip
            key={c.id}
            label={c.label}
            clickable
            color={category === c.id ? 'primary' : 'default'}
            onClick={() => onCategoryChange(c.id)}
          />
        ))}
      </Box>

      {recentUsed.length > 0 && !query.trim() && category === 'all' && (
        <Box component="section" aria-labelledby="tools-recent-heading">
          <Typography variant="overline" color="text.secondary" id="tools-recent-heading">
            Recently used
          </Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {recentUsed.map((r) => (
              <Box
                key={r.route}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  flexWrap: 'wrap',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 2,
                  px: 2,
                  py: 1.5,
                  bgcolor: 'background.paper',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 180 }}>
                  <Typography variant="body2">
                    {ROUTE_TITLES[r.route].title} — {r.fileName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDate(r.at)}
                  </Typography>
                </Box>
                <Chip size="small" label="Open tool" color="primary" clickable onClick={() => onNavigate(r.route)} />
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {showSections ? (
        CATEGORIES.map((cat) => {
          const tools = TOOLS.filter((t) => t.categories.includes(cat.id))
          return (
            <Box key={cat.id} component="section" aria-labelledby={`tools-cat-${cat.id}`}>
              <Typography variant="h6" component="h3" id={`tools-cat-${cat.id}`}>
                {cat.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {cat.blurb}
              </Typography>
              {tools.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No {cat.label.toLowerCase()} tools yet — audio and video conversion are not built. The tools
                  above are the ones that exist today.
                </Typography>
              ) : (
                <Grid container spacing={2}>
                  {tools.map((tool) => (
                    <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                      <ToolCard tool={tool} onNavigate={onNavigate} />
                    </Grid>
                  ))}
                </Grid>
              )}
            </Box>
          )
        })
      ) : (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {sorted.length} tool{sorted.length === 1 ? '' : 's'}
            {query.trim() ? ` matching “${query.trim()}”` : ''}
            {category !== 'all' ? ` in ${CATEGORIES.find((c) => c.id === category)?.label}` : ''}.
          </Typography>
          {sorted.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No tools match that search. Try a different word — or browse all tools above.
            </Typography>
          ) : (
            <Grid container spacing={2}>
              {sorted.map((tool) => (
                <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                  <ToolCard tool={tool} onNavigate={onNavigate} />
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      )}
    </Stack>
  )
}
