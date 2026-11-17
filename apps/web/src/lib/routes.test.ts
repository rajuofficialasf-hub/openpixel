import { describe, expect, it } from 'vitest'
import { ROUTE_PATHS, routeFromPath, type RouteId } from './routes'

const ALL_ROUTES = Object.keys(ROUTE_PATHS) as RouteId[]

describe('ROUTE_PATHS — one shareable URL per page', () => {
  it('covers every route exactly once, home is /', () => {
    expect(ALL_ROUTES).toHaveLength(13)
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
    expect(routeFromPath('/convert')).toBe('convert')
    expect(routeFromPath('/ocr')).toBe('ocr')
    expect(routeFromPath('/settings')).toBe('settings')
    expect(routeFromPath('/')).toBe('home')
  })

  it('tolerates a trailing slash', () => {
    expect(routeFromPath('/pdf/')).toBe('pdf')
    expect(routeFromPath('/tools/')).toBe('tools')
  })

  it('falls back to home for unknown paths — no invented 404 page', () => {
    expect(routeFromPath('/nope')).toBe('home')
    expect(routeFromPath('/pdf/extra')).toBe('home')
    expect(routeFromPath('')).toBe('home')
  })
})
