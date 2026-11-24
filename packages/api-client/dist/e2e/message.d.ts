import { type E2eIdentityKeys, type E2eMessageContentV1, type E2eMessagePayloadV1, type E2ePublicIdentity } from './types';
/** A random message id for E2eMessageContentV1.mid. */
export declare function newMessageId(): string;
export interface EncryptMessageInput {
    conversationId: string;
    /** The sender's own current identity (private keys). */
    sender: E2eIdentityKeys;
    /** Every participant's current public identity; the sender is added if missing. */
    recipients: E2ePublicIdentity[];
    content: E2eMessageContentV1;
}
export declare function encryptMessage({ conversationId, sender, recipients, content, }: EncryptMessageInput): E2eMessagePayloadV1;
/** Strict shape check of a stored payload; throws unknown_version / corrupt. */
export declare function parseMessagePayload(value: unknown): E2eMessagePayloadV1;
export interface DecryptMessageInput {
    payload: unknown;
    conversationId: string;
    authorId: string;
    /** The author's published identity for `payload.senderKeyVersion`. */
    senderIdentity: E2ePublicIdentity;
    /** Every identity version this device holds for the current user. */
    myKeys: E2eIdentityKeys[];
}
/**
 * Verify, then decrypt. The signature is checked before anything is opened,
 * so a server that rewrote the key list or forged the author is rejected
 * (`bad_signature`) rather than producing attacker-chosen plaintext.
 */
export declare function decryptMessage({ payload: raw, conversationId, authorId, senderIdentity, myKeys, }: DecryptMessageInput): E2eMessageContentV1;
