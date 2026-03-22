# ArQueue - Distributed Task Queue with AI Failure Intelligence

![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7.0-DC382D?logo=redis&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

A fault-tolerant, Redis-backed distributed task queue with AI-powered failure analysis. Built for production workloads with **5,000+ jobs/min throughput**, **p95 latency of 35ms**, and **zero job loss** guarantees.

## Performance Metrics

| Metric | Value | Conditions |
|--------|-------|------------|
| **Throughput** | 5,400+ jobs/min | 10 concurrent workers |
| **p95 Latency** | 35ms | Unloaded, single task |
| **Job Loss Rate** | 0% | Verified under chaos testing |
| **Burst Handling** | 500 jobs in 5.5s | Peak queue depth 281 |
| **AI Analysis** | ~4s response | Gemini/OpenAI/Anthropic/Ollama |

## Architecture

<img width="1712" height="2653" alt="image" src="https://github.com/user-attachments/assets/456830b1-edab-44f3-94ee-61412c09345f" />


```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Producer  │────▶│    Redis    │◀────│   Worker    │
│   (HTTP)    │     │   Queues    │     │  (N loops)  │
└─────────────┘     └─────────────┘     └─────────────┘
      │                   │                    │
      │              ┌────┴────┐               │
      │              │         │               │
      ▼              ▼         ▼               ▼
  /enqueue      pending    delayed         processTask()
  /healthz      processing  dead_letter    AI Analysis
                task:{id}   latency:*      /metrics
```

## Key Features

### Core Queue
- **Reliable Dequeue**: `BRPOPLPUSH` pattern ensures no message loss
- **Retry with Backoff**: Exponential backoff + jitter prevents thundering herd
- **Delayed Scheduling**: Redis ZSET for scheduled retries
- **Dead Letter Queue**: Failed tasks preserved for analysis
- **Crash Recovery**: Automatic detection and reprocessing of stuck tasks

### Performance & Reliability
- **Concurrent Workers**: Configurable worker loops per process
- **Idempotent Processing**: Deduplication via idempotency keys
- **Backpressure**: Automatic throttling when queue depth exceeds threshold
- **Zero Job Loss**: Verified through chaos testing

### Observability
- **Latency Percentiles**: p50, p95, p99 computed in real-time
- **Structured Logging**: Pino with correlation ID propagation
- **Metrics Endpoint**: Queue depths, job counts, latency stats
- **Request Tracing**: End-to-end correlation IDs

### AI-Powered Failure Analysis
- **Root Cause Detection**: AI analyzes failed tasks and identifies issues
- **Fix Recommendations**: Actionable suggestions for each failure
- **Pattern Recognition**: Categorizes failures (transient/permanent/config)
- **Multi-Provider**: Supports Gemini, OpenAI, Anthropic, and Ollama

## Quick Start

### 1. Start Redis

```bash
docker run -d --name redis -p 6379:6379 redis:alpine
```

### 2. Configure Environment

```bash
# Producer (.env)
REDIS_URL=redis://127.0.0.1:6379/0
PORT_PRODUCER=8080
BACKPRESSURE_THRESHOLD=80

# Worker (.env)
REDIS_URL=redis://127.0.0.1:6379/0
PORT_WORKER=8081
WORKER_CONCURRENCY=10

# AI (optional - choose one provider)
AI_PROVIDER=gemini
AI_MODEL=gemini-1.5-flash
GEMINI_API_KEY=your-key
```

### 3. Start Services

```bash
# Terminal 1: Producer
cd producer && npm install && npm run dev

# Terminal 2: Worker
cd worker && npm install && npm run dev
```

### 4. Enqueue a Task

```bash
curl -X POST http://localhost:8080/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "type": "send_email",
    "payload": {"to": "user@example.com", "subject": "Hello"},
    "idempotencyKey": "email-123"
  }'
```

## API Reference

### Producer Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/enqueue` | POST | Submit a new task |
| `/healthz` | GET | Health check |

### Worker Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/metrics` | GET | Queue stats + latency percentiles |
| `/pressure` | GET | Backpressure status |
| `/dead_letter` | GET | List failed tasks |
| `/dead_letter/:id/analysis` | GET | AI analysis for a failed task |
| `/ai/patterns` | GET | Failure pattern analytics |

### Task Schema

```typescript
{
  type: string;           // Task type (e.g., "send_email")
  payload: object;        // Task-specific data
  maxRetries?: number;    // Max retry attempts (default: 3)
  idempotencyKey?: string; // Deduplication key (optional)
}
```

## Benchmarking

Run the benchmark suite to verify performance:

```bash
cd benchmark && npm install

# Quick benchmark (all tests)
npm run benchmark

# Individual tests
npm run benchmark throughput -- -d 60 -r 100
npm run benchmark latency -- -s 1000
npm run benchmark burst -- -s 500 -c 3
npm run benchmark chaos -- -j 1000
```

## Configuration

### Producer Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis connection |
| `PORT_PRODUCER` | `8080` | HTTP port |
| `RATE_LIMIT_MAX` | `120` | Requests per window |
| `BACKPRESSURE_THRESHOLD` | `80` | Pressure score to reject |

### Worker Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis connection |
| `PORT_WORKER` | `8081` | HTTP port |
| `WORKER_CONCURRENCY` | `3` | Concurrent worker loops |
| `WORKER_MAX_RETRIES` | `3` | Default max retries |
| `PROCESSING_TIMEOUT_MS` | `300000` | Stuck task threshold |

### AI Configuration

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | `ollama`, `openai`, `anthropic`, or `gemini` |
| `AI_MODEL` | Model name (e.g., `gemini-1.5-flash`) |
| `GEMINI_API_KEY` | Google AI API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OLLAMA_HOST` | Ollama server URL (default: `http://localhost:11434`) |

## Redis Data Structures

| Key | Type | Purpose |
|-----|------|---------|
| `queue:pending` | LIST | Tasks waiting to be processed |
| `queue:processing` | LIST | Tasks currently being worked on |
| `queue:delayed` | ZSET | Scheduled retries (score = timestamp) |
| `queue:dead_letter` | LIST | Failed tasks after max retries |
| `task:{id}` | HASH | Task metadata and state |
| `latency:samples` | LIST | Recent latency measurements |
| `ai:analysis:{id}` | HASH | AI failure analysis |
| `ai:patterns:{cat}` | LIST | Failure patterns by category |

## Project Structure

```
ArQueue/
├── producer/           # Task producer service
│   └── src/
│       ├── index.ts    # Express server, /enqueue endpoint
│       └── logger.ts   # Pino logger
├── worker/             # Task worker service
│   └── src/
│       ├── index.ts    # Worker loops, metrics, recovery
│       ├── logger.ts   # Pino logger
│       └── ai/         # AI failure analysis
│           ├── index.ts    # AI client factory
│           ├── analyzer.ts # DLQ analysis logic
│           └── prompts.ts  # Prompt templates
├── benchmark/          # Performance benchmarks
│   └── src/
│       ├── index.ts      # CLI entry
│       ├── throughput.ts # Jobs/min test
│       ├── latency.ts    # p95 measurement
│       ├── burst.ts      # Burst traffic test
│       └── chaos.ts      # Zero-loss verification
└── dashboard/          # Simple monitoring UI
    └── index.html
```

## License

MIT
