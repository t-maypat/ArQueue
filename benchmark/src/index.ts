import { Command } from 'commander';
import chalk from 'chalk';
import { runThroughputBenchmark } from './throughput';
import { runLatencyBenchmark } from './latency';
import { runBurstBenchmark } from './burst';
import { runChaosBenchmark } from './chaos';
import { printSummary, printMarkdownTable, printResumeMetrics, BenchmarkResult } from './reporter';

const program = new Command();

program
  .name('arqueue-benchmark')
  .description('ArQueue distributed task queue benchmark suite')
  .version('0.1.0');

program
  .command('throughput')
  .description('Run throughput benchmark (jobs/min)')
  .option('-d, --duration <seconds>', 'Test duration in seconds', '30')
  .option('-r, --rps <number>', 'Target requests per second', '50')
  .option('-w, --warmup <seconds>', 'Warmup duration in seconds', '5')
  .action(async (options) => {
    try {
      const result = await runThroughputBenchmark({
        durationSeconds: parseInt(options.duration),
        targetRps: parseInt(options.rps),
        warmupSeconds: parseInt(options.warmup)
      });
      printSummary([result]);
    } catch (err) {
      console.error(chalk.red('Throughput benchmark failed:'), err);
      process.exit(1);
    }
  });

program
  .command('latency')
  .description('Run latency benchmark (p50/p95/p99)')
  .option('-s, --samples <number>', 'Number of samples', '1000')
  .option('-c, --concurrent <number>', 'Concurrent enqueue requests', '10')
  .action(async (options) => {
    try {
      const result = await runLatencyBenchmark({
        sampleCount: parseInt(options.samples),
        concurrentEnqueue: parseInt(options.concurrent)
      });
      printSummary([result]);
    } catch (err) {
      console.error(chalk.red('Latency benchmark failed:'), err);
      process.exit(1);
    }
  });

program
  .command('burst')
  .description('Run burst traffic benchmark')
  .option('-s, --size <number>', 'Jobs per burst', '500')
  .option('-c, --count <number>', 'Number of bursts', '3')
  .option('-i, --interval <ms>', 'Interval between bursts', '10000')
  .action(async (options) => {
    try {
      const result = await runBurstBenchmark({
        burstSize: parseInt(options.size),
        burstCount: parseInt(options.count),
        burstIntervalMs: parseInt(options.interval)
      });
      printSummary([result]);
    } catch (err) {
      console.error(chalk.red('Burst benchmark failed:'), err);
      process.exit(1);
    }
  });

program
  .command('chaos')
  .description('Run chaos/recovery benchmark (zero job loss verification)')
  .option('-j, --jobs <number>', 'Number of jobs', '1000')
  .option('-t, --timeout <ms>', 'Timeout in milliseconds', '300000')
  .action(async (options) => {
    try {
      const result = await runChaosBenchmark({
        jobCount: parseInt(options.jobs),
        checkIntervalMs: 2000,
        timeoutMs: parseInt(options.timeout)
      });
      printSummary([result]);
    } catch (err) {
      console.error(chalk.red('Chaos benchmark failed:'), err);
      process.exit(1);
    }
  });

program
  .command('all')
  .description('Run all benchmarks')
  .option('--quick', 'Run quick benchmarks with smaller samples')
  .action(async (options) => {
    const results: BenchmarkResult[] = [];
    const quick = options.quick;

    console.log(chalk.bold.cyan('\n========================================'));
    console.log(chalk.bold.cyan('  ArQueue Full Benchmark Suite'));
    console.log(chalk.bold.cyan('========================================\n'));

    try {
      // Throughput
      console.log(chalk.bold('\n[1/4] Running Throughput Benchmark...'));
      results.push(await runThroughputBenchmark({
        durationSeconds: quick ? 15 : 30,
        targetRps: quick ? 30 : 50,
        warmupSeconds: quick ? 3 : 5
      }));

      // Latency
      console.log(chalk.bold('\n[2/4] Running Latency Benchmark...'));
      results.push(await runLatencyBenchmark({
        sampleCount: quick ? 500 : 1000,
        concurrentEnqueue: 10
      }));

      // Burst
      console.log(chalk.bold('\n[3/4] Running Burst Benchmark...'));
      results.push(await runBurstBenchmark({
        burstSize: quick ? 200 : 500,
        burstCount: quick ? 2 : 3,
        burstIntervalMs: quick ? 5000 : 10000
      }));

      // Chaos
      console.log(chalk.bold('\n[4/4] Running Chaos Benchmark...'));
      results.push(await runChaosBenchmark({
        jobCount: quick ? 500 : 1000,
        checkIntervalMs: 2000,
        timeoutMs: quick ? 120000 : 300000
      }));

      // Final output
      printSummary(results);
      printMarkdownTable(results);
      printResumeMetrics(results);

    } catch (err) {
      console.error(chalk.red('\nBenchmark suite failed:'), err);
      process.exit(1);
    }
  });

// Default action (run all)
program
  .action(async () => {
    // Run all benchmarks with quick settings by default
    await program.parseAsync(['node', 'benchmark', 'all', '--quick']);
  });

program.parse();
