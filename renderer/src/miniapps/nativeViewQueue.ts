/** Serialize native side effects, including late completion after a caller times out.
 * A deadline rejects the UI's wait; it cannot cancel IPC or release the native lane.
 * Releasing that lane early would let a stale show cover a different route.
 */
export class NativeViewOperationQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(operation: () => Promise<T>, timeoutMs = 15_000): Promise<T> {
    const actual = this.tail.then(operation)
    this.tail = actual.catch(() => undefined)
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("内置网页操作超时；可切换到其他功能，稍后重试。")), timeoutMs)
      actual.then(
        value => { clearTimeout(timeout); resolve(value) },
        error => { clearTimeout(timeout); reject(error) }
      )
    })
  }
}

export const nativeViewQueue = new NativeViewOperationQueue()
