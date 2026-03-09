import { describe, it, expect } from 'vitest';
import { formatSize } from '../clipboard.js';

describe('clipboard', () => {
  describe('formatSize', () => {
    it('formats bytes', () => {
      expect(formatSize(0)).toBe('0B');
      expect(formatSize(512)).toBe('512B');
    });

    it('formats kilobytes', () => {
      expect(formatSize(1024)).toBe('1KB');
      expect(formatSize(1536)).toBe('2KB');
      expect(formatSize(100 * 1024)).toBe('100KB');
    });

    it('formats megabytes', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0MB');
      expect(formatSize(2.5 * 1024 * 1024)).toBe('2.5MB');
    });
  });
});
