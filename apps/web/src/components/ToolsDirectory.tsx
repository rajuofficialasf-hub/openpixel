/**
 * All Tools directory: search, category filter, browser-ready toggle,
 * recently used, and clean category grouping.
 *
 * By default shows tools that actually work right here in the browser,
 * so regular users aren't greeted by dead-end Coming Soon / CLI cards.
 * A clear toggle (and search) reveals CLI & upcoming tools honestly.
 */
import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { CATEGORIES, ROUTE_TITLES, searchTools, TOOLS, type RouteId, type ToolCategory } from '../lib/routes'
import { formatDate, loadActivity } from '../lib/activity'
import { ToolCard } from './ToolCard'
import { plural, translate } from '../lib/i18n'
import { useI18n } from '../lib/use-i18n'

export type ToolsCategoryFilter = ToolCategory | 'all'

interface ToolsDirectoryProps {
  query: string
  onQueryChange: (query: string) => void
  category: ToolsCategoryFilter
  onCategoryChange: (category: ToolsCategoryFilter) => void
  onNavigate: (route: RouteId) => void
}

export function ToolsDirectory({ query, onQueryChange, category, onCategoryChange, onNavigate }: ToolsDirectoryProps) {
  const { t, lang } = useI18n()
  const [sort, setSort] = useState<'recommended' | 'name'>('recommended')
  const [availability, setAvailability] = useState<'web' | 'all'>('web')
  const activity = useMemo(() => loadActivity(), [])

  const searched = useMemo(() => searchTools(query, lang), [query, lang])
  const filtered = useMemo(() => {
    let list = category === 'all' ? searched : searched.filter((tool) => tool.categories.includes(category))
    // When searching, show all matching tools regardless of status so
    // users searching "docx" or "protect" still get the honest CLI answer.
    if (!query.trim() && availability === 'web' && category !== 'document' && category !== 'media') {
      list = list.filter((tool) => tool.status === 'web')
    }
    return list
  }, [searched, category, query, availability])

  const sorted = useMemo(
    () => (sort === 'name' ? [...filtered].sort((a, b) => a.name.localeCompare(b.name)) : filtered),
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

  const visibleCategories = useMemo(
    () =>
      availability === 'web'
        ? CATEGORIES.filter((cat) => TOOLS.some((tool) => tool.categories[0] === cat.id && tool.status === 'web'))
        : CATEGORIES,
    [availability],
  )

  return (
    <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
      <Box sx={{ flex: 'none' }}>
        <Typography variant="h5" component="h2" id="tools-heading">
          {t('tools.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, maxWidth: 720 }}>
          {t('tools.intro')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', flex: 'none' }}>
        <TextField
          size="small"
          placeholder={t('tools.searchPlaceholder')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          inputProps={{ 'aria-label': t('header.searchTools') }}
          slotProps={{
            input: {
              startAdornment: <SearchIcon color="action" sx={{ mr: 1 }} />,
            },
          }}
          sx={{ flex: 1, minWidth: 220 }}
        />
        <ToggleButtonGroup
          exclusive
          size="small"
          value={availability}
          onChange={(_, val: 'web' | 'all' | null) => {
            if (val) setAvailability(val)
          }}
          aria-label="Filter tool availability"
        >
          <ToggleButton value="web">{t('tools.readyOnly')}</ToggleButton>
          <ToggleButton value="all">{t('tools.showAll')}</ToggleButton>
        </ToggleButtonGroup>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="tools-sort-label">{t('tools.sort')}</InputLabel>
          <Select
            labelId="tools-sort-label"
            label={t('tools.sort')}
            value={sort}
            onChange={(e) => setSort(e.target.value as 'recommended' | 'name')}
          >
            <MenuItem value="recommended">{t('tools.sortRecommended')}</MenuItem>
            <MenuItem value="name">{t('tools.sortName')}</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', flex: 'none' }} role="group" aria-label={t('tools.filterByCategory')}>
        <Chip
          size="small"
          label={t('tools.all')}
          clickable
          color={category === 'all' ? 'primary' : 'default'}
          onClick={() => onCategoryChange('all')}
        />
        {CATEGORIES.map((c) => (
          <Chip
            key={c.id}
            size="small"
            label={translate(lang, `cat.${c.id}`)}
            clickable
            color={category === c.id ? 'primary' : 'default'}
            onClick={() => onCategoryChange(c.id)}
          />
        ))}
      </Box>

      <Stack spacing={2.5} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 }, overflowY: { lg: 'auto' }, pr: { lg: 0.5 } }}>
      {recentUsed.length > 0 && !query.trim() && category === 'all' && (
        <Box component="section" aria-labelledby="tools-recent-heading">
          <Typography variant="overline" color="text.secondary" id="tools-recent-heading">
            {t('tools.recentlyUsed')}
          </Typography>
          <Stack spacing={1} sx={{ mt: 0.75 }}>
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
                  borderRadius: 1,
                  px: 2,
                  py: 1,
                  bgcolor: 'background.paper',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 180 }}>
                  <Typography variant="body2">
                    {ROUTE_TITLES[r.route].title} — {r.fileName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDate(r.at, lang)}
                  </Typography>
                </Box>
                <Button size="small" onClick={() => onNavigate(r.route)}>
                  {t('common.openTool')}
                </Button>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {showSections ? (
        visibleCategories.map((cat) => {
          const tools = TOOLS.filter(
            (tool) => tool.categories[0] === cat.id && (availability === 'all' || tool.status === 'web'),
          )
          if (tools.length === 0) return null
          return (
            <Box key={cat.id} component="section" aria-labelledby={`tools-cat-${cat.id}`}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle1" component="h3" fontWeight={600} id={`tools-cat-${cat.id}`}>
                  {translate(lang, `cat.${cat.id}`)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {translate(lang, `cat.${cat.id}.blurb`)}
                </Typography>
              </Box>
              <Grid container spacing={1.5}>
                {tools.map((tool) => (
                  <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 4, xl: 3 }}>
                    <ToolCard tool={tool} onNavigate={onNavigate} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          )
        })
      ) : (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
            {t('tools.count', { n: sorted.length, s: plural(lang, sorted.length) })}
            {query.trim() ? t('tools.matching', { q: query.trim() }) : ''}
            {category !== 'all' ? t('tools.inCategory', { category: translate(lang, `cat.${category}`) }) : ''}.
          </Typography>
          {sorted.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('tools.noMatch')}
            </Typography>
          ) : (
            <Grid container spacing={1.5}>
              {sorted.map((tool) => (
                <Grid key={tool.id} size={{ xs: 12, sm: 6, lg: 4, xl: 3 }}>
                  <ToolCard tool={tool} onNavigate={onNavigate} />
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      )}
      </Stack>
    </Stack>
  )
}
