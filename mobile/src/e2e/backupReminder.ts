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

/**
 * Keys follow the person automatically through iCloud Keychain / Google's
 * backup, so a recovery code is only worth nagging about on Android when
 * Block Store can't hold them end-to-end encrypted. iOS can't tell whether
 * iCloud Keychain is on, so it never nags.
 */
export function needsRecoveryCodeBackup(input: {
  platform: string
  sync: { available: boolean; endToEndEncrypted: boolean | null } | undefined
  hasRecoveryCode: boolean
}): boolean {
  if (input.hasRecoveryCode || input.platform !== 'android') return false
  // Still checking: don't flash a reminder.
  if (!input.sync) return false
  return !(input.sync.available && input.sync.endToEndEncrypted === true)
}
