import type { FormatCapability } from '../lib/tauri'

interface CapabilitiesTableProps {
  capabilities: FormatCapability[]
}

/**
 * Format capability dashboard. The data comes live from the engine
 * registry (`get_capabilities`) on every launch — nothing here is
 * hand-written, so it cannot drift from what the engine can do.
 */
export function CapabilitiesTable({ capabilities }: CapabilitiesTableProps) {
  const decodable = capabilities.filter((c) => c.can_decode).length
  const encodable = capabilities.filter((c) => c.can_encode).length

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {capabilities.length} formats known to the engine · {decodable} decodable · {encodable}{' '}
        encodable. This list is read from the engine registry when the app starts, so it always
        matches the CLI (<code>openpixel formats</code>).
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 dark:bg-slate-800">
            <tr>
              <th scope="col" className="px-3 py-2">Format</th>
              <th scope="col" className="px-3 py-2">Extensions</th>
              <th scope="col" className="px-3 py-2">Decode</th>
              <th scope="col" className="px-3 py-2">Encode</th>
              <th scope="col" className="px-3 py-2">Alpha</th>
              <th scope="col" className="px-3 py-2">Animation</th>
              <th scope="col" className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((c) => (
              <tr key={c.format_id} className="border-t border-slate-200 dark:border-slate-700">
                <td className="px-3 py-2 font-medium">{c.format_id.toUpperCase()}</td>
                <td className="px-3 py-2">.{c.extensions.join(', .')}</td>
                <td className="px-3 py-2">{c.can_decode ? '✓' : '—'}</td>
                <td className="px-3 py-2">{c.can_encode ? '✓' : '—'}</td>
                <td className="px-3 py-2">{c.supports_alpha ? '✓' : '—'}</td>
                <td className="px-3 py-2">{c.supports_animation ? '✓' : '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  {c.status}
                  {c.native_dependency ? ` · needs ${c.native_dependency}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Not convertible anywhere yet: HEIC / HEIF, APNG, RAW, PSD (planned in the engine, reported
        as such by the CLI and by this app). SVG rasterises to an image but cannot be an output.
      </p>
    </div>
  )
}
