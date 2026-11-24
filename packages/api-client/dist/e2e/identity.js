"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateIdentity = generateIdentity;
exports.publicIdentity = publicIdentity;
exports.assertKeysMatchIdentity = assertKeysMatchIdentity;
exports.safetyCode = safetyCode;
const encoding_1 = require("./encoding");
const primitives_1 = require("./primitives");
const types_1 = require("./types");
/** A fresh identity for `userId`; `version` is 1 for a first identity, previous + 1 on a reset. */
function generateIdentity(userId, version) {
    const signing = (0, primitives_1.generateSigningKeyPair)();
    const box = (0, primitives_1.generateBoxKeyPair)();
    return {
        userId,
        version,
        signPublicKey: (0, encoding_1.toBase64)(signing.publicKey),
        boxPublicKey: (0, encoding_1.toBase64)(box.publicKey),
        signPrivateKey: (0, encoding_1.toBase64)(signing.privateKey),
        boxPrivateKey: (0, encoding_1.toBase64)(box.privateKey),
    };
}
function publicIdentity(keys) {
    return {
        userId: keys.userId,
        version: keys.version,
        signPublicKey: keys.signPublicKey,
        boxPublicKey: keys.boxPublicKey,
    };
}
/**
 * Checks private keys really belong to a published identity: their derived
 * public keys must equal it. Used after a restore or transfer, so keys handed
 * over by a malicious relay are never adopted.
 */
function assertKeysMatchIdentity(keys, expected) {
    const ok = keys.userId === expected.userId &&
        keys.version === expected.version &&
        (0, encoding_1.bytesEqual)((0, primitives_1.signingPublicKey)((0, primitives_1.decodeKey)(keys.signPrivateKey)), (0, primitives_1.decodeKey)(expected.signPublicKey)) &&
        (0, encoding_1.bytesEqual)((0, primitives_1.boxPublicKey)((0, primitives_1.decodeKey)(keys.boxPrivateKey)), (0, primitives_1.decodeKey)(expected.boxPublicKey));
    if (!ok)
        throw new types_1.E2eError('identity_mismatch');
}
/**
 * The safety code two people compare to verify nobody (including the server)
 * swapped their keys: 12 groups of 5 digits, identical on both sides because
 * the two identities are ordered by userId first.
 */
function safetyCode(a, b) {
    const [first, second] = [a, b].sort((x, y) => (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0));
    const digest = (0, primitives_1.sha512)((0, encoding_1.canonical)([
        'famlin-e2e-v1/safety-code',
        first.userId,
        (0, primitives_1.decodeKey)(first.signPublicKey),
        (0, primitives_1.decodeKey)(first.boxPublicKey),
        second.userId,
        (0, primitives_1.decodeKey)(second.signPublicKey),
        (0, primitives_1.decodeKey)(second.boxPublicKey),
    ]));
    const groups = [];
    for (let i = 0; i < 12; i++) {
        // 5 bytes → 40-bit number → 5 decimal digits (bias is irrelevant for a
        // human comparison code).
        let n = 0;
        for (let j = 0; j < 5; j++)
            n = n * 256 + digest[i * 5 + j];
        groups.push(String(n % 100000).padStart(5, '0'));
    }
    return groups.join(' ');
}
