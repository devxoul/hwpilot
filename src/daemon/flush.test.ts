import { describe, expect, it } from 'bun:test'
import { createFlushScheduler } from './flush'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('createFlushScheduler', () => {
  it('batches multiple schedule calls into one flush', async () => {
    let flushCount = 0
    const scheduler = createFlushScheduler(async () => {
      flushCount += 1
    }, 20)

    scheduler.schedule()
    scheduler.schedule()
    scheduler.schedule()

    await sleep(60)
    expect(flushCount).toBe(1)
  })

  it('cancels a pending flush', async () => {
    let flushCount = 0
    const scheduler = createFlushScheduler(async () => {
      flushCount += 1
    }, 20)

    scheduler.schedule()
    scheduler.cancel()

    await sleep(60)
    expect(flushCount).toBe(0)
  })

  it('flushNow flushes immediately and clears pending timer', async () => {
    let flushCount = 0
    const scheduler = createFlushScheduler(async () => {
      flushCount += 1
    }, 20)

    scheduler.schedule()
    await scheduler.flushNow()
    await sleep(60)

    expect(flushCount).toBe(1)
  })
})
