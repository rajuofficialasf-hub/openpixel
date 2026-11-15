import { useState } from 'react'
import {
  BROWSER_DECODABLE,
  BROWSER_ENCODABLE,
  CAPABILITIES,
  formatLabel,
} from '../lib/capabilities'

type Filter = 'all' | 'browser' | 'cli-only'

/**
 * Dashboard / overview: the full capability list, generated from the
 * engine registry (`src/data/capabilities.json` — see
 * `scripts/generate-capabilities.mjs`), with an honest "In browser"
 * column showing what the canvas path in this app can actually do.
 */
export function CapabilitiesTable() {
  const [filter, setFilter] = useState<Filter>('all')

  const rows = CAPABILITIES.filter((cap) => {
    if (filter === 'browser') {
      return BROWSER_DECODABLE.includes(cap.format_id) || BROWSER_ENCODABLE.includes(cap.format_id)
    }
    if (filter === 'cli-only') {
      return !BROWSER_DECODABLE.includes(cap.format_id) && !BROWSER_ENCODABLE.includes(cap.format_id)
    }
    return true
  })

  const browserNote = (formatId: string, canDecode: boolean, canEncode: boolean): string => {
    const decodes = BROWSER_DECODABLE.includes(formatId)
    const encodes = BROWSER_ENCODABLE.includes(formatId)
    if (decodes && encodes) return 'Decode + encode'
    if (decodes) return 'Decode only'
    if (encodes) return 'Encode only'
    if (canDecode || canEncode) return 'Engine only — use the CLI'
    return 'Not implemented'
  }

  return (
    <section aria-labelledby="formats-heading" className="space-y-4">
      <h2 id="formats-heading" className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Format capabilities
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Generated from the Rust engine’s registry — run{' '}
        <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">
          npm run generate:capabilities
        </code>{' '}
        to regenerate it after any engine change. The “In browser” column is what this web app
        can do; everything else needs the native CLI ({' '}
        <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">
          openpixel convert
        </code>
        ) or the desktop app.
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter formats">
        {(
          [
            ['all', `All formats (${CAPABILITIES.length})`],
            ['browser', 'Works in this browser'],
            ['cli-only', 'CLI / desktop only'],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              filter === value
                ? 'bg-blue-600 text-white'
                : 'border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-100 dark:bg-slate-800">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">Format</th>
              <th scope="col" className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">Extensions</th>
              <th scope="col" className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">Engine decode</th>
              <th scope="col" className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">Engine encode</th>
              <th scope="col" className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">Alpha</th>
              <th scope="col" className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">Animation</th>
              <th scope="col" className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">In browser</th>
              <th scope="col" className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((cap) => (
              <tr
                key={cap.format_id}
                className="border-t border-slate-200 dark:border-slate-700"
              >
                <th scope="row" className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">
                  {formatLabel(cap.format_id)}
                </th>
                <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                  {cap.extensions.map((e) => `.${e}`).join(', ')}
                </td>
                <td className="px-3 py-2">{cap.can_decode ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2">{cap.can_encode ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2">{cap.supports_alpha ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2">{cap.supports_animation ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2">{browserNote(cap.format_id, cap.can_decode, cap.can_encode)}</td>
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{cap.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Showing {rows.length} of {CAPABILITIES.length} formats. HEIC/HEIF, APNG, RAW and PSD are
        planned in the engine and not convertible anywhere yet — the CLI reports them the same way.
      </p>
    </section>
  )
}
