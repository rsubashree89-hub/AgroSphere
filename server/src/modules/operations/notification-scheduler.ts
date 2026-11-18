import type { Pool } from 'pg'

const harvestReminderIntervalMs = 6 * 60 * 60 * 1000

export function startNotificationScheduler(pool: Pool) {
  const checkHarvestWindows = () => {
    void pool.query('SELECT generate_harvest_reminders()').catch((error: unknown) => {
      console.error('Failed to generate scheduled harvest reminders:', error)
    })
  }

  checkHarvestWindows()
  const timer = setInterval(checkHarvestWindows, harvestReminderIntervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
