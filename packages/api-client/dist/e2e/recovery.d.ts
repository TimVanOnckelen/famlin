import { type E2eIdentityKeys, type E2ePublicIdentity, type E2eRecoveryBackupV1 } from './types';
/**
 * A new random recovery code, formatted as 8 groups of 4 characters. Always
 * generated, never user-chosen: the server stores what it protects, so only
 * 160 random bits keep an operator from guessing it offline.
 */
export declare function generateRecoveryCode(): string;
export declare function formatRecoveryCode(normalized: string): string;
/** Accepts any spacing/dashes/case and the usual look-alikes; throws invalid_recovery_code. */
export declare function normalizeRecoveryCode(input: string): string;
export declare function sealRecoveryBackup(keys: E2eIdentityKeys, code: string): E2eRecoveryBackupV1;
/**
 * Opens a backup with the user's code and checks the keys inside match the
 * identity the server publishes. Throws invalid_recovery_code (typo in the
 * format), wrong_recovery_code (doesn't open), identity_mismatch.
 */
export declare function openRecoveryBackup(backup: unknown, code: string, expected: E2ePublicIdentity): E2eIdentityKeys;
