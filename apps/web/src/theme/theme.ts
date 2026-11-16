/**
 * Design system — the single source of truth for the web app's look.
 *
 * One theme module, two modes. Every workspace (Convert, Batch,
 * Formats, Settings — and the PDF workspace next) reads its colours,
 * spacing, radius and component defaults from here, so a new tab
 * plugs into the shared layout in `App.tsx` without inventing its
 * own styles. Nothing in `src/components/` hard-codes a brand
 * colour: use `theme.palette`, `sx`, or the component overrides
 * below.
 *
 * Palette: the app's brand blue primary (#2563eb, unchanged from
 * the Tailwind build), teal secondary, slate neutrals. Typography
 * is the system font stack — no webfont download, no layout shift.
 * Dark mode is MUI palette mode; the `dark` class on
 * `<html>` is still toggled by `App.tsx` because the e2e suite
 * asserts on it, not because the theme needs it.
 */
import { createTheme, type Theme } from '@mui/material/styles'

export type ThemeMode = 'light' | 'dark'

const FONT_STACK = `system-ui, 'Segoe UI', Roboto, sans-serif`

/** Brand blue — unchanged from the original build. */
const PRIMARY = {
  main: '#2563eb',
  light: '#3b82f6',
  dark: '#1d4ed8',
  contrastText: '#ffffff',
}

const SECONDARY = {
  main: '#0d9488',
  light: '#14b8a6',
  dark: '#0f766e',
  contrastText: '#ffffff',
}

export function getTheme(mode: ThemeMode): Theme {
  const dark = mode === 'dark'
  return createTheme({
    palette: {
      mode,
      primary: PRIMARY,
      secondary: SECONDARY,
      background: {
        default: dark ? '#0f172a' : '#f8fafc',
        paper: dark ? '#1e293b' : '#ffffff',
      },
      text: {
        primary: dark ? '#f1f5f9' : '#0f172a',
        secondary: dark ? '#94a3b8' : '#475569',
      },
      divider: dark ? '#334155' : '#e2e8f0',
      success: { main: dark ? '#4ade80' : '#15803d' },
      warning: { main: dark ? '#fbbf24' : '#b45309' },
      error: { main: dark ? '#f87171' : '#dc2626' },
      info: { main: dark ? '#60a5fa' : '#2563eb' },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT_STACK,
      h4: { fontWeight: 700 },
      h5: { fontWeight: 600 },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Visible keyboard focus everywhere — accessibility
          // requirement carried over from the old global stylesheet.
          ':focus-visible': {
            outline: '2px solid #2563eb',
            outlineOffset: '2px',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 12, textTransform: 'none', fontWeight: 600 },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { height: 3, borderRadius: 3 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600, minHeight: 48 },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: { borderRadius: 12 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 600 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
    },
  })
}
