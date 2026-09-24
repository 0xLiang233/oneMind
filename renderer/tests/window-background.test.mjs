import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('Windows main window remains opaque without requiring native effects', async () => {
  const config = JSON.parse(await read('../../desktop/tauri/src-tauri/tauri.windows.conf.json'))
  assert.equal(config.app.windows.length, 1)
  assert.equal(config.app.windows[0].transparent, false)
  assert.equal(config.app.windows[0].windowEffects, undefined)
})

test('renderer does not infer native backdrop support from a Windows user agent', async () => {
  const bridge = await read('../src/platform/tauriBridge.ts')
  assert.doesNotMatch(bridge, /nativeBackdrop\s*=/)
})

test('shell keeps a solid base even with a stale Mica marker', async () => {
  const css = await read('../src/styles/workbench-shell.css')
  assert.doesNotMatch(css, /\[data-native-backdrop/)
  assert.match(css, /\.app-shell\s*\{background:[^;]*var\(--workbench-shell\)/)
  assert.doesNotMatch(css, /background:var\(--workbench-tint\)/)
  const tokens = await read('../src/index.css')
  const shellColors = [...tokens.matchAll(/--workbench-shell\s*:\s*([^;\s}]+)/g)]
  assert.ok(shellColors.length >= 2, 'Both light and dark theme colors must exist')
  for (const [, color] of shellColors) assert.match(color, /^#[\da-f]{6}$/i)
})

test('standalone floating note retains its intentional transparency', async () => {
  const native = await read('../../desktop/tauri/src-tauri/src/float_note.rs')
  const floatBuilder = native.slice(native.indexOf('fn ensure_float_note_window'))
  assert.match(floatBuilder.slice(0, floatBuilder.indexOf('.build()')), /\.transparent\(true\)/)
})
