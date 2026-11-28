/**
 * Encrypt a whole file in memory with a fresh key. v1 is meant for photos the
 * app has already resized; large videos need a chunked format (a future v2).
 * The key and nonce go into the message's encrypted content, the returned
 * bytes are uploaded as an opaque blob.
 */
export declare function encryptAttachment(bytes: Uint8Array): {
    data: Uint8Array;
    key: string;
    nonce: string;
};
/** Throws E2eError('corrupt') if the blob was tampered with or the key is wrong. */
export declare function decryptAttachment(data: Uint8Array, key: string, nonce: string): Uint8Array;
