"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newMessageId = newMessageId;
exports.encryptMessage = encryptMessage;
exports.parseMessagePayload = parseMessagePayload;
exports.decryptMessage = decryptMessage;
const encoding_1 = require("./encoding");
const primitives_1 = require("./primitives");
const types_1 = require("./types");
const WRAP_INFO = 'famlin-e2e-v1/message-key';
function contentAad(conversationId, authorId) {
    return (0, encoding_1.canonical)(['famlin-e2e-v1/message-content', conversationId, authorId]);
}
function wrapAad(conversationId, authorId, userId, keyVersion) {
    return (0, encoding_1.canonical)(['famlin-e2e-v1/message-key-aad', conversationId, authorId, userId, String(keyVersion)]);
}
function sortedKeys(keys) {
    return [...keys].sort((a, b) => (a.userId === b.userId ? a.keyVersion - b.keyVersion : a.userId < b.userId ? -1 : 1));
}
/** Everything the sender signs: the whole payload bound to its conversation and author. */
function signedBytes(payload, conversationId, authorId) {
    return (0, encoding_1.canonical)([
        'famlin-e2e-v1/message-signature',
        conversationId,
        authorId,
        String(payload.senderKeyVersion),
        payload.nonce,
        payload.ct,
        ...sortedKeys(payload.keys).flatMap((entry) => [
            entry.userId,
            String(entry.keyVersion),
            entry.epk,
            entry.nonce,
            entry.wk,
        ]),
    ]);
}
/** A random message id for E2eMessageContentV1.mid. */
function newMessageId() {
    return (0, encoding_1.toBase64)((0, primitives_1.randomBytes)(16));
}
function encryptMessage({ conversationId, sender, recipients, content, }) {
    const audience = new Map();
    for (const recipient of recipients)
        audience.set(recipient.userId, recipient);
    audience.set(sender.userId, {
        userId: sender.userId,
        version: sender.version,
        signPublicKey: sender.signPublicKey,
        boxPublicKey: sender.boxPublicKey,
    });
    const contentKey = (0, primitives_1.randomBytes)(primitives_1.KEY_BYTES);
    const nonce = (0, primitives_1.randomBytes)(primitives_1.NONCE_BYTES);
    const ct = (0, primitives_1.aeadEncrypt)(contentKey, nonce, (0, encoding_1.utf8Encode)(JSON.stringify(content)), contentAad(conversationId, sender.userId));
    const keys = sortedKeys([...audience.values()].map((recipient) => {
        const sealed = (0, primitives_1.sealTo)(contentKey, (0, primitives_1.decodeKey)(recipient.boxPublicKey), WRAP_INFO, wrapAad(conversationId, sender.userId, recipient.userId, recipient.version));
        return {
            userId: recipient.userId,
            keyVersion: recipient.version,
            epk: sealed.epk,
            nonce: sealed.nonce,
            wk: sealed.ct,
        };
    }));
    const unsigned = { v: 1, senderKeyVersion: sender.version, nonce: (0, encoding_1.toBase64)(nonce), ct: (0, encoding_1.toBase64)(ct), keys };
    const sig = (0, primitives_1.sign)(signedBytes(unsigned, conversationId, sender.userId), (0, primitives_1.decodeKey)(sender.signPrivateKey));
    return { ...unsigned, sig: (0, encoding_1.toBase64)(sig) };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function strings(record, fields) {
    return fields.every((field) => typeof record[field] === 'string');
}
/** Strict shape check of a stored payload; throws unknown_version / corrupt. */
function parseMessagePayload(value) {
    if (!isRecord(value))
        throw new types_1.E2eError('corrupt');
    if (value.v !== 1)
        throw new types_1.E2eError('unknown_version');
    const positiveInt = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 1;
    if (!strings(value, ['nonce', 'ct', 'sig']) || !positiveInt(value.senderKeyVersion) || !Array.isArray(value.keys)) {
        throw new types_1.E2eError('corrupt');
    }
    const keys = value.keys.map((entry) => {
        if (!isRecord(entry) || !strings(entry, ['userId', 'epk', 'nonce', 'wk']) || !positiveInt(entry.keyVersion)) {
            throw new types_1.E2eError('corrupt');
        }
        return {
            userId: entry.userId,
            keyVersion: entry.keyVersion,
            epk: entry.epk,
            nonce: entry.nonce,
            wk: entry.wk,
        };
    });
    return {
        v: 1,
        senderKeyVersion: value.senderKeyVersion,
        nonce: value.nonce,
        ct: value.ct,
        keys,
        sig: value.sig,
    };
}
/**
 * Verify, then decrypt. The signature is checked before anything is opened,
 * so a server that rewrote the key list or forged the author is rejected
 * (`bad_signature`) rather than producing attacker-chosen plaintext.
 */
function decryptMessage({ payload: raw, conversationId, authorId, senderIdentity, myKeys, }) {
    const payload = parseMessagePayload(raw);
    if (senderIdentity.userId !== authorId || senderIdentity.version !== payload.senderKeyVersion) {
        throw new types_1.E2eError('sender_key_mismatch');
    }
    let signature;
    try {
        signature = (0, encoding_1.fromBase64)(payload.sig);
    }
    catch {
        throw new types_1.E2eError('corrupt');
    }
    const { sig: _sig, ...unsigned } = payload;
    if (!(0, primitives_1.verify)(signature, signedBytes(unsigned, conversationId, authorId), (0, primitives_1.decodeKey)(senderIdentity.signPublicKey))) {
        throw new types_1.E2eError('bad_signature');
    }
    let entry;
    let mine;
    for (const keys of myKeys) {
        entry = payload.keys.find((candidate) => candidate.userId === keys.userId && candidate.keyVersion === keys.version);
        if (entry) {
            mine = keys;
            break;
        }
    }
    if (!entry || !mine)
        throw new types_1.E2eError('no_key_for_me');
    const contentKey = (0, primitives_1.openSealed)({ epk: entry.epk, nonce: entry.nonce, ct: entry.wk }, (0, primitives_1.decodeKey)(mine.boxPrivateKey), WRAP_INFO, wrapAad(conversationId, authorId, entry.userId, entry.keyVersion));
    if (contentKey.length !== primitives_1.KEY_BYTES)
        throw new types_1.E2eError('corrupt');
    let nonce;
    let ct;
    try {
        nonce = (0, encoding_1.fromBase64)(payload.nonce);
        ct = (0, encoding_1.fromBase64)(payload.ct);
    }
    catch {
        throw new types_1.E2eError('corrupt');
    }
    if (nonce.length !== primitives_1.NONCE_BYTES)
        throw new types_1.E2eError('corrupt');
    const plaintext = (0, primitives_1.aeadDecrypt)(contentKey, nonce, ct, contentAad(conversationId, authorId));
    let content;
    try {
        content = JSON.parse((0, encoding_1.utf8Decode)(plaintext));
    }
    catch {
        throw new types_1.E2eError('corrupt');
    }
    if (!isRecord(content) || typeof content.mid !== 'string')
        throw new types_1.E2eError('corrupt');
    if (content.text !== undefined && typeof content.text !== 'string')
        throw new types_1.E2eError('corrupt');
    if (content.attachment !== undefined) {
        const a = content.attachment;
        if (!isRecord(a) || !strings(a, ['url', 'key', 'nonce', 'mime']) || typeof a.size !== 'number') {
            throw new types_1.E2eError('corrupt');
        }
    }
    return content;
}
