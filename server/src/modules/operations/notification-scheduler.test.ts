import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { startNotificationScheduler } from './notification-scheduler.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('notification scheduler', () => {
  it('runs the harvest scan immediately and every six hours', async () => {
    vi.useFakeTimers()
    const query = vi.fn().mockResolvedValue({ rows: [{ generate_harvest_reminders: 0 }] })
    const stop = startNotificationScheduler({ query } as unknown as Pool)
    expect(query).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(query).toHaveBeenCalledTimes(2)
    stop()
  })
})
