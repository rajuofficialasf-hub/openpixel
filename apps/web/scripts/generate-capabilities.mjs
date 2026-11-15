#!/usr/bin/env node
/**
 * Regenerate `src/data/capabilities.json` from the Rust engine.
 *
 * The web app must never hand-write its own format list: the list is
 * generated from the registry by running the release CLI:
 *
 *   ../../target/release/openpixel --json formats
 *
 * Run with `npm run generate:capabilities` (from apps/web). It fails
 * loudly — non-zero exit, no file written — when the CLI binary is
 * missing, the command fails, the output is not valid JSON, or the
 * list does not look like the registry (fewer than 21 entries, or
 * any entry missing format_id / can_decode / can_encode). That way a
 * stale or hand-edited list cannot slip in silently.
 *
 * The checked-in file is the output of this script; regenerate it
 * whenever the engine's registry changes (a new format, a codec
 * added/removed) and commit the result with the engine change.
 */
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const cli = join(repoRoot, 'target', 'release', 'openpixel')
const outPath = join(here, '..', 'src', 'data', 'capabilities.json')

function fail(message) {
  console.error(`generate-capabilities: ${message}`)
  process.exit(1)
}

let stdout
try {
  ;({ stdout } = await execFileAsync(cli, ['--json', 'formats'], { maxBuffer: 1024 * 1024 }))
} catch (err) {
  fail(
    `could not run the engine CLI at ${cli} — build it first with ` +
      '`cargo build --release` from the repo root.\n' +
      `  ${err.message}`,
  )
}

let capabilities
try {
  capabilities = JSON.parse(stdout)
} catch {
  fail('the CLI output did not parse as JSON; refusing to write capabilities.json.')
}

if (!Array.isArray(capabilities) || capabilities.length < 21) {
  fail(
    `expected at least 21 formats from the registry, got ` +
      `${Array.isArray(capabilities) ? capabilities.length : 'non-array output'}.`,
  )
}
for (const cap of capabilities) {
  if (
    typeof cap.format_id !== 'string' ||
    typeof cap.can_decode !== 'boolean' ||
    typeof cap.can_encode !== 'boolean' ||
    !Array.isArray(cap.extensions) ||
    cap.extensions.length === 0
  ) {
    fail(`registry entry is missing required fields: ${JSON.stringify(cap)}`)
  }
}

await writeFile(outPath, `${JSON.stringify(capabilities, null, 2)}\n`, 'utf8')
console.log(
  `generate-capabilities: wrote ${capabilities.length} formats to src/data/capabilities.json ` +
    `(source: ${cli} --json formats)`,
)
