import { describe, it, expect } from 'vitest';
import { percentile } from '../load.js';

describe('percentile', () => {
  it('returns 0 for an empty array', () => {
    expect(percentile([], 95)).toBe(0);
  });

  it('picks the value at the requested percentile of a sorted array', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(sorted, 50)).toBe(51);
    expect(percentile(sorted, 95)).toBe(96);
    expect(percentile(sorted, 0)).toBe(1);
  });

  it('never indexes past the end of the array', () => {
    expect(percentile([1, 2, 3], 100)).toBe(3);
  });
});
