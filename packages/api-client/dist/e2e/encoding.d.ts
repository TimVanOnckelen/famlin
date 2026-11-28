export declare function toBase64(bytes: Uint8Array): string;
/** Strict standard-alphabet base64 decode; throws on anything malformed. */
export declare function fromBase64(input: string): Uint8Array;
export declare function utf8Encode(text: string): Uint8Array;
export declare function utf8Decode(bytes: Uint8Array): string;
export declare function concatBytes(...parts: Uint8Array[]): Uint8Array;
/**
 * Unambiguous encoding of a list of fields for signatures, AAD and KDF
 * inputs: each field as a 4-byte big-endian length followed by its bytes, so
 * ("ab","c") and ("a","bc") can never produce the same bytes.
 */
export declare function canonical(parts: Array<string | Uint8Array>): Uint8Array;
export declare function bytesEqual(a: Uint8Array, b: Uint8Array): boolean;
