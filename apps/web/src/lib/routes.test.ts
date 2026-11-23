import { describe, expect, it } from 'vitest'
import { ROUTE_PATHS, routeFromPath, searchTools, TOOLS, toolDescription, TOOL_DESCRIPTIONS_BN, type RouteId } from './routes'

const ALL_ROUTES = Object.keys(ROUTE_PATHS) as RouteId[]

describe('ROUTE_PATHS — one shareable URL per page', () => {
  it('covers every route exactly once, home is /', () => {
    expect(ALL_ROUTES).toHaveLength(35)
    expect(ROUTE_PATHS.home).toBe('/')
    const paths = new Set(Object.values(ROUTE_PATHS))
    expect(paths.size).toBe(ALL_ROUTES.length)
  })

  it('round-trips: every path resolves back to its route', () => {
    for (const route of ALL_ROUTES) {
      expect(routeFromPath(ROUTE_PATHS[route])).toBe(route)
    }
  })

  it('resolves the documented deep links', () => {
    expect(routeFromPath('/pdf')).toBe('pdf')
    expect(routeFromPath('/pdf/merge')).toBe('pdf-merge')
    expect(routeFromPath('/pdf/compress')).toBe('pdf-compress')
    expect(routeFromPath('/pdf/edit')).toBe('pdf-edit')
    expect(routeFromPath('/convert')).toBe('convert')
    expect(routeFromPath('/crop')).toBe('crop')
    expect(routeFromPath('/remove-background')).toBe('bg-remove')
    expect(routeFromPath('/ocr')).toBe('ocr')
    expect(routeFromPath('/settings')).toBe('settings')
    expect(routeFromPath('/')).toBe('home')
  })

  it('tolerates a trailing slash', () => {
    expect(routeFromPath('/pdf/')).toBe('pdf')
    expect(routeFromPath('/pdf/merge/')).toBe('pdf-merge')
    expect(routeFromPath('/tools/')).toBe('tools')
  })

  it('falls back to home for unknown paths — no invented 404 page', () => {
    expect(routeFromPath('/nope')).toBe('home')
    expect(routeFromPath('')).toBe('home')
  })

  it('falls back to the PDF picker for unknown /pdf/* paths', () => {
    expect(routeFromPath('/pdf/extra')).toBe('pdf')
    expect(routeFromPath('/pdf/nope')).toBe('pdf')
  })
})

describe('tool descriptions — every tool has a Bengali description', () => {
  it('covers every tool, tool names stay English', () => {
    expect(TOOLS.length).toBeGreaterThan(0)
    for (const tool of TOOLS) {
      const bn = TOOL_DESCRIPTIONS_BN[tool.id]
      expect(bn, `missing BN description for ${tool.id}`).toBeTruthy()
      expect(toolDescription('bn', tool)).toBe(bn)
      expect(toolDescription('en', tool)).toBe(tool.description)
    }
  })

  it('searches Bengali descriptions in Bengali mode', () => {
    const found = searchTools('একত্রে', 'bn')
    expect(found.some((t) => t.id === 'pdf-merge')).toBe(true)
    expect(searchTools('একত্রে', 'en')).toEqual([])
  })
})
