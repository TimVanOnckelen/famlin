import { type E2eIdentityKeys, type E2ePublicIdentity } from './types';
/** A fresh identity for `userId`; `version` is 1 for a first identity, previous + 1 on a reset. */
export declare function generateIdentity(userId: string, version: number): E2eIdentityKeys;
export declare function publicIdentity(keys: E2eIdentityKeys): E2ePublicIdentity;
/**
 * Checks private keys really belong to a published identity: their derived
 * public keys must equal it. Used after a restore or transfer, so keys handed
 * over by a malicious relay are never adopted.
 */
export declare function assertKeysMatchIdentity(keys: E2eIdentityKeys, expected: E2ePublicIdentity): void;
/**
 * The safety code two people compare to verify nobody (including the server)
 * swapped their keys: 12 groups of 5 digits, identical on both sides because
 * the two identities are ordered by userId first.
 */
export declare function safetyCode(a: E2ePublicIdentity, b: E2ePublicIdentity): string;
