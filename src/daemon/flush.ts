export type FlushScheduler = {
  schedule(): void
  cancel(): void
  flushNow(): Promise<void>
}

export function createFlushScheduler(flushFn: () => Promise<void>, debounceMs: number): FlushScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    await flushFn()
  }

  return {
    schedule(): void {
      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        timer = null
        flushFn().catch((err) => process.stderr.write(`flush error: ${String(err)}\n`))
      }, debounceMs)
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    async flushNow(): Promise<void> {
      await flush()
    },
  }
}
