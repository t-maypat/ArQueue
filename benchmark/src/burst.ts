import { createRedis, clearQueues, enqueueTask, generateTaskPayload, waitForQueueDrain, sleep, formatDuration, getMetrics } from './utils.js';
import { BenchmarkResult, printHeader } from './reporter.js';
import chalk from 'chalk';

export interface BurstConfig {
  burstSize: number;
  burstCount: number;
  burstIntervalMs: number;
}

export interface BurstResult {
  totalJobs: number;
  jobsCompleted: number;
  jobsLost: number;
  peakQueueDepth: number;
  totalDurationMs: number;
  avgBurstProcessingMs: number;
}

export async function runBurstBenchmark(config: BurstConfig = {
  burstSize: 500,
  burstCount: 3,
  burstIntervalMs: 10000
}): Promise<BenchmarkResult> {
  printHeader('Burst Traffic Benchmark');

  const redis = createRedis();

  try {
    console.log(chalk.gray(`  Burst size: ${config.burstSize} jobs`));
    console.log(chalk.gray(`  Burst count: ${config.burstCount}`));
    console.log(chalk.gray(`  Interval: ${config.burstIntervalMs}ms\n`));

    // Clear queues
    console.log(chalk.yellow('  Clearing queues...'));
    await clearQueues(redis);
    await sleep(500); // Allow metrics to settle

    // Get initial count directly from Redis (not HTTP endpoint which has local fallback)
    const initialDone = Number(await redis.get('metrics:jobs_done') || 0);

    let totalEnqueued = 0;
    let peakQueueDepth = 0;
    const burstTimes: number[] = [];

    for (let burst = 0; burst < config.burstCount; burst++) {
      console.log(chalk.yellow(`\n  Burst ${burst + 1}/${config.burstCount}: Sending ${config.burstSize} jobs instantly...`));

      const burstStart = Date.now();

      // Enqueue all jobs as fast as possible (burst)
      const promises = [];
      for (let i = 0; i < config.burstSize; i++) {
        const task = generateTaskPayload();
        promises.push(enqueueTask(task));
      }

      await Promise.all(promises);
      totalEnqueued += config.burstSize;

      const enqueueTime = Date.now() - burstStart;
      console.log(chalk.gray(`    Enqueue time: ${enqueueTime}ms`));

      // Check peak queue depth
      const queueDepth = await redis.llen('queue:pending');
      if (queueDepth > peakQueueDepth) {
        peakQueueDepth = queueDepth;
      }
      console.log(chalk.gray(`    Queue depth: ${queueDepth}`));

      // Wait for this burst to be processed
      console.log(chalk.gray('    Waiting for burst to drain...'));
      const drainStart = Date.now();
      await waitForQueueDrain(redis, 60000);
      const burstTime = Date.now() - burstStart;
      burstTimes.push(burstTime);

      console.log(chalk.green(`    Burst processed in ${formatDuration(burstTime)}`));

      // Wait before next burst (if not last)
      if (burst < config.burstCount - 1) {
        console.log(chalk.gray(`    Waiting ${config.burstIntervalMs}ms before next burst...`));
        await sleep(config.burstIntervalMs);
      }
    }

    // Final metrics - read directly from Redis
    await sleep(500); // Allow final metrics to settle
    const finalDone = Number(await redis.get('metrics:jobs_done') || 0);
    const finalDlq = await redis.llen('queue:dead_letter');
    const completed = finalDone - initialDone;
    const lost = totalEnqueued - completed - finalDlq;
    const totalDuration = burstTimes.reduce((a, b) => a + b, 0);
    const avgBurstTime = Math.round(totalDuration / config.burstCount);

    const result: BurstResult = {
      totalJobs: totalEnqueued,
      jobsCompleted: completed,
      jobsLost: Math.max(0, lost),
      peakQueueDepth,
      totalDurationMs: totalDuration,
      avgBurstProcessingMs: avgBurstTime
    };

    console.log(chalk.green(`\n  Results:`));
    console.log(chalk.white(`    Total jobs: ${result.totalJobs}`));
    console.log(chalk.white(`    Jobs completed: ${result.jobsCompleted}`));
    console.log(chalk.white(`    Jobs lost: ${result.jobsLost}`));
    console.log(chalk.white(`    Peak queue depth: ${result.peakQueueDepth}`));
    console.log(chalk.bold.green(`    Avg burst processing: ${formatDuration(result.avgBurstProcessingMs)}`));

    return {
      name: 'Burst',
      metrics: {
        'Burst Size': config.burstSize,
        'Jobs Processed': result.jobsCompleted,
        'Jobs Lost': result.jobsLost,
        'Peak Queue': result.peakQueueDepth,
        'Duration': formatDuration(result.avgBurstProcessingMs)
      },
      conditions: `${config.burstCount} bursts of ${config.burstSize} jobs`,
      passed: result.jobsLost === 0 && result.jobsCompleted >= result.totalJobs * 0.99
    };
  } finally {
    await redis.quit();
  }
}
