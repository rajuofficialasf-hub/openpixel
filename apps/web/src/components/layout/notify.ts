/**
 * App-level notification channel (snackbar). Kept in its own
 * module so AppShell stays a components-only file (fast refresh)
 * and ToolCard can import the hook without the shell.
 */
import { createContext, useContext } from 'react'

export const NotifyContext = createContext<(message: string) => void>(() => {})

export const useNotify = () => useContext(NotifyContext)
