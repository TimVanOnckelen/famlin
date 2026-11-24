"use strict";
// End-to-end encryption for direct messages (#506). Pure functions only: no
// network, no storage, no UI. Changes here need the maintainer's review
// (.github/CODEOWNERS) and must keep every fixture in
// __tests__/e2eVectors.test.ts decrypting.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromBase64 = exports.toBase64 = exports.decryptAttachment = exports.encryptAttachment = exports.openTransfer = exports.sealTransfer = exports.parseTransferQr = exports.createTransferRequest = exports.openRecoveryBackup = exports.sealRecoveryBackup = exports.normalizeRecoveryCode = exports.formatRecoveryCode = exports.generateRecoveryCode = exports.newMessageId = exports.parseMessagePayload = exports.decryptMessage = exports.encryptMessage = exports.safetyCode = exports.assertKeysMatchIdentity = exports.publicIdentity = exports.generateIdentity = exports.E2eError = exports.E2E_MESSAGE_ENCRYPTION = void 0;
var types_1 = require("./types");
Object.defineProperty(exports, "E2E_MESSAGE_ENCRYPTION", { enumerable: true, get: function () { return types_1.E2E_MESSAGE_ENCRYPTION; } });
Object.defineProperty(exports, "E2eError", { enumerable: true, get: function () { return types_1.E2eError; } });
var identity_1 = require("./identity");
Object.defineProperty(exports, "generateIdentity", { enumerable: true, get: function () { return identity_1.generateIdentity; } });
Object.defineProperty(exports, "publicIdentity", { enumerable: true, get: function () { return identity_1.publicIdentity; } });
Object.defineProperty(exports, "assertKeysMatchIdentity", { enumerable: true, get: function () { return identity_1.assertKeysMatchIdentity; } });
Object.defineProperty(exports, "safetyCode", { enumerable: true, get: function () { return identity_1.safetyCode; } });
var message_1 = require("./message");
Object.defineProperty(exports, "encryptMessage", { enumerable: true, get: function () { return message_1.encryptMessage; } });
Object.defineProperty(exports, "decryptMessage", { enumerable: true, get: function () { return message_1.decryptMessage; } });
Object.defineProperty(exports, "parseMessagePayload", { enumerable: true, get: function () { return message_1.parseMessagePayload; } });
Object.defineProperty(exports, "newMessageId", { enumerable: true, get: function () { return message_1.newMessageId; } });
var recovery_1 = require("./recovery");
Object.defineProperty(exports, "generateRecoveryCode", { enumerable: true, get: function () { return recovery_1.generateRecoveryCode; } });
Object.defineProperty(exports, "formatRecoveryCode", { enumerable: true, get: function () { return recovery_1.formatRecoveryCode; } });
Object.defineProperty(exports, "normalizeRecoveryCode", { enumerable: true, get: function () { return recovery_1.normalizeRecoveryCode; } });
Object.defineProperty(exports, "sealRecoveryBackup", { enumerable: true, get: function () { return recovery_1.sealRecoveryBackup; } });
Object.defineProperty(exports, "openRecoveryBackup", { enumerable: true, get: function () { return recovery_1.openRecoveryBackup; } });
var transfer_1 = require("./transfer");
Object.defineProperty(exports, "createTransferRequest", { enumerable: true, get: function () { return transfer_1.createTransferRequest; } });
Object.defineProperty(exports, "parseTransferQr", { enumerable: true, get: function () { return transfer_1.parseTransferQr; } });
Object.defineProperty(exports, "sealTransfer", { enumerable: true, get: function () { return transfer_1.sealTransfer; } });
Object.defineProperty(exports, "openTransfer", { enumerable: true, get: function () { return transfer_1.openTransfer; } });
var attachment_1 = require("./attachment");
Object.defineProperty(exports, "encryptAttachment", { enumerable: true, get: function () { return attachment_1.encryptAttachment; } });
Object.defineProperty(exports, "decryptAttachment", { enumerable: true, get: function () { return attachment_1.decryptAttachment; } });
var encoding_1 = require("./encoding");
Object.defineProperty(exports, "toBase64", { enumerable: true, get: function () { return encoding_1.toBase64; } });
Object.defineProperty(exports, "fromBase64", { enumerable: true, get: function () { return encoding_1.fromBase64; } });
