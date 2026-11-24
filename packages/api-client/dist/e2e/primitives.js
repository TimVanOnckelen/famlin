"use strict";
// The only place the E2E module touches cryptographic primitives. Everything
// is audited @noble code; nothing here is home-grown cryptography, only how
// the primitives are combined.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha512 = exports.NONCE_BYTES = exports.KEY_BYTES = void 0;
exports.randomBytes = randomBytes;
exports.aeadEncrypt = aeadEncrypt;
exports.aeadDecrypt = aeadDecrypt;
exports.deriveKey = deriveKey;
exports.generateSigningKeyPair = generateSigningKeyPair;
exports.generateBoxKeyPair = generateBoxKeyPair;
exports.signingPublicKey = signingPublicKey;
exports.boxPublicKey = boxPublicKey;
exports.sign = sign;
exports.verify = verify;
exports.sealTo = sealTo;
exports.openSealed = openSealed;
exports.decodeKey = decodeKey;
const ed25519_1 = require("@noble/curves/ed25519");
const chacha_1 = require("@noble/ciphers/chacha");
const webcrypto_1 = require("@noble/ciphers/webcrypto");
const hkdf_1 = require("@noble/hashes/hkdf");
const sha2_1 = require("@noble/hashes/sha2");
Object.defineProperty(exports, "sha512", { enumerable: true, get: function () { return sha2_1.sha512; } });
const types_1 = require("./types");
const encoding_1 = require("./encoding");
exports.KEY_BYTES = 32;
exports.NONCE_BYTES = 24;
/** Needs globalThis.crypto.getRandomValues (browsers, Node; on Hermes via a polyfill). */
function randomBytes(length) {
    return (0, webcrypto_1.randomBytes)(length);
}
function aeadEncrypt(key, nonce, plaintext, aad) {
    return (0, chacha_1.xchacha20poly1305)(key, nonce, aad).encrypt(plaintext);
}
/** Throws E2eError('corrupt') on any authentication failure. */
function aeadDecrypt(key, nonce, ciphertext, aad) {
    try {
        return (0, chacha_1.xchacha20poly1305)(key, nonce, aad).decrypt(ciphertext);
    }
    catch {
        throw new types_1.E2eError('corrupt');
    }
}
function deriveKey(ikm, salt, info) {
    return (0, hkdf_1.hkdf)(sha2_1.sha256, ikm, salt, info, exports.KEY_BYTES);
}
function generateSigningKeyPair() {
    const privateKey = ed25519_1.ed25519.utils.randomPrivateKey();
    return { privateKey, publicKey: ed25519_1.ed25519.getPublicKey(privateKey) };
}
function generateBoxKeyPair() {
    const privateKey = ed25519_1.x25519.utils.randomPrivateKey();
    return { privateKey, publicKey: ed25519_1.x25519.getPublicKey(privateKey) };
}
function signingPublicKey(privateKey) {
    return ed25519_1.ed25519.getPublicKey(privateKey);
}
function boxPublicKey(privateKey) {
    return ed25519_1.x25519.getPublicKey(privateKey);
}
function sign(message, privateKey) {
    return ed25519_1.ed25519.sign(message, privateKey);
}
function verify(signature, message, publicKey) {
    try {
        return ed25519_1.ed25519.verify(signature, message, publicKey);
    }
    catch {
        return false;
    }
}
/**
 * Encrypt `secret` so only the holder of `recipientBoxPublicKey`'s private key
 * can open it: ephemeral X25519 → HKDF-SHA256 (salt = epk ‖ recipient key,
 * info = domain label) → XChaCha20-Poly1305 with the caller's AAD.
 */
function sealTo(secret, recipientBoxPublicKey, info, aad) {
    const ephemeral = generateBoxKeyPair();
    const shared = ed25519_1.x25519.getSharedSecret(ephemeral.privateKey, recipientBoxPublicKey);
    const kek = deriveKey(shared, (0, encoding_1.canonical)([ephemeral.publicKey, recipientBoxPublicKey]), info);
    const nonce = randomBytes(exports.NONCE_BYTES);
    return {
        epk: (0, encoding_1.toBase64)(ephemeral.publicKey),
        nonce: (0, encoding_1.toBase64)(nonce),
        ct: (0, encoding_1.toBase64)(aeadEncrypt(kek, nonce, secret, aad)),
    };
}
/** Inverse of sealTo; throws E2eError('corrupt') if anything doesn't match. */
function openSealed(box, recipientBoxPrivateKey, info, aad) {
    let epk;
    let nonce;
    let ct;
    let shared;
    try {
        epk = (0, encoding_1.fromBase64)(box.epk);
        nonce = (0, encoding_1.fromBase64)(box.nonce);
        ct = (0, encoding_1.fromBase64)(box.ct);
        if (epk.length !== exports.KEY_BYTES || nonce.length !== exports.NONCE_BYTES)
            throw new Error('length');
        shared = ed25519_1.x25519.getSharedSecret(recipientBoxPrivateKey, epk);
    }
    catch {
        throw new types_1.E2eError('corrupt');
    }
    const recipientPublicKey = boxPublicKey(recipientBoxPrivateKey);
    const kek = deriveKey(shared, (0, encoding_1.canonical)([epk, recipientPublicKey]), info);
    return aeadDecrypt(kek, nonce, ct, aad);
}
/** Decode a base64 key field, requiring an exact length. */
function decodeKey(value, length = exports.KEY_BYTES) {
    if (typeof value !== 'string')
        throw new types_1.E2eError('corrupt');
    let bytes;
    try {
        bytes = (0, encoding_1.fromBase64)(value);
    }
    catch {
        throw new types_1.E2eError('corrupt');
    }
    if (bytes.length !== length)
        throw new types_1.E2eError('corrupt');
    return bytes;
}
