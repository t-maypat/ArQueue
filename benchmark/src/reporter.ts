import chalk from 'chalk';

export interface BenchmarkResult {
  name: string;
  metrics: Record<string, number | string | null>;
  conditions: string;
  passed: boolean;
}

export function printHeader(title: string): void {
  console.log('\n' + chalk.bold.cyan('='.repeat(60)));
  console.log(chalk.bold.cyan(`  ${title}`));
  console.log(chalk.bold.cyan('='.repeat(60)) + '\n');
}

export function printResult(result: BenchmarkResult): void {
  const status = result.passed
    ? chalk.green('PASS')
    : chalk.red('FAIL');

  console.log(`${status} ${chalk.bold(result.name)}`);
  console.log(chalk.gray(`  Conditions: ${result.conditions}`));

  for (const [key, value] of Object.entries(result.metrics)) {
    const formattedValue = value === null ? 'N/A' : String(value);
    console.log(`  ${chalk.yellow(key)}: ${chalk.white(formattedValue)}`);
  }
  console.log('');
}

export function printMarkdownTable(results: BenchmarkResult[]): void {
  console.log(chalk.bold.cyan('\n## ArQueue Performance Metrics'));
  console.log('| Metric | Value | Conditions |');
  console.log('|--------|-------|------------|');

  for (const result of results) {
    for (const [key, value] of Object.entries(result.metrics)) {
      const formattedValue = value === null ? 'N/A' : String(value);
      console.log(`| ${key} | ${formattedValue} | ${result.conditions} |`);
    }
  }
}

export function printJsonReport(results: BenchmarkResult[]): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    results: results.map(r => ({
      name: r.name,
      metrics: r.metrics,
      conditions: r.conditions,
      passed: r.passed
    }))
  }, null, 2));
}

export function printSummary(results: BenchmarkResult[]): void {
  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  console.log(chalk.bold.cyan('\n' + '='.repeat(60)));
  console.log(chalk.bold(`  Summary: ${passed}/${total} benchmarks passed`));

  if (passed === total) {
    console.log(chalk.green('  All benchmarks passed!'));
  } else {
    console.log(chalk.red(`  ${total - passed} benchmark(s) failed`));
  }

  console.log(chalk.bold.cyan('='.repeat(60)) + '\n');
}

export function printResumeMetrics(results: BenchmarkResult[]): void {
  console.log(chalk.bold.magenta('\n' + '='.repeat(60)));
  console.log(chalk.bold.magenta('  RESUME-READY METRICS'));
  console.log(chalk.bold.magenta('='.repeat(60)) + '\n');

  const throughput = results.find(r => r.name === 'Throughput');
  const latency = results.find(r => r.name === 'Latency');
  const chaos = results.find(r => r.name === 'Chaos');
  const burst = results.find(r => r.name === 'Burst');

  if (throughput) {
    console.log(chalk.white(`  Throughput: ${chalk.bold.green(throughput.metrics['Jobs/min'])} jobs/min`));
  }
  if (latency) {
    console.log(chalk.white(`  p95 Latency: ${chalk.bold.green(latency.metrics['p95'])}ms`));
  }
  if (chaos) {
    console.log(chalk.white(`  Job Loss: ${chalk.bold.green(chaos.metrics['Loss Rate'])}`));
  }
  if (burst) {
    console.log(chalk.white(`  Burst: ${chalk.bold.green(burst.metrics['Jobs Processed'])} jobs in ${burst.metrics['Duration']}`));
  }

  console.log('\n' + chalk.gray('  Copy for your resume:'));
  console.log(chalk.cyan(`  "Supporting ${throughput?.metrics['Jobs/min'] || 'X'}+ jobs/min at p95 latency of ${latency?.metrics['p95'] || 'Y'}ms"`));
  console.log(chalk.cyan(`  "Maintaining stability under ${burst?.metrics['Burst Size'] || 'X'} req/sec burst traffic"`));
  console.log('');
}
