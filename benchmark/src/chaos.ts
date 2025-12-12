import { createRedis, clearQueues, enqueueTask, generateTaskPayload, waitForQueueDrain, sleep, formatDuration, getMetrics } from './utils';
import { BenchmarkResult, printHeader } from './reporter';
import chalk from 'chalk';
import { randomUUID } from 'crypto';

export interface ChaosConfig {
  jobCount: number;
  checkIntervalMs: number;
  timeoutMs: number;
}

export interface ChaosResult {
  jobsEnqueued: number;
  jobsCompleted: number;
  jobsInDLQ: number;
  jobsRecovered: number;
  lossRate: number;
  durationMs: number;
}

export async function runChaosBenchmark(config: ChaosConfig = {
  jobCount: 1000,
  checkIntervalMs: 2000,
  timeoutMs: 300000
}): Promise<BenchmarkResult> {
  printHeader('Chaos / Zero Job Loss Benchmark');

  const redis = createRedis();
  const runId = randomUUID();

  try {
    console.log(chalk.gray(`  Job count: ${config.jobCount}`));
    console.log(chalk.gray(`  Run ID: ${runId}\n`));

    // Clear queues
    console.log(chalk.yellow('  Clearing queues...'));
    await clearQueues(redis);

    // Set benchmark run ID for tracking
    await redis.set('benchmark:active_run', runId);
    await redis.del(`benchmark:completed:${runId}`);

    // Get initial recovery count
    const initialRecovered = Number(await redis.get('metrics:jobs_recovered') || 0);

    const startTime = Date.now();

    // Enqueue all jobs
    console.log(chalk.yellow(`  Enqueuing ${config.jobCount} jobs...`));
    const taskIds: string[] = [];

    for (let i = 0; i < config.jobCount; i++) {
      const task = generateTaskPayload();
      const result = await enqueueTask(task);
      taskIds.push(result.taskId);

      if ((i + 1) % 100 === 0) {
        process.stdout.write(`\r  Enqueued: ${i + 1}/${config.jobCount}`);
      }
    }
    console.log('');

    // Store expected task IDs
    if (taskIds.length > 0) {
      await redis.sadd(`benchmark:expected:${runId}`, ...taskIds);
    }

    // Simulate chaos by checking processing and recovery
    console.log(chalk.yellow('\n  Monitoring processing (workers should handle recovery)...'));
    console.log(chalk.gray('  Note: For full chaos test, manually kill worker processes during this phase'));

    const checkStart = Date.now();
    let lastPending = config.jobCount;
    let stableCount = 0;

    while (Date.now() - checkStart < config.timeoutMs) {
      await sleep(config.checkIntervalMs);

      const metrics = await getMetrics();
      const pending = metrics.total_jobs_in_queue;
      const processing = metrics.queue_processing;
      const dlq = metrics.queue_dead_letter;
      const done = metrics.jobs_done;

      console.log(chalk.gray(`    Pending: ${pending}, Processing: ${processing}, Done: ${done}, DLQ: ${dlq}`));

      // Check if queue is stable (drained)
      if (pending === 0 && processing === 0) {
        stableCount++;
        if (stableCount >= 3) {
          console.log(chalk.green('  Queue drained and stable'));
          break;
        }
      } else {
        stableCount = 0;
      }

      lastPending = pending;
    }

    // Final accounting
    await sleep(2000); // Allow final metrics to settle

    const finalMetrics = await getMetrics();
    const completed = await redis.scard(`benchmark:completed:${runId}`);
    const dlq = finalMetrics.queue_dead_letter;
    const jobsRecovered = Number(await redis.get('metrics:jobs_recovered') || 0) - initialRecovered;

    const accountedFor = completed + dlq;
    const lost = config.jobCount - accountedFor;
    const lossRate = config.jobCount > 0 ? (lost / config.jobCount) * 100 : 0;

    const result: ChaosResult = {
      jobsEnqueued: config.jobCount,
      jobsCompleted: completed,
      jobsInDLQ: dlq,
      jobsRecovered,
      lossRate,
      durationMs: Date.now() - startTime
    };

    console.log(chalk.green(`\n  Results:`));
    console.log(chalk.white(`    Jobs enqueued: ${result.jobsEnqueued}`));
    console.log(chalk.white(`    Jobs completed: ${result.jobsCompleted}`));
    console.log(chalk.white(`    Jobs in DLQ: ${result.jobsInDLQ}`));
    console.log(chalk.white(`    Jobs recovered: ${result.jobsRecovered}`));
    console.log(chalk.white(`    Accounted for: ${accountedFor}/${config.jobCount}`));
    console.log(chalk.bold[result.lossRate === 0 ? 'green' : 'red'](
      `    Loss rate: ${result.lossRate.toFixed(2)}%`
    ));
    console.log(chalk.white(`    Duration: ${formatDuration(result.durationMs)}`));

    // Cleanup
    await redis.del('benchmark:active_run');
    await redis.del(`benchmark:expected:${runId}`);
    await redis.del(`benchmark:completed:${runId}`);

    return {
      name: 'Chaos',
      metrics: {
        'Jobs Enqueued': result.jobsEnqueued,
        'Jobs Completed': result.jobsCompleted,
        'Jobs in DLQ': result.jobsInDLQ,
        'Jobs Recovered': result.jobsRecovered,
        'Loss Rate': `${result.lossRate.toFixed(2)}%`
      },
      conditions: `${config.jobCount} jobs`,
      passed: result.lossRate === 0
    };
  } finally {
    await redis.del('benchmark:active_run');
    await redis.quit();
  }
}
