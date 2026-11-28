import type { E2eMessagePayloadV1, E2eRecoveryBackupV1, E2eTransferPayloadV1 } from './e2e/types';
import type { ChatConversationMessage } from './chat';
export interface E2ePublishedIdentity {
    version: number;
    signPublicKey: string;
    boxPublicKey: string;
    createdAt: string;
}
export interface E2eOwnIdentity extends E2ePublishedIdentity {
    recoveryBackup: E2eRecoveryBackupV1 | null;
}
export declare const e2eMyIdentitiesQueryKey: () => readonly ['e2e', 'identity', 'me'];
export declare const e2eUserIdentitiesQueryKey: (userId: string) => readonly ['e2e', 'identity', string];
/** Your own identity versions, newest first — the only response carrying recoveryBackup. */
export declare function fetchMyE2eIdentities(): Promise<E2eOwnIdentity[]>;
/** Another user's published identity versions, newest first (empty if they have none yet). */
export declare function fetchUserE2eIdentities(userId: string): Promise<E2ePublishedIdentity[]>;
export interface PublishE2eIdentityBody {
    version: number;
    signPublicKey: string;
    boxPublicKey: string;
    recoveryBackup?: E2eRecoveryBackupV1;
}
/** Publish a new identity version (1 the first time, latest + 1 on a key reset). 409 if not next. */
export declare function publishE2eIdentity(body: PublishE2eIdentityBody): Promise<E2ePublishedIdentity>;
/** Replace (or with null remove) the recovery backup of your latest identity version. */
export declare function updateE2eRecoveryBackup(version: number, recoveryBackup: E2eRecoveryBackupV1 | null): Promise<void>;
/** Existing device: hand the sealed identity to the new device's QR session. */
export declare function putE2eTransfer(sessionId: string, payload: E2eTransferPayloadV1): Promise<void>;
/** New device: poll for the sealed identity. Resolves null while it isn't there yet (404). */
export declare function takeE2eTransfer(sessionId: string): Promise<E2eTransferPayloadV1 | null>;
export interface SendEncryptedChatMessageBody {
    encryption: 'v1';
    encryptedPayload: E2eMessagePayloadV1;
    /** The `/uploads/<uuid>.bin` path from uploadEncryptedAttachment, if any. */
    attachmentUrl?: string;
    replyToMessageId?: string;
}
export declare function sendEncryptedChatMessage(conversationId: string, body: SendEncryptedChatMessageBody): Promise<ChatConversationMessage>;
/**
 * Upload an already-encrypted attachment as an opaque blob. `file` is
 * whatever the platform's FormData accepts: a Blob on web, a
 * `{ uri, name, type }` object on React Native.
 */
export declare function uploadEncryptedAttachment(file: unknown): Promise<string>;
export interface ChatConversationEncryptionState {
    encryptionDisabledAt: string | null;
    encryptionDisabledById: string | null;
}
/** Opt a private conversation out of (or back into) encryption; posts a visible system message. */
export declare function setChatConversationEncryption(conversationId: string, enabled: boolean): Promise<ChatConversationEncryptionState>;
