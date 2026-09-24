import assert from "node:assert/strict"
import test from "node:test"
import { NativeViewOperationQueue } from "../src/miniapps/nativeViewQueue.ts"

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test("route cleanup waits for slow show before opening the next view", async () => {
  const queue = new NativeViewOperationQueue()
  const show = deferred()
  const calls = []
  const first = queue.run(async () => { calls.push("show"); await show.promise; calls.push("shown") })
  const cleanup = queue.run(async () => { calls.push("close") })
  const next = queue.run(async () => { calls.push("next") })
  await Promise.resolve()
  assert.deepEqual(calls, ["show"])
  show.resolve()
  await Promise.all([first, cleanup, next])
  assert.deepEqual(calls, ["show", "shown", "close", "next"])
})

test("a timeout informs the UI without letting stale native work overtake cleanup", async () => {
  const queue = new NativeViewOperationQueue()
  const show = deferred()
  const calls = []
  const first = queue.run(async () => { await show.promise; calls.push("shown") }, 10)
  const cleanup = queue.run(async () => { calls.push("closed") })
  await assert.rejects(first, /超时/)
  assert.deepEqual(calls, [])
  show.resolve()
  await cleanup
  assert.deepEqual(calls, ["shown", "closed"])
})

test("a rejected operation never poisons later show, hide, or close", async () => {
  const queue = new NativeViewOperationQueue()
  await assert.rejects(queue.run(async () => { throw new Error("native failure") }), /native failure/)
  assert.equal(await queue.run(async () => true), true)
})

test("a queued timeout keeps its place and a late rejection still releases cleanup", async () => {
  const queue = new NativeViewOperationQueue()
  const gate = deferred()
  const calls = []
  const first = queue.run(async () => { calls.push("first"); await gate.promise })
  const queued = queue.run(async () => { calls.push("late"); throw new Error("late failure") }, 10)
  const cleanup = queue.run(async () => { calls.push("cleanup"); return "closed" })
  await assert.rejects(queued, /超时/)
  assert.deepEqual(calls, ["first"])
  gate.resolve()
  await first
  assert.equal(await cleanup, "closed")
  assert.deepEqual(calls, ["first", "late", "cleanup"])
  assert.equal(await queue.run(async () => "usable"), "usable")
})
