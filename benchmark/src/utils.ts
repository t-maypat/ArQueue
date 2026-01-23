import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

export const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/0';
export const PRODUCER_URL = process.env.PRODUCER_URL || 'http://localhost:8080';
export const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8081';

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createRedis(): Redis {
  return new Redis(REDIS_URL);
}

export interface Task {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export async function enqueueTask(task: { type: string; payload: Record<string, unknown>; idempotencyKey?: string }): Promise<{ taskId: string; queueLength: number }> {
  const response = await fetch(`${PRODUCER_URL}/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Enqueue failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<{ taskId: string; queueLength: number }>;
}

export async function getMetrics(): Promise<{
  total_jobs_in_queue: number;
  queue_processing: number;
  queue_delayed: number;
  queue_dead_letter: number;
  jobs_done: number;
  latency: { p50: number; p95: number; p99: number; samples: number } | null;
}> {
  const response = await fetch(`${WORKER_URL}/metrics`);
  if (!response.ok) {
    throw new Error(`Metrics failed: ${response.status}`);
  }
  return response.json() as Promise<any>;
}

export async function clearQueues(redis: Redis): Promise<void> {
  await redis.del(
    'queue:pending',
    'queue:processing',
    'queue:delayed',
    'queue:dead_letter',
    'metrics:jobs_done',
    'metrics:jobs_enqueued',
    'metrics:jobs_failed',
    'metrics:jobs_retried',
    'metrics:jobs_dead_letter',
    'metrics:jobs_recovered',
    'latency:samples',
    'backpressure:score'
  );
}

export async function waitForQueueDrain(redis: Redis, timeoutMs: number = 300000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const pending = await redis.llen('queue:pending');
    const processing = await redis.llen('queue:processing');
    const delayed = await redis.zcard('queue:delayed');

    if (pending === 0 && processing === 0 && delayed === 0) {
      return true;
    }

    await sleep(500);
  }

  return false;
}

export function generateTaskPayload(): { type: string; payload: Record<string, unknown> } {
  const types = ['send_email', 'generate_pdf'];
  const type = types[Math.floor(Math.random() * types.length)];

  if (type === 'send_email') {
    return {
      type,
      payload: {
        to: `user${randomUUID().slice(0, 8)}@example.com`,
        subject: `Test email ${Date.now()}`,
        body: 'Benchmark test email'
      }
    };
  }

  return {
    type,
    payload: {
      documentId: randomUUID(),
      format: 'A4'
    }
  };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
