/**
 * Shared navigation context so any workspace or result panel can
 * route to another tool (e.g. Smart "Next Step" Chaining: send a
 * converted image straight to Resize or OCR, or a merged PDF straight
 * to Compress or Edit) without threading `onNavigate` through 20+
 * intermediate components.
 */
import { createContext, useContext } from 'react'
import type { RouteId, ToolCategory } from '../../lib/routes'

export interface NavigateOpts {
  toolsQuery?: string
  toolsCategory?: ToolCategory
  files?: File[]
}

export interface NavigationContextValue {
  route: RouteId
  navigate: (next: RouteId, opts?: NavigateOpts) => void
}

export const NavigationContext = createContext<NavigationContextValue>({
  route: 'home',
  navigate: () => undefined,
})

export function useNavigation(): NavigationContextValue {
  return useContext(NavigationContext)
}
