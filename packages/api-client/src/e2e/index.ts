// End-to-end encryption for direct messages (#506). Pure functions only: no
// network, no storage, no UI. Changes here need the maintainer's review
// (.github/CODEOWNERS) and must keep every fixture in
// __tests__/e2eVectors.test.ts decrypting.

export { E2E_MESSAGE_ENCRYPTION, E2eError } from './types'
export type {
  E2eAttachmentV1,
  E2eErrorCode,
  E2eIdentityKeys,
  E2eKeyEntryV1,
  E2eMessageContentV1,
  E2eMessagePayloadV1,
  E2ePublicIdentity,
  E2eRecoveryBackupV1,
  E2eTransferPayloadV1,
} from './types'
export { generateIdentity, publicIdentity, assertKeysMatchIdentity, safetyCode } from './identity'
export { encryptMessage, decryptMessage, parseMessagePayload, newMessageId } from './message'
export type { EncryptMessageInput, DecryptMessageInput } from './message'
export {
  generateRecoveryCode,
  formatRecoveryCode,
  normalizeRecoveryCode,
  sealRecoveryBackup,
  openRecoveryBackup,
} from './recovery'
export { createTransferRequest, parseTransferQr, sealTransfer, openTransfer } from './transfer'
export type { TransferRequest } from './transfer'
export { encryptAttachment, decryptAttachment } from './attachment'
export { toBase64, fromBase64 } from './encoding'
