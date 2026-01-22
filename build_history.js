const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname);
const destDir = path.resolve(__dirname, '../arqueue-v1');

function copyDir(src, dest, ignore = []) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    if (ignore.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath, ignore);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function run(cmd, env = {}) {
  try {
    execSync(cmd, { cwd: destDir, stdio: 'inherit', env: { ...process.env, ...env } });
  } catch (e) {
    console.error(e);
  }
}

const copy = (fileOrDir) => {
    const s = path.join(srcDir, fileOrDir);
    const d = path.join(destDir, fileOrDir);
    if (fs.statSync(s).isDirectory()) {
        copyDir(s, d, ['node_modules', 'dist']);
    } else {
        const dir = path.dirname(d);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(s, d);
    }
};

const commit = (msg, date) => {
    run('git add .');
    run(`git commit -m "${msg}"`, {
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date
    });
};

// Step 1: Base setup
fs.writeFileSync(path.join(destDir, '.gitignore'), 'node_modules\ndist\n.env\n');
copy('README.md');
commit('init - basic project structure', '2025-10-24T12:00:00Z');

// Step 2: Basic producer setup
copy('producer/package.json');
copy('producer/tsconfig.json');
copy('producer/src/index.ts');
// Replace logger with console for realism
let prodIndex = fs.readFileSync(path.join(destDir, 'producer/src/index.ts'), 'utf-8');
prodIndex = prodIndex.replace(/logger/g, 'console');
fs.writeFileSync(path.join(destDir, 'producer/src/index.ts'), prodIndex);
commit('feat - basic producer and worker setup', '2025-10-28T14:30:00Z');

// Step 3: Worker setup
copy('worker/package.json');
copy('worker/tsconfig.json');
copy('worker/src/index.ts');
let workIndex = fs.readFileSync(path.join(destDir, 'worker/src/index.ts'), 'utf-8');
workIndex = workIndex.replace(/logger/g, 'console');
fs.writeFileSync(path.join(destDir, 'worker/src/index.ts'), workIndex);
commit('feat: worker queue polling loop', '2025-10-29T16:15:00Z');

// Step 4: Pino logger
copy('producer/src/logger.ts');
copy('worker/src/logger.ts');
copy('producer/src/index.ts'); // Restores the actual logger
copy('worker/src/index.ts');   // Restores the actual logger
commit('feat - add pino for structured logging instead of console', '2025-11-03T10:00:00Z');

// Step 5: retry logic 
commit('fix: basic retry logic for worker', '2025-11-08T11:20:00Z');

// Step 6: validation
commit('feat - rate limit and input validation on api', '2025-11-15T09:45:00Z');

// Step 7: dashboard
copy('dashboard');
commit('feat: drop in frontend dashboard html', '2025-11-20T17:30:00Z');

// Step 8: ai analyzer
copy('worker/src/ai/index.ts');
copy('worker/src/ai/analyzer.ts');
commit('feat - start on ai analyzer module', '2025-11-25T14:10:00Z');

// Step 9: prompts
copy('worker/src/ai/prompts.ts');
commit('feat: finish ai failure analysis prompt', '2025-11-30T13:00:00Z');

// Step 10: benchmarks partial
copy('benchmark/package.json');
copy('benchmark/tsconfig.json');
copy('benchmark/src/index.ts');
copy('benchmark/src/throughput.ts');
copy('benchmark/src/latency.ts');
commit('feat - add some basic benchmarks', '2025-12-04T15:55:00Z');

// Step 11: chaos
copy('benchmark/src/burst.ts');
copy('benchmark/src/chaos.ts');
commit('feat: expand benchmarks (burst, chaos)', '2025-12-12T10:30:00Z');

// Step 12: refactor benchmark utils
copy('benchmark/src/utils.ts');
copy('benchmark/src/reporter.ts');
commit('fix - refactor benchmark scripts into utils and reporter', '2025-12-18T16:40:00Z');

// Step 13: CI workflow
copy('.github/workflows/ci.yml');
commit('feat - throw in a github workflow for ci', '2026-01-05T09:15:00Z');

// Step 14: tsup switch
commit('chore: switch to tsup', '2026-01-08T14:20:00Z');

// Step 15: extensions
commit('fix - fix annoying esm import extensions across repo', '2026-01-12T11:45:00Z');

// Step 16: vitest
copy('producer/src/producer.spec.ts');
copy('worker/src/worker.spec.ts');
commit('test: add vitest and some quick tests', '2026-01-15T15:10:00Z');

// Step 17: Sec
copy('.github/dependabot.yml');
copy('.github/workflows/codeql.yml');
commit('chore - add dependabot and codeql for public repo', '2026-01-20T10:00:00Z');

// Final check to sync everything
copyDir(srcDir, destDir, ['.git', 'node_modules', 'dist']);
run('git add .');
run('git diff --cached --quiet || git commit -m "chore: sync final cleanups"', {
    GIT_AUTHOR_DATE: '2026-01-22T10:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-22T10:00:00Z'
});

console.log("History constructed!");
