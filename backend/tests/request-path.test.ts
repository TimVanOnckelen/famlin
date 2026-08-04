import { describe, it, expect } from 'vitest';
import { requestPathname } from '../src/utils/requestPath.js';

// Pins the normalization every path guard depends on. The cases that matter
// are the ones where the raw URL does NOT literally start with the protected
// prefix but still resolves to it — those are what let a request skip a
// `startsWith`-based hook and reach the resource anyway.
describe('requestPathname', () => {
  it('leaves an already-canonical path alone', () => {
    expect(requestPathname('/uploads/abc.jpg')).toBe('/uploads/abc.jpg');
    expect(requestPathname('/api/posts')).toBe('/api/posts');
  });

  it('strips the query string and fragment', () => {
    expect(requestPathname('/uploads/abc.jpg?token=xyz')).toBe('/uploads/abc.jpg');
    expect(requestPathname('/api/auth/login?next=/feed')).toBe('/api/auth/login');
    expect(requestPathname('/uploads/abc.jpg#frag')).toBe('/uploads/abc.jpg');
  });

  it('collapses duplicate slashes, including a leading pair', () => {
    // path.posix.normalize preserves a leading `//` on its own, which is why
    // the collapse has to happen first.
    expect(requestPathname('//uploads/abc.jpg')).toBe('/uploads/abc.jpg');
    expect(requestPathname('/uploads//abc.jpg')).toBe('/uploads/abc.jpg');
    expect(requestPathname('///uploads/abc.jpg')).toBe('/uploads/abc.jpg');
  });

  it('resolves dot and dot-dot segments', () => {
    expect(requestPathname('/./uploads/abc.jpg')).toBe('/uploads/abc.jpg');
    expect(requestPathname('/anything/../uploads/abc.jpg')).toBe('/uploads/abc.jpg');
    expect(requestPathname('/uploads/a/../originals/x.heic')).toBe('/uploads/originals/x.heic');
  });

  it('percent-decodes exactly once, so an encoded separator is seen', () => {
    expect(requestPathname('/uploads%2Fabc.jpg')).toBe('/uploads/abc.jpg');
    // Encoded dot-dot pops `uploads` itself, so this resolves OUT of the
    // prefix — the guard correctly stops treating it as an uploads request.
    expect(requestPathname('/uploads/%2E%2E/originals/x.heic')).toBe('/originals/x.heic');
    // Decoding only once: a double-encoded separator stays literal, matching
    // what the server itself resolves.
    expect(requestPathname('/uploads%252Fabc.jpg')).toBe('/uploads%2Fabc.jpg');
  });

  it('escapes the prefix entirely when the path traverses out of it', () => {
    expect(requestPathname('/uploads/../api/posts')).toBe('/api/posts');
    expect(requestPathname('/api/auth/login/../../posts')).toBe('/api/posts');
  });

  it('keeps a malformed percent-escape rather than throwing', () => {
    expect(() => requestPathname('/uploads/100%.jpg')).not.toThrow();
    expect(requestPathname('/uploads/100%.jpg')).toBe('/uploads/100%.jpg');
  });

  it('handles empty and undefined input', () => {
    expect(requestPathname(undefined)).toBe('/');
    expect(requestPathname('')).toBe('/');
  });
});
