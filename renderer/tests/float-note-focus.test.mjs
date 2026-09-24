import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

// Structural regression guards complement the actual desktop lifecycle smoke
// test: a focus notification must not recursively cause another native focus.
test("native focus notifications and retries only focus DOM, not the native controller", async () => {
  const native = await readFile(new URL("../../desktop/tauri/src-tauri/src/float_note.rs", import.meta.url), "utf8")
  const focusInput = native.slice(native.indexOf("fn focus_input("), native.indexOf("fn activate_input("))
  assert.ok(focusInput.includes("input.focus("))
  assert.doesNotMatch(focusInput, /\.set_focus\(/)
  const focusedCallback = native.slice(native.indexOf("WindowEvent::Focused(true)"), native.indexOf("WindowEvent::Focused(false)"))
  assert.match(focusedCallback, /focus_input\(&window\)/)
  assert.doesNotMatch(focusedCallback, /activate_input|\.set_focus\(/)
})

test("delayed DOM focus cannot reclaim an inactive or hidden floating window", async () => {
  const renderer = await readFile(new URL("../src/views/FloatNotePage.tsx", import.meta.url), "utf8")
  const focusInput = renderer.slice(renderer.indexOf("function focusInput("), renderer.indexOf("function clearFocusTimers("))
  assert.match(focusInput, /if \([^\n]*!document\.hasFocus\(\)[^\n]*document\.visibilityState !== "visible"\) \{[\s\S]*?return[\s\S]*?input\.focus\(/)
})
