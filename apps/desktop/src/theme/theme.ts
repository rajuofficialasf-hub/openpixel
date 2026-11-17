/**
 * Design system — the single source of truth for the desktop app's look (copied from apps/web/src/theme/theme.ts — same tokens, kept independent; do not import across apps).
 *
 * OpenPixel Studio tokens (master design prompt §5–7, adopted in
 * Studio Phase 6 — they replace the pre-Studio blue #2563eb /
 * slate system). One theme module, two modes. Every page reads its
 * colours, spacing, radius and component defaults from here, so a
 * new page plugs into the shared shell in `App.tsx` without
 * inventing its own styles. Nothing in `src/components/` hard-codes
 * a brand colour or a hex value: use `theme.palette`, `sx`, or the
 * component overrides below.
 *
 * Rules (see docs/DESIGN_NOTES.md for the full set):
 * - 8px spacing scale — section gaps 24px, card padding 24px,
 *   page padding 24–32px (16px on mobile).
 * - Type scale: display/h1 32 / h2 28 / h3 24 / h4 22 / h5 20 /
 *   h6 18 / subtitle2 14 semibold / body2 14 / caption 12. One
 *   size per job, no ad-hoc sizes, no oversized headings.
 * - Restrained palette: primary #3157D5 (light) / #829BFF (dark),
 *   secondary slate #64748B. No new hues. Status colours carry
 *   their semantic meaning only.
 * - Cards: 12px radius, 1px divider border, soft shadow. Buttons:
 *   8px radius. Dialogs: 16px radius. Inputs: 44px min height.
 * - Breakpoints (prompt §20): xs 0 / sm 600 / md 768 / lg 900 /
 *   xl 1200 / xxl 1536. Content max-width 1440px.
 * - Typography is Inter (English) + Noto Sans Bengali, self-hosted
 *   via @fontsource (imported in main.tsx) — no webfont CDN, no
 *   layout shift. Dark mode is MUI palette mode; the `dark` class
 *   on `<html>` is still toggled by `App.tsx` because the e2e suite
 *   asserts on it, not because the theme needs it.
 */
import { alpha, createTheme, type Theme } from '@mui/material/styles'

export type ThemeMode = 'light' | 'dark'

// Custom `xxl` breakpoint (prompt §20) — MUI needs the override
// declared so `theme.breakpoints.up('xxl')` and `xxl` props type-check.
declare module '@mui/material/styles' {
  interface BreakpointOverrides {
    xs: true
    sm: true
    md: true
    lg: true
    xl: true
    xxl: true
  }
}

const FONT_STACK = `'Inter', 'Noto Sans Bengali', system-ui, 'Segoe UI', Roboto, sans-serif`

export function getTheme(mode: ThemeMode): Theme {
  const dark = mode === 'dark'
  return createTheme({
    breakpoints: {
      values: { xs: 0, sm: 600, md: 768, lg: 900, xl: 1200, xxl: 1536 },
    },
    palette: {
      mode,
      primary: {
        main: dark ? '#829BFF' : '#3157D5',
        light: dark ? '#A8BCFF' : '#5B7BE0',
        dark: dark ? '#5B7BE0' : '#2443AA',
        contrastText: dark ? '#0B1020' : '#ffffff',
      },
      secondary: {
        main: dark ? '#9AA9C2' : '#64748B',
        light: dark ? '#B9C4D6' : '#94A3B8',
        dark: dark ? '#7C8AA5' : '#475569',
        contrastText: '#ffffff',
      },
      background: {
        default: dark ? '#0B1020' : '#F7F8FC',
        paper: dark ? '#121A2B' : '#FFFFFF',
      },
      text: {
        primary: dark ? '#F1F5FB' : '#172033',
        secondary: dark ? '#A3AEC2' : '#64748B',
      },
      divider: dark ? '#26344D' : '#E2E8F0',
      success: { main: dark ? '#39C98A' : '#16A36A' },
      warning: { main: dark ? '#F0B64D' : '#E6A23C' },
      error: { main: dark ? '#F07878' : '#DC4C4C' },
      info: { main: dark ? '#64A9F5' : '#3284D6' },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT_STACK,
      // Display / section titles — one size per job.
      h1: { fontSize: '2rem', lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em' },
      h2: { fontSize: '1.75rem', lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.02em' },
      h3: { fontSize: '1.5rem', lineHeight: 1.3, fontWeight: 700, letterSpacing: '-0.01em' },
      h4: { fontSize: '1.375rem', lineHeight: 1.3, fontWeight: 650, letterSpacing: '-0.01em' },
      h5: { fontSize: '1.25rem', lineHeight: 1.35, fontWeight: 650, letterSpacing: '-0.01em' },
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
            outline: '2px solid #3157D5',
            outlineOffset: '2px',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 8, textTransform: 'none', fontWeight: 600 },
          // Contained buttons: flat, no heavy MUI shadow — the
          // colour does the work, the shadow does not.
          contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
          sizeLarge: { padding: '10px 22px' },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: 8 },
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
          // Prompt §7: input height 44–48px.
          root: { borderRadius: 8, minHeight: 44 },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 12,
            border: `1px solid ${theme.palette.divider}`,
            boxShadow:
              theme.palette.mode === 'dark'
                ? '0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px -12px rgba(0, 0, 0, 0.5)'
                : '0 1px 2px rgba(23, 32, 51, 0.05), 0 8px 24px -12px rgba(23, 32, 51, 0.10)',
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
          rounded: { borderRadius: 12 },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 16 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: dark ? '#A3AEC2' : '#64748B',
          },
          body: { padding: '12px 16px' },
        },
      },
      MuiTableContainer: {
        styleOverrides: {
          root: ({ theme }) => ({
            border: `1px solid ${theme.palette.divider}`,
            boxShadow:
              theme.palette.mode === 'dark'
                ? '0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px -12px rgba(0, 0, 0, 0.5)'
                : '0 1px 2px rgba(23, 32, 51, 0.05), 0 8px 24px -12px rgba(23, 32, 51, 0.10)',
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
            boxShadow: '0 1px 4px rgba(23, 32, 51, 0.25)',
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
      // Sidebar navigation — one shared look for every nav item:
      // 8px radius, 8% primary tint + primary text when active.
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            margin: '2px 8px',
            padding: '8px 12px',
            '&.Mui-selected': {
              backgroundColor: alpha(theme.palette.primary.main, 0.08),
              color: theme.palette.primary.main,
              '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.12) },
              '& .MuiListItemIcon-root': { color: theme.palette.primary.main },
            },
          }),
        },
      },
      MuiListItemIcon: {
        styleOverrides: {
          root: { minWidth: 36 },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: ({ theme }) => ({
            backgroundColor: theme.palette.background.paper,
            borderRight: `1px solid ${theme.palette.divider}`,
          }),
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: alpha(theme.palette.background.paper, 0.92),
            color: theme.palette.text.primary,
            borderBottom: `1px solid ${theme.palette.divider}`,
            boxShadow: 'none',
          }),
        },
      },
      MuiBreadcrumbs: {
        styleOverrides: {
          root: { fontSize: '0.875rem' },
        },
      },
      MuiSnackbar: {
        styleOverrides: {
          root: { '& .MuiSnackbarContent-root': { borderRadius: 12 } },
        },
      },
    },
  })
}
