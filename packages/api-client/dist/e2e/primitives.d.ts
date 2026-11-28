import { sha512 } from '@noble/hashes/sha2';
export declare const KEY_BYTES = 32;
export declare const NONCE_BYTES = 24;
/** Needs globalThis.crypto.getRandomValues (browsers, Node; on Hermes via a polyfill). */
export declare function randomBytes(length: number): Uint8Array;
export declare function aeadEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array;
/** Throws E2eError('corrupt') on any authentication failure. */
export declare function aeadDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array;
export declare function deriveKey(ikm: Uint8Array, salt: Uint8Array, info: string): Uint8Array;
export declare function generateSigningKeyPair(): {
    privateKey: Uint8Array<ArrayBufferLike>;
    publicKey: Uint8Array<ArrayBufferLike>;
};
export declare function generateBoxKeyPair(): {
    privateKey: Uint8Array<ArrayBufferLike>;
    publicKey: Uint8Array<ArrayBufferLike>;
};
export declare function signingPublicKey(privateKey: Uint8Array): Uint8Array;
export declare function boxPublicKey(privateKey: Uint8Array): Uint8Array;
export declare function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
export declare function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
export { sha512 };
export interface SealedBox {
    epk: string;
    nonce: string;
    ct: string;
}
/**
 * Encrypt `secret` so only the holder of `recipientBoxPublicKey`'s private key
 * can open it: ephemeral X25519 → HKDF-SHA256 (salt = epk ‖ recipient key,
 * info = domain label) → XChaCha20-Poly1305 with the caller's AAD.
 */
export declare function sealTo(secret: Uint8Array, recipientBoxPublicKey: Uint8Array, info: string, aad: Uint8Array): SealedBox;
/** Inverse of sealTo; throws E2eError('corrupt') if anything doesn't match. */
export declare function openSealed(box: SealedBox, recipientBoxPrivateKey: Uint8Array, info: string, aad: Uint8Array): Uint8Array;
/** Decode a base64 key field, requiring an exact length. */
export declare function decodeKey(value: unknown, length?: number): Uint8Array;
