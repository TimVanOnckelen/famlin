import { type E2eIdentityKeys, type E2ePublicIdentity, type E2eTransferPayloadV1 } from './types';
export interface TransferRequest {
    sessionId: string;
    /** Stays on the new device; never leaves it. */
    privateKey: string;
    /** What the new device renders as a QR code. */
    qr: string;
}
export declare function createTransferRequest(): TransferRequest;
export declare function parseTransferQr(qr: string): {
    sessionId: string;
    publicKey: string;
};
/** On the existing device, after scanning: seal our identity to the new device. */
export declare function sealTransfer(keys: E2eIdentityKeys, qr: string): {
    sessionId: string;
    payload: E2eTransferPayloadV1;
};
/**
 * On the new device: open the relayed payload and check the keys belong to
 * the identity the server publishes for us (so a relay can't plant its own).
 */
export declare function openTransfer(payload: unknown, request: Pick<TransferRequest, 'sessionId' | 'privateKey'>, expected: E2ePublicIdentity): E2eIdentityKeys;
