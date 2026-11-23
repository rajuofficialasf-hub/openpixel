/**
 * Reusable secondary output actions for processed images:
 * - Copy image to clipboard (converts to PNG when needed)
 * - Native Share via Web Share API (shown when the device/browser supports file sharing)
 */
import { useState } from 'react'
import { Button } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import ShareIcon from '@mui/icons-material/Share'
import {
  canCopyImageToClipboard,
  canShareFiles,
  copyImageBlobToClipboard,
  shareImageBlob,
} from '../lib/clipboard'
import { useNotify } from './layout/notify'
import { useI18n } from '../lib/use-i18n'

export interface ImageOutputActionsProps {
  blob: Blob
  filename: string
  /** Whether the blob is browser-decodable for clipboard PNG transcoding. */
  canCopy?: boolean
}

export function ImageOutputActions({ blob, filename, canCopy = true }: ImageOutputActionsProps) {
  const { t } = useI18n()
  const notify = useNotify()
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [sharing, setSharing] = useState(false)

  const showCopy = canCopy && canCopyImageToClipboard()
  const showShare = canShareFiles()

  const handleCopy = async () => {
    if (copying) return
    setCopying(true)
    try {
      await copyImageBlobToClipboard(blob)
      setCopied(true)
      notify(t('img.copiedToast'))
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      notify(t('img.copyFailed'))
    } finally {
      setCopying(false)
    }
  }

  const handleShare = async () => {
    if (sharing) return
    setSharing(true)
    try {
      const outcome = await shareImageBlob(blob, filename)
      if (outcome === 'unsupported') notify(t('img.shareUnsupported'))
    } catch {
      notify(t('img.shareFailed'))
    } finally {
      setSharing(false)
    }
  }

  return (
    <>
      {showCopy && (
        <Button
          type="button"
          variant="outlined"
          size="small"
          startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
          color={copied ? 'success' : 'primary'}
          disabled={copying}
          onClick={() => void handleCopy()}
        >
          {copied ? t('img.copied') : t('img.copyImage')}
        </Button>
      )}
      {showShare && (
        <Button
          type="button"
          variant="outlined"
          size="small"
          startIcon={<ShareIcon />}
          disabled={sharing}
          onClick={() => void handleShare()}
        >
          {t('img.share')}
        </Button>
      )}
    </>
  )
}
