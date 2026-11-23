/**
 * Global Command Palette (Ctrl + K / ⌘K).
 *
 * Lets power users and newcomers alike jump to any tool, switch
 * theme, or switch language in two keystrokes — with full keyboard
 * navigation (↑ / ↓ / Enter / Esc).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Box,
  Dialog,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import SearchIcon from '@mui/icons-material/Search'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import TranslateIcon from '@mui/icons-material/Translate'
import HomeIcon from '@mui/icons-material/Home'
import HistoryIcon from '@mui/icons-material/History'
import SettingsIcon from '@mui/icons-material/Settings'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import TerminalIcon from '@mui/icons-material/Terminal'
import { searchTools, toolDescription, type RouteId, type ToolEntry } from '../lib/routes'
import { useI18n } from '../lib/use-i18n'
import { ToolIcon } from './CategoryIcon'

interface CommandItem {
  id: string
  label: string
  subtitle: string
  section: 'tools' | 'actions' | 'other'
  icon: ReactNode
  badge?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onNavigate: (route: RouteId, opts?: { toolsQuery?: string }) => void
  isDark: boolean
  onToggleTheme: () => void
  onToggleLanguage: () => void
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  isDark,
  onToggleTheme,
  onToggleLanguage,
}: CommandPaletteProps) {
  const { t, lang } = useI18n()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const closePalette = useCallback(() => {
    setQuery('')
    setActiveIndex(0)
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase()
    const matchedTools: ToolEntry[] = searchTools(query, lang)
    const webTools = matchedTools.filter((tool) => tool.status === 'web')
    const extraTools = q ? matchedTools.filter((tool) => tool.status !== 'web') : []

    const toolItems: CommandItem[] = (q ? webTools : webTools.slice(0, 10)).map((tool) => ({
      id: `tool-${tool.id}`,
      label: tool.name,
      subtitle: toolDescription(lang, tool),
      section: 'tools',
      icon: <ToolIcon toolId={tool.id} category={tool.categories[0]} />,
      badge: tool.formatChip,
      run: () => {
        if (tool.route) onNavigate(tool.route)
        closePalette()
      },
    }))

    const allActions: CommandItem[] = [
      {
        id: 'act-theme',
        label: isDark ? t('header.themeToLight') : t('header.themeToDark'),
        subtitle: t('cmd.actionThemeSub'),
        section: 'actions',
        icon: isDark ? <LightModeIcon color="primary" /> : <DarkModeIcon color="primary" />,
        run: () => {
          onToggleTheme()
          closePalette()
        },
      },
      {
        id: 'act-lang',
        label: lang === 'bn' ? t('header.languageToEn') : t('header.languageToBn'),
        subtitle: t('cmd.actionLangSub'),
        section: 'actions',
        icon: <TranslateIcon color="primary" />,
        run: () => {
          onToggleLanguage()
          closePalette()
        },
      },
      {
        id: 'act-home',
        label: t('nav.home'),
        subtitle: t('cmd.goHomeSub'),
        section: 'actions',
        icon: <HomeIcon color="action" />,
        run: () => {
          onNavigate('home')
          closePalette()
        },
      },
      {
        id: 'act-recent',
        label: t('nav.recent'),
        subtitle: t('ws.recentIntro'),
        section: 'actions',
        icon: <HistoryIcon color="action" />,
        run: () => {
          onNavigate('recent')
          closePalette()
        },
      },
      {
        id: 'act-settings',
        label: t('nav.settings'),
        subtitle: t('settings.savedNote'),
        section: 'actions',
        icon: <SettingsIcon color="action" />,
        run: () => {
          onNavigate('settings')
          closePalette()
        },
      },
      {
        id: 'act-help',
        label: t('nav.help'),
        subtitle: t('help.intro'),
        section: 'actions',
        icon: <HelpOutlineIcon color="action" />,
        run: () => {
          onNavigate('help')
          closePalette()
        },
      },
    ]

    const actionItems = q
      ? allActions.filter(
          (a) => a.label.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q),
        )
      : allActions

    const otherItems: CommandItem[] = extraTools.slice(0, 6).map((tool) => ({
      id: `extra-${tool.id}`,
      label: tool.name,
      subtitle: tool.status === 'cli-only' ? t('header.searchCliOnly') : t('header.searchComingSoon'),
      section: 'other',
      icon: <TerminalIcon color="action" />,
      run: () => {
        onNavigate('tools', { toolsQuery: tool.name })
        closePalette()
      },
    }))

    return [...toolItems, ...actionItems, ...otherItems]
  }, [query, lang, isDark, t, onNavigate, closePalette, onToggleTheme, onToggleLanguage])

  const clampedIndex = items.length === 0 ? 0 : Math.min(activeIndex, items.length - 1)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (items.length > 0) setActiveIndex((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (items.length > 0) setActiveIndex((i) => (i - 1 + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[clampedIndex]?.run()
    }
  }

  return (
    <Dialog
      open={open}
      onClose={closePalette}
      fullWidth
      maxWidth="sm"
      aria-label={t('cmd.ariaLabel')}
      PaperProps={{
        sx: {
          verticalAlign: 'top',
          mt: { xs: 2, sm: 8 },
          alignSelf: 'flex-start',
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
        },
      }}
    >
      <Box sx={{ p: 1.5 }} onKeyDown={handleKeyDown}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          placeholder={t('cmd.placeholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <Typography
                    variant="caption"
                    sx={{
                      px: 0.75,
                      py: 0.25,
                      borderRadius: 1,
                      border: 1,
                      borderColor: 'divider',
                      color: 'text.secondary',
                      fontFamily: 'monospace',
                    }}
                  >
                    Esc
                  </Typography>
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      <Divider />
      <List
        sx={{
          maxHeight: 380,
          overflowY: 'auto',
          py: 1,
        }}
      >
        {items.length === 0 ? (
          <Box sx={{ px: 3, py: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t('cmd.noResults')}
            </Typography>
          </Box>
        ) : (
          items.map((item, idx) => {
            const prev = idx > 0 ? items[idx - 1] : null
            const showHeader = !prev || prev.section !== item.section
            const sectionTitle =
              item.section === 'tools'
                ? t('cmd.sectionTools')
                : item.section === 'actions'
                  ? t('cmd.sectionActions')
                  : t('cmd.sectionOther')
            const selected = idx === clampedIndex
            return (
              <Box key={item.id}>
                {showHeader && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', px: 2, pt: idx === 0 ? 0.5 : 1.5, pb: 0.5, fontWeight: 600 }}
                  >
                    {sectionTitle}
                  </Typography>
                )}
                <ListItemButton
                  selected={selected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={item.run}
                  sx={{
                    mx: 1,
                    borderRadius: 1.5,
                    '&.Mui-selected': {
                      bgcolor: (th) => alpha(th.palette.primary.main, 0.1),
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 48, justifyContent: 'center' }}>{item.icon}</ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    secondary={item.subtitle}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                    secondaryTypographyProps={{
                      variant: 'caption',
                      sx: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    }}
                  />
                  {item.badge && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: 'monospace', ml: 1, flexShrink: 0 }}
                    >
                      {item.badge}
                    </Typography>
                  )}
                </ListItemButton>
              </Box>
            )
          })
        )}
      </List>
      <Divider />
      <Box
        sx={{
          px: 2,
          py: 1,
          bgcolor: 'background.default',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t('cmd.footerNav')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('cmd.footerPaste')}
        </Typography>
      </Box>
    </Dialog>
  )
}
