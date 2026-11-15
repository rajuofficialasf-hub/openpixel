import { useState } from 'react'

interface DropZoneProps {
  onPick: () => void
  label: string
  hint: string
}

/**
 * Drop target + picker button. In the desktop app the real drag-and-drop
 * arrives as a window-level `tauri://drag-drop` event (handled in
 * App.tsx and passed down as dropped paths); this zone is the visible
 * target and the keyboard-operable way to open the native file dialog.
 * Files are only ever read by the Rust backend on this device.
 */
export function DropZone({ onPick, label, hint }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
        dragging
          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950'
          : 'border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800/50 dark:hover:border-slate-500'
      }`}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onPick()
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
      }}
    >
      <p className="text-lg font-medium text-slate-900 dark:text-slate-100">{label}</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{hint}</p>
      <p className="mt-3 text-sm font-medium text-blue-700 dark:text-blue-400">
        Choose a file or drag one onto the window
      </p>
    </div>
  )
}
