import { useCallback, useRef, useState } from 'react'

interface DropZoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  label: string
  hint: string
  inputId: string
}

/**
 * Drag-and-drop upload zone + file picker. Files are only ever read
 * with the File API on this device — nothing is uploaded.
 */
export function DropZone({ onFiles, accept, multiple = true, label, hint, inputId }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) onFiles(files)
    },
    [onFiles],
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-describedby={`${inputId}-hint`}
      className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
        dragging
          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950'
          : 'border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800/50 dark:hover:border-slate-500'
      }`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <p className="text-lg font-medium text-slate-900 dark:text-slate-100">{label}</p>
      <p id={`${inputId}-hint`} className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        {hint}
      </p>
      <p className="mt-3 text-sm font-medium text-blue-700 dark:text-blue-400">
        Choose files or drag them here
      </p>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        aria-label={label}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onFiles(files)
          event.target.value = ''
        }}
      />
    </div>
  )
}
