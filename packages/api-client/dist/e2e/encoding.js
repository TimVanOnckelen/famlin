"use strict";
// Byte helpers for the E2E module. Deliberately dependency-free (no atob/btoa,
// no Buffer) so the same code runs in Hermes, browsers and Node.
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBase64 = toBase64;
exports.fromBase64 = fromBase64;
exports.utf8Encode = utf8Encode;
exports.utf8Decode = utf8Decode;
exports.concatBytes = concatBytes;
exports.canonical = canonical;
exports.bytesEqual = bytesEqual;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = Object.fromEntries([...B64].map((c, i) => [c, i]));
function toBase64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        const n = (a << 16) | (b << 8) | c;
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
        out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
        out += i + 2 < bytes.length ? B64[n & 63] : '=';
    }
    return out;
}
/** Strict standard-alphabet base64 decode; throws on anything malformed. */
function fromBase64(input) {
    if (typeof input !== 'string' || input.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input)) {
        throw new Error('invalid base64');
    }
    const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0;
    const out = new Uint8Array((input.length / 4) * 3 - padding);
    let o = 0;
    for (let i = 0; i < input.length; i += 4) {
        const n = (B64_LOOKUP[input[i]] << 18) |
            (B64_LOOKUP[input[i + 1]] << 12) |
            ((B64_LOOKUP[input[i + 2]] ?? 0) << 6) |
            (B64_LOOKUP[input[i + 3]] ?? 0);
        if (o < out.length)
            out[o++] = (n >> 16) & 255;
        if (o < out.length)
            out[o++] = (n >> 8) & 255;
        if (o < out.length)
            out[o++] = n & 255;
    }
    return out;
}
// Hand-written UTF-8 (instead of TextEncoder/TextDecoder) because not every
// Hermes version ships TextDecoder. Lone surrogates encode as U+FFFD, like
// TextEncoder; decoding is strict and throws on any malformed sequence.
function utf8Encode(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                i++;
            }
            else {
                code = 0xfffd;
            }
        }
        else if (code >= 0xdc00 && code <= 0xdfff) {
            code = 0xfffd;
        }
        if (code < 0x80)
            out.push(code);
        else if (code < 0x800)
            out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
        else if (code < 0x10000)
            out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
        else
            out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
    return Uint8Array.from(out);
}
function utf8Decode(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length;) {
        const byte = bytes[i];
        let code;
        let extra;
        let min;
        if (byte < 0x80)
            [code, extra, min] = [byte, 0, 0];
        else if (byte >= 0xc2 && byte <= 0xdf)
            [code, extra, min] = [byte & 0x1f, 1, 0x80];
        else if (byte >= 0xe0 && byte <= 0xef)
            [code, extra, min] = [byte & 0x0f, 2, 0x800];
        else if (byte >= 0xf0 && byte <= 0xf4)
            [code, extra, min] = [byte & 0x07, 3, 0x10000];
        else
            throw new Error('invalid utf-8');
        for (let j = 1; j <= extra; j++) {
            const next = bytes[i + j];
            if (next === undefined || (next & 0xc0) !== 0x80)
                throw new Error('invalid utf-8');
            code = (code << 6) | (next & 0x3f);
        }
        if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
            throw new Error('invalid utf-8');
        out += String.fromCodePoint(code);
        i += extra + 1;
    }
    return out;
}
function concatBytes(...parts) {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
/**
 * Unambiguous encoding of a list of fields for signatures, AAD and KDF
 * inputs: each field as a 4-byte big-endian length followed by its bytes, so
 * ("ab","c") and ("a","bc") can never produce the same bytes.
 */
function canonical(parts) {
    const encoded = parts.map((part) => (typeof part === 'string' ? utf8Encode(part) : part));
    const chunks = [];
    for (const part of encoded) {
        const length = new Uint8Array(4);
        new DataView(length.buffer).setUint32(0, part.length, false);
        chunks.push(length, part);
    }
    return concatBytes(...chunks);
}
function bytesEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
    return diff === 0;
}
