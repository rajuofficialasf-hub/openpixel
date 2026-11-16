/**
 * Design system — the single source of truth for the web app's look.
 *
 * One theme module, two modes. Every workspace (Convert, Resize,
 * Batch, Formats, Settings — and the PDF workspace next) reads its
 * colours, spacing, radius and component defaults from here, so a
 * new tab plugs into the shared layout in `App.tsx` without
 * inventing its own styles. Nothing in `src/components/` hard-codes
 * a brand colour or a hex value: use `theme.palette`, `sx`, or the
 * component overrides below.
 *
 * Rules (see docs/DESIGN_NOTES.md for the full set):
 * - 8px spacing scale — section gaps 24px, card padding 24px.
 * - Type scale: h4 28 / h5 22 / h6 18 / subtitle2 14 semibold /
 *   body2 14 / caption 12. One size per job, no ad-hoc sizes.
 * - Restrained palette: brand blue #2563eb primary, teal #0d9488
 *   secondary, slate neutrals. No new hues.
 * - Cards: 16px radius, 1px divider border, soft shadow — the
 *   same card in light and dark mode.
 * - Controls: 10px radius. No excessive gradients, no decorative
 *   clutter. The 3D backdrop stays calm (see Background3D).
 *
 * Typography is the system font stack — no webfont download, no
 * layout shift. Dark mode is MUI palette mode; the `dark` class on
 * `<html>` is still toggled by `App.tsx` because the e2e suite
 * asserts on it, not because the theme needs it.
 */
import { alpha, createTheme, type Theme } from '@mui/material/styles'

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
      // Display / section titles — one size per job.
      h4: { fontSize: '1.75rem', lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.02em' },
      h5: { fontSize: '1.375rem', lineHeight: 1.3, fontWeight: 650, letterSpacing: '-0.01em' },
      h6: { fontSize: '1.125rem', lineHeight: 1.35, fontWeight: 650, letterSpacing: '-0.01em' },
      subtitle1: { fontSize: '1rem', lineHeight: 1.5, fontWeight: 600 },
      subtitle2: { fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 600, letterSpacing: '0.01em' },
      body1: { fontSize: '1rem', lineHeight: 1.6 },
      body2: { fontSize: '0.875rem', lineHeight: 1.55 },
      caption: { fontSize: '0.75rem', lineHeight: 1.5 },
      overline: { fontSize: '0.75rem', lineHeight: 1.5, fontWeight: 600, letterSpacing: '0.08em' },
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
          root: { borderRadius: 10, textTransform: 'none', fontWeight: 600 },
          // Contained buttons: flat, no heavy MUI shadow — the
          // colour does the work, the shadow does not.
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
          sizeLarge: { padding: '10px 22px' },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: { height: 2, borderRadius: 2 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            fontSize: '0.9375rem',
            minHeight: 48,
            padding: '12px 20px',
            letterSpacing: '0.01em',
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 10 },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 16,
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: theme.palette.mode === 'dark'
              ? '0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px -12px rgba(0, 0, 0, 0.5)'
              : '0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -12px rgba(15, 23, 42, 0.10)',
          }),
        },
      },
      MuiCardContent: {
        styleOverrides: {
          // Generous, consistent card padding — 24px on all sides.
          root: { padding: 24, '&:last-child': { paddingBottom: 24 } },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: { borderRadius: 16 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: dark ? '#94a3b8' : '#475569',
          },
          body: { padding: '12px 16px' },
        },
      },
      MuiTableContainer: {
        styleOverrides: {
          root: ({ theme }) => ({
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: theme.palette.mode === 'dark'
              ? '0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px -12px rgba(0, 0, 0, 0.5)'
              : '0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -12px rgba(15, 23, 42, 0.10)',
          }),
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 12, fontSize: '0.875rem' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600 },
        },
      },
      MuiSlider: {
        styleOverrides: {
          // Thin, quiet track — the value, not the chrome, stands out.
          rail: { height: 4, opacity: 1 },
          track: { height: 4 },
          thumb: {
            width: 18,
            height: 18,
            boxShadow: '0 1px 4px rgba(15, 23, 42, 0.25)',
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            textTransform: 'none',
            fontWeight: 600,
            '&.Mui-selected': {
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
              color: theme.palette.primary.main,
              '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.12) },
            },
          }),
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: { gap: 8 },
          grouped: ({ theme }) => ({
            borderRadius: '8px !important',
            border: `1px solid ${theme.palette.divider}`,
            margin: 0,
          }),
        },
      },
    },
  })
}
