import { describe, it, expect } from 'vitest';
import { logger } from './logger';
import { buildPrompt } from './ai/prompts';

describe('worker: logger', () => {
  it('should be instantiated correctly', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});

describe('worker: ai prompts', () => {
  it('should replace all placeholders in the failure analysis prompt', () => {
    const task = {
      id: 'task-123',
      type: 'email-job',
      payload: { user: 1 },
      retries: 2,
      maxRetries: 5,
      lastError: 'connection timeout'
    };

    const prompt = buildPrompt(task, ['first timeout', 'second timeout']);

    expect(prompt).toContain('Type: email-job');
    expect(prompt).toContain('Task ID: task-123');
    expect(prompt).toContain('Final Error: connection timeout');
    expect(prompt).toContain('Retry Count: 2 / 5');
    expect(prompt).toContain('"user": 1');
    expect(prompt).toContain('1. first timeout');
    expect(prompt).toContain('2. second timeout');
  });

  it('should handle undefined values gracefully', () => {
    const task = {
      type: 'minimal-job',
      payload: {}
    };

    const prompt = buildPrompt(task, []);

    expect(prompt).toContain('Type: minimal-job');
    expect(prompt).toContain('Task ID: unknown');
    expect(prompt).toContain('Final Error: Unknown error');
    expect(prompt).toContain('Retry Count: 0 / 3');
    expect(prompt).toContain('No previous errors recorded');
  });
});
