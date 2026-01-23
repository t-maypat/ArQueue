import { createRedis, clearQueues, enqueueTask, generateTaskPayload, waitForQueueDrain, sleep, getMetrics, formatDuration } from './utils.js';
import { BenchmarkResult, printHeader } from './reporter.js';
import chalk from 'chalk';

export interface ThroughputConfig {
  durationSeconds: number;
  targetRps: number;
  warmupSeconds: number;
}

export interface ThroughputResult {
  jobsEnqueued: number;
  jobsCompleted: number;
  jobsPerMinute: number;
  completionRate: number;
  durationMs: number;
}

export async function runThroughputBenchmark(config: ThroughputConfig = {
  durationSeconds: 30,
  targetRps: 50,
  warmupSeconds: 5
}): Promise<BenchmarkResult> {
  printHeader('Throughput Benchmark');

  const redis = createRedis();

  try {
    console.log(chalk.gray(`  Duration: ${config.durationSeconds}s`));
    console.log(chalk.gray(`  Target RPS: ${config.targetRps}`));
    console.log(chalk.gray(`  Warmup: ${config.warmupSeconds}s\n`));

    // Clear queues
    console.log(chalk.yellow('  Clearing queues...'));
    await clearQueues(redis);

    // Get initial metrics
    const initialMetrics = await getMetrics();
    const initialDone = initialMetrics.jobs_done;

    // Warmup phase
    console.log(chalk.yellow(`  Warmup phase (${config.warmupSeconds}s)...`));
    const warmupEnd = Date.now() + config.warmupSeconds * 1000;
    while (Date.now() < warmupEnd) {
      const task = generateTaskPayload();
      await enqueueTask(task);
      await sleep(1000 / config.targetRps);
    }

    // Wait for warmup jobs to complete
    await sleep(2000);
    await clearQueues(redis);

    // Measurement phase
    console.log(chalk.yellow(`  Measurement phase (${config.durationSeconds}s)...`));
    const measureStart = Date.now();
    const measureEnd = measureStart + config.durationSeconds * 1000;
    let enqueued = 0;

    const batchSize = 10;
    const batchDelay = (batchSize / config.targetRps) * 1000;

    while (Date.now() < measureEnd) {
      // Enqueue in batches for efficiency
      const promises = [];
      for (let i = 0; i < batchSize && Date.now() < measureEnd; i++) {
        const task = generateTaskPayload();
        promises.push(enqueueTask(task));
        enqueued++;
      }
      await Promise.all(promises);
      await sleep(batchDelay);

      // Progress
      const elapsed = Date.now() - measureStart;
      const progress = Math.min(100, (elapsed / (config.durationSeconds * 1000)) * 100);
      process.stdout.write(`\r  Progress: ${progress.toFixed(0)}% (${enqueued} jobs enqueued)`);
    }

    console.log('\n' + chalk.yellow('  Waiting for queue to drain...'));

    // Wait for all jobs to complete
    const drainStart = Date.now();
    const drained = await waitForQueueDrain(redis, 120000);

    if (!drained) {
      console.log(chalk.red('  Warning: Queue did not fully drain within timeout'));
    }

    // Calculate results
    const finalMetrics = await getMetrics();
    const totalDurationMs = Date.now() - measureStart;
    const completed = finalMetrics.jobs_done - initialDone;
    const jobsPerMinute = Math.round((completed / totalDurationMs) * 60000);
    const completionRate = enqueued > 0 ? (completed / enqueued) * 100 : 0;

    const result: ThroughputResult = {
      jobsEnqueued: enqueued,
      jobsCompleted: completed,
      jobsPerMinute,
      completionRate,
      durationMs: totalDurationMs
    };

    console.log(chalk.green(`\n  Results:`));
    console.log(chalk.white(`    Jobs enqueued: ${result.jobsEnqueued}`));
    console.log(chalk.white(`    Jobs completed: ${result.jobsCompleted}`));
    console.log(chalk.white(`    Duration: ${formatDuration(result.durationMs)}`));
    console.log(chalk.bold.green(`    Throughput: ${result.jobsPerMinute} jobs/min`));
    console.log(chalk.white(`    Completion rate: ${result.completionRate.toFixed(1)}%`));

    return {
      name: 'Throughput',
      metrics: {
        'Jobs/min': result.jobsPerMinute,
        'Completion Rate': `${result.completionRate.toFixed(1)}%`,
        'Duration': formatDuration(result.durationMs)
      },
      conditions: `${config.durationSeconds}s test, ${config.targetRps} target RPS`,
      passed: result.completionRate > 95 && result.jobsPerMinute > 500
    };
  } finally {
    await redis.quit();
  }
}
