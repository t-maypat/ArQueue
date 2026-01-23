import { createRedis, clearQueues, enqueueTask, generateTaskPayload, waitForQueueDrain, sleep, percentile, formatDuration } from './utils.js';
import { BenchmarkResult, printHeader } from './reporter.js';
import chalk from 'chalk';

export interface LatencyConfig {
  sampleCount: number;
  concurrentEnqueue: number;
}

export interface LatencyResult {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  samples: number;
}

export async function runLatencyBenchmark(config: LatencyConfig = {
  sampleCount: 1000,
  concurrentEnqueue: 10
}): Promise<BenchmarkResult> {
  printHeader('Latency Benchmark');

  const redis = createRedis();

  try {
    console.log(chalk.gray(`  Samples: ${config.sampleCount}`));
    console.log(chalk.gray(`  Concurrent enqueue: ${config.concurrentEnqueue}\n`));

    // Clear queues and latency samples
    console.log(chalk.yellow('  Clearing queues...'));
    await clearQueues(redis);
    await redis.del('latency:samples');

    // Enqueue tasks
    console.log(chalk.yellow(`  Enqueuing ${config.sampleCount} tasks...`));

    let enqueued = 0;
    const taskIds: string[] = [];

    while (enqueued < config.sampleCount) {
      const batch = Math.min(config.concurrentEnqueue, config.sampleCount - enqueued);
      const promises = [];

      for (let i = 0; i < batch; i++) {
        const task = generateTaskPayload();
        promises.push(enqueueTask(task));
      }

      const results = await Promise.all(promises);
      taskIds.push(...results.map(r => r.taskId));
      enqueued += batch;

      // Progress
      const progress = (enqueued / config.sampleCount) * 100;
      process.stdout.write(`\r  Enqueued: ${enqueued}/${config.sampleCount} (${progress.toFixed(0)}%)`);
    }

    console.log('\n' + chalk.yellow('  Waiting for tasks to complete...'));

    // Wait for queue to drain
    const drained = await waitForQueueDrain(redis, 120000);
    if (!drained) {
      console.log(chalk.red('  Warning: Queue did not fully drain within timeout'));
    }

    // Give a moment for latency samples to be recorded
    await sleep(1000);

    // Fetch latency samples from Redis
    const samples = await redis.lrange('latency:samples', 0, -1);
    const latencies = samples.map(Number).filter(n => !isNaN(n) && n > 0);

    if (latencies.length === 0) {
      console.log(chalk.red('  No latency samples collected'));
      return {
        name: 'Latency',
        metrics: { 'Error': 'No samples' },
        conditions: `${config.sampleCount} samples`,
        passed: false
      };
    }

    // Sort for percentile calculation
    latencies.sort((a, b) => a - b);

    const result: LatencyResult = {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      min: latencies[0],
      max: latencies[latencies.length - 1],
      mean: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      samples: latencies.length
    };

    console.log(chalk.green(`\n  Results:`));
    console.log(chalk.white(`    Samples: ${result.samples}`));
    console.log(chalk.white(`    Min: ${result.min}ms`));
    console.log(chalk.white(`    p50 (median): ${result.p50}ms`));
    console.log(chalk.bold.green(`    p95: ${result.p95}ms`));
    console.log(chalk.white(`    p99: ${result.p99}ms`));
    console.log(chalk.white(`    Max: ${result.max}ms`));
    console.log(chalk.white(`    Mean: ${result.mean}ms`));

    return {
      name: 'Latency',
      metrics: {
        'p50': result.p50,
        'p95': result.p95,
        'p99': result.p99,
        'Min': result.min,
        'Max': result.max,
        'Mean': result.mean,
        'Samples': result.samples
      },
      conditions: `${result.samples} samples`,
      passed: result.p95 < 500 && result.samples >= config.sampleCount * 0.9
    };
  } finally {
    await redis.quit();
  }
}
