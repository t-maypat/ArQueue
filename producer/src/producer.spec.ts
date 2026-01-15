import { describe, it, expect } from 'vitest';
import { logger } from './logger';

describe('producer: logger', () => {
  it('should be instantiated correctly', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});
