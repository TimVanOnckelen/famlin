"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptAttachment = encryptAttachment;
exports.decryptAttachment = decryptAttachment;
const encoding_1 = require("./encoding");
const primitives_1 = require("./primitives");
const AAD = (0, encoding_1.canonical)(['famlin-e2e-v1/attachment']);
/**
 * Encrypt a whole file in memory with a fresh key. v1 is meant for photos the
 * app has already resized; large videos need a chunked format (a future v2).
 * The key and nonce go into the message's encrypted content, the returned
 * bytes are uploaded as an opaque blob.
 */
function encryptAttachment(bytes) {
    const key = (0, primitives_1.randomBytes)(primitives_1.KEY_BYTES);
    const nonce = (0, primitives_1.randomBytes)(primitives_1.NONCE_BYTES);
    return { data: (0, primitives_1.aeadEncrypt)(key, nonce, bytes, AAD), key: (0, encoding_1.toBase64)(key), nonce: (0, encoding_1.toBase64)(nonce) };
}
/** Throws E2eError('corrupt') if the blob was tampered with or the key is wrong. */
function decryptAttachment(data, key, nonce) {
    return (0, primitives_1.aeadDecrypt)((0, primitives_1.decodeKey)(key), (0, primitives_1.decodeKey)(nonce, primitives_1.NONCE_BYTES), data, AAD);
}
