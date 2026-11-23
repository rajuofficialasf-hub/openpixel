/**
 * Protect PDF (/pdf/protect) & Unlock PDF (/pdf/unlock) — 100% local
 * in-browser AES-256/AES-128 encryption and password removal.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import DownloadIcon from '@mui/icons-material/Download'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { formatBytes } from '../../lib/capabilities'
import { recordActivity } from '../../lib/activity'
import { pdfOutputName } from '../../lib/pdf'
import {
  inspectPdfEncryption,
  PdfSecurityError,
  protectPdf,
  unlockPdf,
} from '../../lib/pdf-security'
import { DropZone } from '../DropZone'
import { EditorShell } from '../EditorShell'
import { ToolPageHeader } from '../ToolPage'
import { WorkflowSteps } from '../WorkflowSteps'
import { useNavigation } from '../layout/navigation'
import { useI18n } from '../../lib/use-i18n'
import { downloadBlob, type PdfToolProps } from './usePdfFile'

function errorKeyFor(err: unknown, fallbackKey: string): string {
  if (err instanceof PdfSecurityError) {
    if (err.code === 'already-encrypted') return 'pdfSec.errAlreadyEncrypted'
    if (err.code === 'not-encrypted') return 'pdfSec.errNotEncrypted'
    if (err.code === 'wrong-password') return 'pdfSec.errWrongPassword'
    if (err.code === 'empty-password') return 'pdfSec.errEmptyPassword'
    return 'pdfSec.errInvalidPdf'
  }
  return fallbackKey
}

export function ProtectTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [userPassword, setUserPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [algorithm, setAlgorithm] = useState<'AES-256' | 'AES-128'>('AES-256')
  const [allowPrint, setAllowPrint] = useState(true)
  const [allowCopy, setAllowCopy] = useState(true)
  const [allowModify, setAllowModify] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ blob: Blob; filename: string; bytes: number; pages: number } | null>(null)

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next = files[0]
      if (!next) return
      setError(null)
      setResult(null)
      try {
        const raw = new Uint8Array(await next.arrayBuffer())
        const info = await inspectPdfEncryption(raw)
        if (info.encrypted) {
          setError(t('pdfSec.errAlreadyEncrypted'))
          return
        }
        setFile(next)
        setBytes(raw)
        setPageCount(info.pageCount)
      } catch (err) {
        setError(t(errorKeyFor(err, 'pdfSec.errInvalidPdf')))
      }
    },
    [t],
  )

  const lastInitialRef = useRef<File[] | null>(null)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && lastInitialRef.current !== initialFiles) {
      lastInitialRef.current = initialFiles
      void handleFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, handleFiles, onInitialFilesConsumed])

  const clearFile = () => {
    setFile(null)
    setBytes(null)
    setPageCount(0)
    setUserPassword('')
    setConfirmPassword('')
    setResult(null)
    setError(null)
  }

  const handleProtect = async () => {
    if (!bytes || !file || busy) return
    if (!userPassword) {
      setError(t('pdfSec.errEmptyPassword'))
      return
    }
    if (confirmPassword && userPassword !== confirmPassword) {
      setError(t('pdfSec.errMismatch'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const out = await protectPdf(bytes, {
        userPassword,
        algorithm,
        allowPrint,
        allowCopy,
        allowModify,
      })
      const blob = new Blob([out.data as BlobPart], { type: 'application/pdf' })
      const filename = pdfOutputName(file.name, 'protected')
      setResult({ blob, filename, bytes: blob.size, pages: out.pageCount })
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: 'application/pdf',
        tool: 'pdf-protect',
        result: `Protected (${out.algorithm}) · ${out.pageCount} pages`,
        resultKey: 'act.pdfProtect',
        resultParams: { alg: out.algorithm, n: out.pageCount },
        outputBlob: blob,
        outputName: filename,
      })
    } catch (err) {
      setError(t(errorKeyFor(err, 'pdfSec.errProtectFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box component="section" aria-labelledby="pdf-protect-heading" sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}>
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <ToolPageHeader
          headingId="pdf-protect-heading"
          title={t('pdfSec.protectTitle')}
          description={t('pdfSec.protectDesc')}
          actions={
            <WorkflowSteps
              activeStep={!file ? 0 : result ? 2 : 1}
              steps={[t('step.upload'), t('pdfSec.stepPassword'), t('step.download')]}
            />
          }
        />

        {!file && (
          <Box sx={{ flex: { lg: 1 }, display: 'flex', flexDirection: 'column', '& > *': { flex: { lg: 1 } } }}>
            <DropZone
              inputId="pdf-protect-file"
              label={t('pdf.dropLabel')}
              hint={t('pdfSec.protectDropHint')}
              chooseLabel={t('common.choosePdf')}
              multiple={false}
              accept="application/pdf,.pdf"
              onFiles={(files) => void handleFiles(files)}
            />
          </Box>
        )}

        {file && (
          <EditorShell
            main={
              <>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="overline" color="text.secondary">
                          {t('pdf.editDoc')}
                        </Typography>
                        <Typography variant="subtitle1" fontWeight={600} noWrap>
                          {file.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatBytes(file.size)} · {t('pdf.pagesCount', { n: pageCount })}
                        </Typography>
                      </Box>
                      <Button type="button" variant="outlined" size="small" onClick={clearFile}>
                        {t('common.chooseDifferentFile')}
                      </Button>
                    </Box>
                  </CardContent>
                </Card>

                {error && <Alert severity="error">{error}</Alert>}

                {result && (
                  <Box
                    role="status"
                    sx={{
                      borderRadius: 1,
                      border: 1,
                      borderColor: (th) => alpha(th.palette.success.main, 0.4),
                      bgcolor: (th) => alpha(th.palette.success.main, 0.08),
                      p: 2,
                    }}
                  >
                    <Typography variant="body2" fontWeight={600} color="success.main">
                      {t('pdfSec.protectDone', { alg: algorithm, bytes: formatBytes(result.bytes) })}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1.25 }}>
                      <Button
                        type="button"
                        variant="contained"
                        size="small"
                        id="pdf-protect-download"
                        startIcon={<DownloadIcon />}
                        onClick={() => downloadBlob(result.blob, result.filename)}
                      >
                        {t('common.download')} {result.filename}
                      </Button>
                    </Stack>
                  </Box>
                )}
              </>
            }
            tools={
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    {t('common.settings')}
                  </Typography>
                  <Stack spacing={1.75} sx={{ mt: 1 }}>
                    <TextField
                      id="pdf-protect-password"
                      size="small"
                      fullWidth
                      type={showPass ? 'text' : 'password'}
                      label={t('pdfSec.passwordLabel')}
                      value={userPassword}
                      onChange={(e) => setUserPassword(e.target.value)}
                      slotProps={{
                        input: {
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton size="small" onClick={() => setShowPass((v) => !v)} aria-label={t('pdfSec.togglePass')}>
                                {showPass ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        },
                      }}
                    />
                    <TextField
                      id="pdf-protect-confirm"
                      size="small"
                      fullWidth
                      type={showPass ? 'text' : 'password'}
                      label={t('pdfSec.confirmLabel')}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    <Box>
                      <Typography variant="caption" fontWeight={600} component="label" htmlFor="pdf-protect-alg">
                        {t('pdfSec.algorithm')}
                      </Typography>
                      <Select
                        native
                        fullWidth
                        size="small"
                        id="pdf-protect-alg"
                        value={algorithm}
                        onChange={(e) => setAlgorithm(e.target.value as 'AES-256' | 'AES-128')}
                        sx={{ mt: 0.5 }}
                      >
                        <option value="AES-256">AES-256 ({t('pdfSec.recommended')})</option>
                        <option value="AES-128">AES-128</option>
                      </Select>
                    </Box>
                    <Box>
                      <Typography variant="caption" fontWeight={600} color="text.secondary" display="block">
                        {t('pdfSec.permissions')}
                      </Typography>
                      <Stack>
                        <FormControlLabel
                          control={<Checkbox size="small" checked={allowPrint} onChange={(e) => setAllowPrint(e.target.checked)} />}
                          label={<Typography variant="body2">{t('pdfSec.allowPrint')}</Typography>}
                        />
                        <FormControlLabel
                          control={<Checkbox size="small" checked={allowCopy} onChange={(e) => setAllowCopy(e.target.checked)} />}
                          label={<Typography variant="body2">{t('pdfSec.allowCopy')}</Typography>}
                        />
                        <FormControlLabel
                          control={<Checkbox size="small" checked={allowModify} onChange={(e) => setAllowModify(e.target.checked)} />}
                          label={<Typography variant="body2">{t('pdfSec.allowModify')}</Typography>}
                        />
                      </Stack>
                    </Box>
                    <Button
                      type="button"
                      variant="contained"
                      size="large"
                      fullWidth
                      id="pdf-protect-btn"
                      startIcon={<LockOutlinedIcon />}
                      disabled={busy || !userPassword}
                      onClick={() => void handleProtect()}
                    >
                      {busy ? t('pdfSec.protecting') : t('pdfSec.protectBtn')}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            }
          />
        )}

        {!file && error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Box>
  )
}

export function UnlockTool({ initialFiles, onInitialFilesConsumed }: PdfToolProps) {
  const { t } = useI18n()
  const { navigate } = useNavigation()
  const [file, setFile] = useState<File | null>(null)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ blob: Blob; filename: string; bytes: number; pages: number } | null>(null)

  const handleFiles = useCallback(
    async (files: File[]) => {
      const next = files[0]
      if (!next) return
      setError(null)
      setResult(null)
      try {
        const raw = new Uint8Array(await next.arrayBuffer())
        const info = await inspectPdfEncryption(raw)
        if (!info.encrypted) {
          setError(t('pdfSec.errNotEncrypted'))
          return
        }
        setFile(next)
        setBytes(raw)
        setPageCount(info.pageCount)
      } catch (err) {
        setError(t(errorKeyFor(err, 'pdfSec.errInvalidPdf')))
      }
    },
    [t],
  )

  const lastInitialRef = useRef<File[] | null>(null)
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && lastInitialRef.current !== initialFiles) {
      lastInitialRef.current = initialFiles
      void handleFiles(initialFiles)
      onInitialFilesConsumed?.()
    }
  }, [initialFiles, handleFiles, onInitialFilesConsumed])

  const clearFile = () => {
    setFile(null)
    setBytes(null)
    setPageCount(0)
    setPassword('')
    setResult(null)
    setError(null)
  }

  const handleUnlock = async () => {
    if (!bytes || !file || busy) return
    setBusy(true)
    setError(null)
    try {
      const out = await unlockPdf(bytes, password)
      const blob = new Blob([out.data as BlobPart], { type: 'application/pdf' })
      const filename = pdfOutputName(file.name, 'unlocked')
      setResult({ blob, filename, bytes: blob.size, pages: out.pageCount })
      recordActivity({
        fileName: file.name,
        fileSize: file.size,
        fileType: 'application/pdf',
        tool: 'pdf-unlock',
        result: `Unlocked · ${out.pageCount} pages`,
        resultKey: 'act.pdfUnlock',
        resultParams: { n: out.pageCount },
        outputBlob: blob,
        outputName: filename,
      })
    } catch (err) {
      setError(t(errorKeyFor(err, 'pdfSec.errWrongPassword')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box component="section" aria-labelledby="pdf-unlock-heading" sx={{ display: 'flex', flexDirection: 'column', flex: { lg: 1 }, minHeight: { lg: 0 } }}>
      <Stack spacing={2} sx={{ flex: { lg: 1 }, minHeight: { lg: 0 } }}>
        <ToolPageHeader
          headingId="pdf-unlock-heading"
          title={t('pdfSec.unlockTitle')}
          description={t('pdfSec.unlockDesc')}
          actions={
            <WorkflowSteps
              activeStep={!file ? 0 : result ? 2 : 1}
              steps={[t('step.upload'), t('pdfSec.stepUnlock'), t('step.download')]}
            />
          }
        />

        {!file && (
          <Box sx={{ flex: { lg: 1 }, display: 'flex', flexDirection: 'column', '& > *': { flex: { lg: 1 } } }}>
            <DropZone
              inputId="pdf-unlock-file"
              label={t('pdf.dropLabel')}
              hint={t('pdfSec.unlockDropHint')}
              chooseLabel={t('common.choosePdf')}
              multiple={false}
              accept="application/pdf,.pdf"
              onFiles={(files) => void handleFiles(files)}
            />
          </Box>
        )}

        {file && (
          <EditorShell
            main={
              <>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="overline" color="text.secondary">
                          {t('pdf.editDoc')}
                        </Typography>
                        <Typography variant="subtitle1" fontWeight={600} noWrap>
                          {file.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatBytes(file.size)} · {t('pdf.pagesCount', { n: pageCount })} · {t('pdfSec.lockedBadge')}
                        </Typography>
                      </Box>
                      <Button type="button" variant="outlined" size="small" onClick={clearFile}>
                        {t('common.chooseDifferentFile')}
                      </Button>
                    </Box>
                  </CardContent>
                </Card>

                {error && <Alert severity="error">{error}</Alert>}

                {result && (
                  <Box
                    role="status"
                    sx={{
                      borderRadius: 1,
                      border: 1,
                      borderColor: (th) => alpha(th.palette.success.main, 0.4),
                      bgcolor: (th) => alpha(th.palette.success.main, 0.08),
                      p: 2,
                    }}
                  >
                    <Typography variant="body2" fontWeight={600} color="success.main">
                      {t('pdfSec.unlockDone', { n: result.pages, bytes: formatBytes(result.bytes) })}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1.25 }}>
                      <Button
                        type="button"
                        variant="contained"
                        size="small"
                        id="pdf-unlock-download"
                        startIcon={<DownloadIcon />}
                        onClick={() => downloadBlob(result.blob, result.filename)}
                      >
                        {t('common.download')} {result.filename}
                      </Button>
                    </Stack>
                    <Stack
                      direction="row"
                      flexWrap="wrap"
                      spacing={0.5}
                      useFlexGap
                      alignItems="center"
                      sx={{ mt: 1.25, pt: 1.25, borderTop: 1, borderColor: 'divider' }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                        {t('chain.label')}
                      </Typography>
                      {(
                        [
                          { route: 'pdf-edit', label: t('chain.toPdfEdit') },
                          { route: 'pdf-compress', label: t('chain.toPdfCompress') },
                          { route: 'ocr', label: t('chain.toOcr') },
                        ] as const
                      ).map((next) => (
                        <Button
                          key={next.route}
                          type="button"
                          size="small"
                          variant="text"
                          endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
                          onClick={() => {
                            const outFile = new File([result.blob], result.filename, { type: 'application/pdf' })
                            navigate(next.route, { files: [outFile] })
                          }}
                          sx={{ py: 0.25 }}
                        >
                          {next.label}
                        </Button>
                      ))}
                    </Stack>
                  </Box>
                )}
              </>
            }
            tools={
              <Card>
                <CardContent>
                  <Typography variant="overline" color="text.secondary">
                    {t('common.settings')}
                  </Typography>
                  <Stack spacing={1.75} sx={{ mt: 1 }}>
                    <TextField
                      id="pdf-unlock-password"
                      size="small"
                      fullWidth
                      type={showPass ? 'text' : 'password'}
                      label={t('pdfSec.currentPassword')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleUnlock()
                      }}
                      slotProps={{
                        input: {
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton size="small" onClick={() => setShowPass((v) => !v)} aria-label={t('pdfSec.togglePass')}>
                                {showPass ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        },
                      }}
                    />
                    <Button
                      type="button"
                      variant="contained"
                      size="large"
                      fullWidth
                      id="pdf-unlock-btn"
                      startIcon={<LockOpenIcon />}
                      disabled={busy}
                      onClick={() => void handleUnlock()}
                    >
                      {busy ? t('pdfSec.unlocking') : t('pdfSec.unlockBtn')}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            }
          />
        )}

        {!file && error && <Alert severity="error">{error}</Alert>}
      </Stack>
    </Box>
  )
}
