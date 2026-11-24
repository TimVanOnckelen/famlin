"use strict";
// Wire and storage formats for end-to-end encrypted direct messages (#506).
//
// FORMATS ARE FOREVER: every format version a client ever sent must stay
// decryptable by every later app version. Never change the meaning of an
// existing field or version — add a new version instead, and add a fixture
// for it to __tests__/e2eVectors.test.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.E2eError = exports.E2E_MESSAGE_ENCRYPTION = void 0;
/** Value of ChatMessage.encryption for messages in this format. */
exports.E2E_MESSAGE_ENCRYPTION = 'v1';
/** Errors carry a stable code (never key material) so the UI can explain why. */
class E2eError extends Error {
    constructor(code) {
        super(`e2e: ${code}`);
        this.name = 'E2eError';
        this.code = code;
    }
}
exports.E2eError = E2eError;
