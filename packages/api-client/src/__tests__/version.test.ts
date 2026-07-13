import { describe, it, expect } from 'vitest';
import { compareVersions } from '../version';

describe('compareVersions', () => {
  it('treats equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('detects a patch difference', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0);
  });

  it('detects a minor difference', () => {
    expect(compareVersions('1.2.0', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('1.3.0', '1.2.0')).toBeGreaterThan(0);
  });

  it('detects a major difference', () => {
    expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('tolerates a leading "v"', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('v1.2.3', 'v1.2.4')).toBeLessThan(0);
  });

  it('treats missing segments as 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.1')).toBeLessThan(0);
    expect(compareVersions('1.3', '1.2.9')).toBeGreaterThan(0);
  });

  it('treats non-numeric segments as 0 instead of throwing', () => {
    expect(() => compareVersions('1.x.3', '1.0.3')).not.toThrow();
    expect(compareVersions('1.x.3', '1.0.3')).toBe(0);
    expect(compareVersions('garbage', '0.0.0')).toBe(0);
  });
});
