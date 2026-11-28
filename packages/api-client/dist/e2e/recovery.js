"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRecoveryCode = generateRecoveryCode;
exports.formatRecoveryCode = formatRecoveryCode;
exports.normalizeRecoveryCode = normalizeRecoveryCode;
exports.sealRecoveryBackup = sealRecoveryBackup;
exports.openRecoveryBackup = openRecoveryBackup;
const encoding_1 = require("./encoding");
const identity_1 = require("./identity");
const primitives_1 = require("./primitives");
const types_1 = require("./types");
// Crockford base32: no I, L, O or U, so a code survives being read aloud,
// handwritten or retyped.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BYTES = 20; // 160 bits → exactly 32 characters
const CODE_CHARS = 32;
const INFO = 'famlin-e2e-v1/recovery';
function aad(userId, version) {
    return (0, encoding_1.canonical)(['famlin-e2e-v1/recovery-aad', userId, String(version)]);
}
function encodeBase32(bytes) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
}
function decodeBase32(text) {
    const out = [];
    let bits = 0;
    let value = 0;
    for (const char of text) {
        const index = ALPHABET.indexOf(char);
        if (index < 0)
            throw new types_1.E2eError('invalid_recovery_code');
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return new Uint8Array(out);
}
/**
 * A new random recovery code, formatted as 8 groups of 4 characters. Always
 * generated, never user-chosen: the server stores what it protects, so only
 * 160 random bits keep an operator from guessing it offline.
 */
function generateRecoveryCode() {
    return formatRecoveryCode(encodeBase32((0, primitives_1.randomBytes)(CODE_BYTES)));
}
function formatRecoveryCode(normalized) {
    return normalized.match(/.{1,4}/g).join('-');
}
/** Accepts any spacing/dashes/case and the usual look-alikes; throws invalid_recovery_code. */
function normalizeRecoveryCode(input) {
    const normalized = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    if (normalized.length !== CODE_CHARS || [...normalized].some((c) => !ALPHABET.includes(c))) {
        throw new types_1.E2eError('invalid_recovery_code');
    }
    return normalized;
}
function codeKey(code, salt) {
    // The code already carries 160 bits of entropy, so a slow password hash
    // would add nothing but seconds on an older phone; HKDF is enough.
    return (0, primitives_1.deriveKey)(decodeBase32(normalizeRecoveryCode(code)), salt, INFO);
}
function sealRecoveryBackup(keys, code) {
    const salt = (0, primitives_1.randomBytes)(16);
    const nonce = (0, primitives_1.randomBytes)(primitives_1.NONCE_BYTES);
    const plaintext = (0, encoding_1.utf8Encode)(JSON.stringify({
        userId: keys.userId,
        version: keys.version,
        signPrivateKey: keys.signPrivateKey,
        boxPrivateKey: keys.boxPrivateKey,
    }));
    return {
        v: 1,
        salt: (0, encoding_1.toBase64)(salt),
        nonce: (0, encoding_1.toBase64)(nonce),
        ct: (0, encoding_1.toBase64)((0, primitives_1.aeadEncrypt)(codeKey(code, salt), nonce, plaintext, aad(keys.userId, keys.version))),
    };
}
/**
 * Opens a backup with the user's code and checks the keys inside match the
 * identity the server publishes. Throws invalid_recovery_code (typo in the
 * format), wrong_recovery_code (doesn't open), identity_mismatch.
 */
function openRecoveryBackup(backup, code, expected) {
    if (typeof backup !== 'object' || backup === null)
        throw new types_1.E2eError('corrupt');
    const b = backup;
    if (b.v !== 1)
        throw new types_1.E2eError('unknown_version');
    let salt, nonce, ct;
    try {
        salt = (0, encoding_1.fromBase64)(b.salt);
        nonce = (0, encoding_1.fromBase64)(b.nonce);
        ct = (0, encoding_1.fromBase64)(b.ct);
    }
    catch {
        throw new types_1.E2eError('corrupt');
    }
    if (nonce.length !== primitives_1.NONCE_BYTES)
        throw new types_1.E2eError('corrupt');
    const derived = codeKey(code, salt);
    let plaintext;
    try {
        plaintext = (0, primitives_1.aeadDecrypt)(derived, nonce, ct, aad(expected.userId, expected.version));
    }
    catch {
        throw new types_1.E2eError('wrong_recovery_code');
    }
    let parsed;
    try {
        parsed = JSON.parse((0, encoding_1.utf8Decode)(plaintext));
    }
    catch {
        throw new types_1.E2eError('corrupt');
    }
    const keys = {
        userId: parsed.userId,
        version: parsed.version,
        signPrivateKey: parsed.signPrivateKey,
        boxPrivateKey: parsed.boxPrivateKey,
        signPublicKey: expected.signPublicKey,
        boxPublicKey: expected.boxPublicKey,
    };
    (0, identity_1.assertKeysMatchIdentity)(keys, expected);
    return keys;
}
