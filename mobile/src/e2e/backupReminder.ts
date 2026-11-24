import type { E2eMeta } from '@/e2e/keyStore'

export const BACKUP_REMINDER_MIN_SENT = 5
export const BACKUP_REMINDER_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

/** A gentle, dismissible nudge in the inbox: only after real use, never inside a conversation. */
export function shouldShowBackupReminder(input: { meta: E2eMeta; hasBackup: boolean; now?: number }): boolean {
  if (input.hasBackup) return false
  if ((input.meta.encryptedSent ?? 0) < BACKUP_REMINDER_MIN_SENT) return false
  const dismissed = input.meta.backupReminderDismissedAt
  return dismissed === undefined || (input.now ?? Date.now()) - dismissed >= BACKUP_REMINDER_SNOOZE_MS
}
