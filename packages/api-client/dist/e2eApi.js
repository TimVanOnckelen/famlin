"use strict";
// Network calls for end-to-end encrypted direct messages (#506). The server
// only stores public keys, ciphertext and the recovery backup (itself
// encrypted under the user's recovery code); all crypto lives in ./e2e.
Object.defineProperty(exports, "__esModule", { value: true });
exports.e2eUserIdentitiesQueryKey = exports.e2eMyIdentitiesQueryKey = void 0;
exports.fetchMyE2eIdentities = fetchMyE2eIdentities;
exports.fetchUserE2eIdentities = fetchUserE2eIdentities;
exports.publishE2eIdentity = publishE2eIdentity;
exports.updateE2eRecoveryBackup = updateE2eRecoveryBackup;
exports.putE2eTransfer = putE2eTransfer;
exports.takeE2eTransfer = takeE2eTransfer;
exports.sendEncryptedChatMessage = sendEncryptedChatMessage;
exports.uploadEncryptedAttachment = uploadEncryptedAttachment;
exports.setChatConversationEncryption = setChatConversationEncryption;
const client_1 = require("./client");
const uploads_1 = require("./uploads");
const e2eMyIdentitiesQueryKey = () => ['e2e', 'identity', 'me'];
exports.e2eMyIdentitiesQueryKey = e2eMyIdentitiesQueryKey;
const e2eUserIdentitiesQueryKey = (userId) => ['e2e', 'identity', userId];
exports.e2eUserIdentitiesQueryKey = e2eUserIdentitiesQueryKey;
/** Your own identity versions, newest first — the only response carrying recoveryBackup. */
async function fetchMyE2eIdentities() {
    // requires-feature: e2eDirectMessages
    const response = await client_1.api.get('/e2e/identity/me');
    return response.data.identities;
}
/** Another user's published identity versions, newest first (empty if they have none yet). */
async function fetchUserE2eIdentities(userId) {
    // requires-feature: e2eDirectMessages
    const response = await client_1.api.get(`/e2e/identity/${encodeURIComponent(userId)}`);
    return response.data.identities;
}
/** Publish a new identity version (1 the first time, latest + 1 on a key reset). 409 if not next. */
async function publishE2eIdentity(body) {
    // requires-feature: e2eDirectMessages
    const response = await client_1.api.post('/e2e/identity', body);
    return response.data;
}
/** Replace (or with null remove) the recovery backup of your latest identity version. */
async function updateE2eRecoveryBackup(version, recoveryBackup) {
    // requires-feature: e2eDirectMessages
    await client_1.api.put(`/e2e/identity/${version}/recovery`, { recoveryBackup });
}
/** Existing device: hand the sealed identity to the new device's QR session. */
async function putE2eTransfer(sessionId, payload) {
    // requires-feature: e2eDirectMessages
    await client_1.api.put(`/e2e/transfers/${encodeURIComponent(sessionId)}`, { payload });
}
/** New device: poll for the sealed identity. Resolves null while it isn't there yet (404). */
async function takeE2eTransfer(sessionId) {
    try {
        // requires-feature: e2eDirectMessages
        const response = await client_1.api.get(`/e2e/transfers/${encodeURIComponent(sessionId)}`);
        return response.data.payload;
    }
    catch (error) {
        if (error.response?.status === 404)
            return null;
        throw error;
    }
}
async function sendEncryptedChatMessage(conversationId, body) {
    // requires-feature: e2eDirectMessages
    const response = await client_1.api.post(`/chat/conversations/${conversationId}/messages`, body);
    return response.data;
}
/**
 * Upload an already-encrypted attachment as an opaque blob. `file` is
 * whatever the platform's FormData accepts: a Blob on web, a
 * `{ uri, name, type }` object on React Native.
 */
async function uploadEncryptedAttachment(file) {
    const formData = new FormData();
    formData.append('file', file);
    // requires-feature: e2eDirectMessages
    const response = await client_1.api.post('/uploads/encrypted', formData, {
        headers: { 'Content-Type': undefined },
        timeout: uploads_1.UPLOAD_TIMEOUT_MS,
    });
    return response.data.url;
}
/** Opt a private conversation out of (or back into) encryption; posts a visible system message. */
async function setChatConversationEncryption(conversationId, enabled) {
    // requires-feature: e2eDirectMessages
    const response = await client_1.api.put(`/chat/conversations/${conversationId}/encryption`, {
        enabled,
    });
    return response.data;
}
