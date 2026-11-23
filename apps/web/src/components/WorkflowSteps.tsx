/**
 * Compact 3-step visual workflow bar for tool workspaces:
 *   1. Choose file  →  2. Set options  →  3. Download result
 *
 * Gives users immediate clarity on what to do now and what comes
 * next, without cluttering the workspace.
 */
import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'

export interface WorkflowStepsProps {
  /** 0 = upload/choose file, 1 = configure options, 2 = download result */
  activeStep: 0 | 1 | 2
  steps: [string, string, string]
}

export function WorkflowSteps({ activeStep, steps }: WorkflowStepsProps) {
  return (
    <Box
      component="ol"
      aria-label="Workflow steps"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: { xs: 1, sm: 1.5 },
        listStyle: 'none',
        p: 0,
        m: 0,
      }}
    >
      {steps.map((label, idx) => {
        const completed = idx < activeStep
        const current = idx === activeStep
        return (
          <Box
            component="li"
            key={label}
            aria-current={current ? 'step' : undefined}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.25,
                py: 0.5,
                borderRadius: 2,
                border: 1,
                borderColor: current
                  ? 'primary.main'
                  : completed
                    ? (t) => alpha(t.palette.success.main, 0.4)
                    : 'divider',
                bgcolor: current
                  ? (t) => alpha(t.palette.primary.main, 0.08)
                  : completed
                    ? (t) => alpha(t.palette.success.main, 0.06)
                    : 'background.paper',
              }}
            >
              {completed ? (
                <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
              ) : (
                <Box
                  component="span"
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    bgcolor: current ? 'primary.main' : 'action.hover',
                    color: current ? 'primary.contrastText' : 'text.secondary',
                  }}
                >
                  {idx + 1}
                </Box>
              )}
              <Typography
                variant="caption"
                sx={{
                  fontWeight: current ? 600 : 500,
                  color: current ? 'primary.main' : completed ? 'text.primary' : 'text.secondary',
                }}
              >
                {label}
              </Typography>
            </Box>
            {idx < steps.length - 1 && (
              <Typography
                component="span"
                aria-hidden="true"
                variant="caption"
                color="text.disabled"
                sx={{ display: { xs: 'none', sm: 'inline' }, userSelect: 'none' }}
              >
                →
              </Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
