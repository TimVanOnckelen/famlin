"use strict";
// Device-to-device hand-over ("link a new device"), like WhatsApp's QR flow:
// the NEW device shows a QR with a fresh one-time public key; an already set
// up device scans it and seals the identity to that key; the server only
// relays the sealed box under the QR's session id.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransferRequest = createTransferRequest;
exports.parseTransferQr = parseTransferQr;
exports.sealTransfer = sealTransfer;
exports.openTransfer = openTransfer;
const encoding_1 = require("./encoding");
const identity_1 = require("./identity");
const primitives_1 = require("./primitives");
const types_1 = require("./types");
const INFO = 'famlin-e2e-v1/transfer';
const QR_PREFIX = 'famlin-e2e-transfer:1:';
function aad(sessionId, userId) {
    return (0, encoding_1.canonical)(['famlin-e2e-v1/transfer-aad', sessionId, userId]);
}
function createTransferRequest() {
    const keyPair = (0, primitives_1.generateBoxKeyPair)();
    // base64 without +/= so the id is URL- and route-safe.
    const sessionId = (0, encoding_1.toBase64)((0, primitives_1.randomBytes)(18)).replace(/\+/g, '-').replace(/\//g, '_');
    return {
        sessionId,
        privateKey: (0, encoding_1.toBase64)(keyPair.privateKey),
        qr: `${QR_PREFIX}${sessionId}:${(0, encoding_1.toBase64)(keyPair.publicKey)}`,
    };
}
function parseTransferQr(qr) {
    if (typeof qr !== 'string' || !qr.startsWith(QR_PREFIX))
        throw new types_1.E2eError('invalid_transfer_code');
    const [sessionId, publicKey] = qr.slice(QR_PREFIX.length).split(':');
    if (!sessionId || !/^[A-Za-z0-9_-]{16,64}$/.test(sessionId) || !publicKey)
        throw new types_1.E2eError('invalid_transfer_code');
    try {
        (0, primitives_1.decodeKey)(publicKey);
    }
    catch {
        throw new types_1.E2eError('invalid_transfer_code');
    }
    return { sessionId, publicKey };
}
/** On the existing device, after scanning: seal our identity to the new device. */
function sealTransfer(keys, qr) {
    const { sessionId, publicKey } = parseTransferQr(qr);
    const secret = (0, encoding_1.utf8Encode)(JSON.stringify({
        userId: keys.userId,
        version: keys.version,
        signPrivateKey: keys.signPrivateKey,
        boxPrivateKey: keys.boxPrivateKey,
    }));
    const sealed = (0, primitives_1.sealTo)(secret, (0, primitives_1.decodeKey)(publicKey), INFO, aad(sessionId, keys.userId));
    return { sessionId, payload: { v: 1, ...sealed } };
}
/**
 * On the new device: open the relayed payload and check the keys belong to
 * the identity the server publishes for us (so a relay can't plant its own).
 */
function openTransfer(payload, request, expected) {
    if (typeof payload !== 'object' || payload === null)
        throw new types_1.E2eError('corrupt');
    const p = payload;
    if (p.v !== 1)
        throw new types_1.E2eError('unknown_version');
    if (typeof p.epk !== 'string' || typeof p.nonce !== 'string' || typeof p.ct !== 'string') {
        throw new types_1.E2eError('corrupt');
    }
    const plaintext = (0, primitives_1.openSealed)({ epk: p.epk, nonce: p.nonce, ct: p.ct }, (0, primitives_1.decodeKey)(request.privateKey), INFO, aad(request.sessionId, expected.userId));
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
