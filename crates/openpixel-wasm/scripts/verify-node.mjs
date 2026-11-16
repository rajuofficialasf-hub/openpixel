#!/usr/bin/env node
/**
 * Standalone verification for the `openpixel-wasm` Node.js package.
 *
 * This is NOT the test suite (`wasm-pack test --node` runs the
 * in-wasm tests in `src/lib.rs`). This script imports the *built*
 * package exactly as a JS consumer would and converts a real image,
 * so it proves the shipped artifact — not just the test harness —
 * works end to end.
 *
 * Usage (from the repo root):
 *   wasm-pack build crates/openpixel-wasm --target nodejs \
 *     --out-dir /tmp/openpixel-wasm-node
 *   node crates/openpixel-wasm/scripts/verify-node.mjs \
 *     /tmp/openpixel-wasm-node \
 *     crates/openpixel-codecs/tests/fixtures/checker-64.ref.png \
 *     /tmp/openpixel-wasm-verify-out
 *
 * Exit code is 0 only when every check passes; any failure prints
 * the check that failed and exits 1.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [pkgDir, fixturePath, outDir] = process.argv.slice(2)
if (!pkgDir || !fixturePath || !outDir) {
  console.error(
    'usage: verify-node.mjs <wasm-nodejs-pkg-dir> <input-png> <out-dir>',
  )
  process.exit(2)
}

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

const wasm = await import(pathToFileURL(join(pkgDir, 'openpixel_wasm.js')).href)
// `--target nodejs` initialises synchronously on import and exposes
// the functions as named exports; `--target web` instead exports an
// async default init function. Call it only when it is a function.
if (typeof wasm.default === 'function') await wasm.default()

const png = new Uint8Array(await readFile(fixturePath))
check('version() reports the engine version', wasm.version() === '0.1.0', wasm.version())
check('detect(png) == png', wasm.detect(png) === 'png', wasm.detect(png))

const info = wasm.info(png)
check('info(png) is 64x64', info.width === 64 && info.height === 64, `${info.width}x${info.height}`)
check('info(png) format is png', info.format === 'png', String(info.format))

const caps = wasm.capabilities()
check('capabilities() lists 21 formats', caps.length === 21, String(caps.length))
const avif = caps.find((c) => c.format_id === 'avif')
check('AVIF is listed but unavailable in the wasm build', avif && !avif.can_decode && !avif.can_encode)

const supported = wasm.supported_formats()
check('supported_formats() encodes jpeg/png/webp', ['jpeg', 'png', 'webp'].every((f) => supported.encode.includes(f)))
check('supported_formats() does not encode avif', !supported.encode.includes('avif'))

await mkdir(outDir, { recursive: true })
for (const target of ['jpeg', 'webp', 'png', 'tiff', 'qoi', 'heic', 'jxl']) {
  // One conversion passes an explicit flatten background, as the web
  // UI does; the rest use the engine default (white).
  const out = wasm.convert(png, target, 80, target === 'jpeg' ? '#000000' : undefined)
  const detected = wasm.detect(out)
  const expected = target === 'jpeg' ? 'jpeg' : target
  check(`convert png -> ${target} re-detects as ${expected}`, detected === expected, `got ${detected}, ${out.length} bytes`)
  await writeFile(join(outDir, `checker-64.${target === 'jpeg' ? 'jpg' : target}`), out)
}

let avifError = ''
try {
  wasm.convert(png, 'avif', 80, undefined)
} catch (err) {
  avifError = String(err)
}
check('convert png -> avif throws (honest unavailability)', avifError.length > 0, avifError)

let unknownError = ''
try {
  wasm.convert(new Uint8Array([1, 2, 3, 4]), 'png', 80, undefined)
} catch (err) {
  unknownError = String(err)
}
check('convert of unknown bytes throws', unknownError.length > 0, unknownError)

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll wasm-node verification checks passed.')
