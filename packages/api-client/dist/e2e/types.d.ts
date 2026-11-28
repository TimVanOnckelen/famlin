/** Value of ChatMessage.encryption for messages in this format. */
export declare const E2E_MESSAGE_ENCRYPTION = "v1";
/** A user's published identity (one per version; a key reset adds a version). */
export interface E2ePublicIdentity {
    userId: string;
    version: number;
    /** Ed25519 public key, base64 (32 bytes). Signs every message the user sends. */
    signPublicKey: string;
    /** X25519 public key, base64 (32 bytes). Message keys are sealed to it. */
    boxPublicKey: string;
}
/** The private half, kept only on the user's own devices. */
export interface E2eIdentityKeys extends E2ePublicIdentity {
    signPrivateKey: string;
    boxPrivateKey: string;
}
/** The message's content key, sealed to one participant's identity version. */
export interface E2eKeyEntryV1 {
    userId: string;
    keyVersion: number;
    /** Ephemeral X25519 public key, base64. */
    epk: string;
    nonce: string;
    /** The 32-byte content key, XChaCha20-Poly1305-encrypted under the derived KEK. */
    wk: string;
}
/** Stored in ChatMessage.encryptedPayload when encryption === 'v1'. */
export interface E2eMessagePayloadV1 {
    v: 1;
    senderKeyVersion: number;
    nonce: string;
    ct: string;
    keys: E2eKeyEntryV1[];
    /** Ed25519 signature by the sender over everything above plus the conversation and author. */
    sig: string;
}
/** An encrypted photo: the blob on the server is opaque, the key lives here. */
export interface E2eAttachmentV1 {
    /** The `/uploads/<uuid>.bin` path the blob was uploaded to. */
    url: string;
    key: string;
    nonce: string;
    mime: string;
    size: number;
    width?: number;
    height?: number;
    /** Tiny inline preview (base64 JPEG), shown while the full blob downloads. */
    thumbnail?: string;
}
/** The plaintext inside a v1 message. */
export interface E2eMessageContentV1 {
    /** Random client id; lets clients drop a ciphertext the server replays twice. */
    mid: string;
    text?: string;
    attachment?: E2eAttachmentV1;
}
/** The identity's private keys, encrypted under the user's recovery code and stored on the server. */
export interface E2eRecoveryBackupV1 {
    v: 1;
    salt: string;
    nonce: string;
    ct: string;
}
/** Device-to-device hand-over of the identity, relayed by the server. */
export interface E2eTransferPayloadV1 {
    v: 1;
    epk: string;
    nonce: string;
    ct: string;
}
export type E2eErrorCode = 
/** The payload doesn't parse as any known format, or authentication failed. */
'corrupt'
/** A format version this app doesn't know (sent by a newer app). */
 | 'unknown_version'
/** The message wasn't sealed to any identity version this device holds. */
 | 'no_key_for_me'
/** The sender's signature doesn't verify: forged or tampered with. */
 | 'bad_signature'
/** The sender identity passed in doesn't match the payload's key version. */
 | 'sender_key_mismatch' | 'invalid_recovery_code' | 'wrong_recovery_code'
/** Restored/transferred keys don't match the identity the server publishes. */
 | 'identity_mismatch' | 'invalid_transfer_code';
/** Errors carry a stable code (never key material) so the UI can explain why. */
export declare class E2eError extends Error {
    readonly code: E2eErrorCode;
    constructor(code: E2eErrorCode);
}
