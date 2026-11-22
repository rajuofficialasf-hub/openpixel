/**
 * Help Center (prompt §8/§9): getting started, privacy, terms,
 * about. All honest, all local — there is no account, no server
 * and no support desk; the "contact" route is the GitHub repo.
 */
import { Box, Card, CardContent, Link, Stack, Typography } from '@mui/material'

export function HelpPage() {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h2" id="help-heading">
          Help Center
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          How OpenPixel Studio works, what it does with your files, and what it does not do
        </Typography>
      </Box>

      <Card component="section" aria-labelledby="help-start-heading">
        <CardContent>
          <Typography variant="h6" component="h3" id="help-start-heading">
            Getting started
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Pick a tool from the sidebar or the All Tools page, drop a file in, set the options and download the
            result. Images go to Convert or Resize, PDFs to PDF Tools, text in pictures to OCR. If you drop a
            file on the homepage, it is routed to the right tool for you. Every tool follows the same three
            steps: upload, set options, download.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Keyboard: every control is reachable with Tab, and the drop zone opens the file picker with Enter.
            The site works in light and dark mode (switch in the header or in Settings), and the sidebar
            collapses on narrow screens into a drawer.
          </Typography>
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="help-privacy-heading">
        <CardContent>
          <Typography variant="h6" component="h3" id="help-privacy-heading">
            Privacy
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            OpenPixel Studio has no account, no server and no analytics. Files you drop in are read with the
            File API on your device and processed in your browser (canvas + WebAssembly) — they are never
            uploaded anywhere, because there is nowhere to upload them to. The only thing stored on this device
            is a short history of file names you processed (My Files), kept in your browser’s local storage so
            you can find them again. You can switch that history off or clear it in Settings. The CLI and
            desktop app run the same engine on your own machine and also send nothing anywhere.
          </Typography>
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="help-terms-heading">
        <CardContent>
          <Typography variant="h6" component="h3" id="help-terms-heading">
            Terms
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            OpenPixel Studio is free to use. The software is open source (see the GitHub repository). You are
            responsible for the files you process — in particular, only redact, sign or share files you have the
            right to work with, and keep your own backups: processing replaces nothing, but a redaction
            permanently removes text from the file it produces. PDF password protection uses RC4-128; HEIC
            support involves patented HEVC technology — review the notes in the repository before commercial
            use. No warranty is given; the tools report honestly what they did and what they could not do.
          </Typography>
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="help-about-heading">
        <CardContent>
          <Typography variant="h6" component="h3" id="help-about-heading">
            About
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            OpenPixel Studio is the unified frontend of the OpenPixel Engine — a local, cross-platform file
            processing platform. The engine is written in Rust; the web app runs it in your browser via
            WebAssembly, the CLI and desktop app run it natively. Source code, documentation and downloads:
          </Typography>
          <Link
            href="https://github.com/rajuofficialasf-hub/openpixel"
            target="_blank"
            rel="noreferrer"
            sx={{ display: 'inline-block', mt: 1 }}
          >
            github.com/rajuofficialasf-hub/openpixel
          </Link>
        </CardContent>
      </Card>
    </Stack>
  )
}
