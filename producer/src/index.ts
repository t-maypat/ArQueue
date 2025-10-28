import express from 'express';
import dotenv from 'dotenv';
import { Redis } from 'ioredis';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { console } from './console';

dotenv.config();

const app = express();

//body limit to avoid huge payload abuse
app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  const reqId = req.header('X-Request-ID') || randomUUID();
  (req as any).requestId = reqId;
  res.setHeader('X-Request-ID', reqId);
  next();
});

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/0';
const PORT = Number(process.env.PORT_PRODUCER || 8080);

const redis = new Redis(REDIS_URL);

redis.on('error', err => console.error({ err }, 'redis_error'));
redis.on('connect', () => console.info('redis_connect'));
redis.on('reconnecting', () => console.warn('redis_reconnecting'));

app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

const TaskSchema = z.object({
  type: z.string().nonempty(),
  payload: z.record(z.any()),
  maxRetries: z.number().int().min(0).max(50).optional(),
  idempotencyKey: z.string().max(255).optional()
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests' })
});

const BACKPRESSURE_THRESHOLD = Number(process.env.BACKPRESSURE_THRESHOLD || 80);

app.post('/enqueue', limiter, async (req, res) => {
  try {
    const parsed = TaskSchema.parse(req.body);

    //backpressure check
    const pressureScore = Number(await redis.get('backpressure:score') || 0);
    if (pressureScore >= BACKPRESSURE_THRESHOLD) {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        reason: 'backpressure',
        pressure: pressureScore,
        retryAfterMs: 5000
      });
    }

    //idempotency check
    if (parsed.idempotencyKey) {
      const existingTaskId = await redis.get(`idempotency:${parsed.idempotencyKey}`);
      if (existingTaskId) {
        const existingTask = await redis.hgetall(`task:${existingTaskId}`);
        console.info({ taskId: existingTaskId, idempotencyKey: parsed.idempotencyKey }, 'idempotent_hit');
        return res.status(200).json({
          taskId: existingTaskId,
          status: existingTask.status || 'unknown',
          idempotent: true,
          message: 'Task already exists with this idempotency key',
          requestId: (req as any).requestId
        });
      }
    }

    if (parsed.type === 'send_email') {
      if (!isRecord(parsed.payload) || typeof parsed.payload['to'] !== 'string' || typeof parsed.payload['subject'] !== 'string') {
        return res.status(400).json({ error: 'Bad request: payload must include "to" and "subject" strings' });
      }
    }

    const id = randomUUID();

    // store idempotency mapping (before enqueue for atomicity)
    if (parsed.idempotencyKey) {
      const wasSet = await redis.setnx(`idempotency:${parsed.idempotencyKey}`, id);
      if (!wasSet) {
        // race condition - another request won, return that task
        const existingTaskId = await redis.get(`idempotency:${parsed.idempotencyKey}`);
        if (existingTaskId) {
          const existingTask = await redis.hgetall(`task:${existingTaskId}`);
          return res.status(200).json({
            taskId: existingTaskId,
            status: existingTask.status || 'unknown',
            idempotent: true,
            requestId: (req as any).requestId
          });
        }
      }
      //set ttl on idempotency key for 24 hrs
      await redis.expire(`idempotency:${parsed.idempotencyKey}`, 86400);
    }

    const task = {
      id,
      type: parsed.type,
      payload: parsed.payload,
      retries: 0,
      maxRetries: parsed.maxRetries ?? Number(process.env.WORKER_MAX_RETRIES ?? 3),
      createdAt: Date.now(),
      correlationId: (req as any).requestId,
      idempotencyKey: parsed.idempotencyKey
    };

    const raw = JSON.stringify(task);

    // store metadata in a hash for updates/recovery
    // we store the original serialized data as 'data' too so recovery can reconstruct if needed
    await redis.hset(`task:${id}`, {
      data: raw,
      retries: String(task.retries),
      maxRetries: String(task.maxRetries),
      createdAt: String(task.createdAt),
      status: 'pending',
      type: task.type
    });

    
    const len = await redis.rpush('queue:pending', raw);

    console.info({ taskId: id, type: task.type, requestId: (req as any).requestId }, 'task_enqueued');

    // increment a global counter (we can aggregate across processes)
    await redis.incr('metrics:jobs_enqueued');

    res.status(201).json({ taskId: id, queueLength: len, requestId: (req as any).requestId });
  } catch (err) {
    console.error({ err }, 'enqueue_error');
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors.map(e => e.message).join('; ') });
    }
    res.status(500).json({ error: 'internal_server_error' });
  }
});

const server = app.listen(PORT, () => console.info({ port: PORT }, 'producer_listening'));

async function shutdown(signal: string) {
  try {
    console.info({ signal }, 'producer_shutting_down');
    server.close(() => console.info('producer_http_closed'));
    await redis.quit();
    process.exit(0);
  } catch (e) {
    console.error({ e }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
