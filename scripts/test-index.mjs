import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// Export post-lint index, even for apparently clean trees: generated/ignored
// files and unstaged hunks must never make broken commits pass. POSIX only.
const parent = resolve(tmpdir());
const dir = mkdtempSync(join(parent, 'ainooga-index-'));
if (dirname(dir) !== parent || !dir.startsWith(join(parent, 'ainooga-index-')))
  throw new Error('Unexpected snapshot path');
// The developer's Git executable, as used by the invoking hook.
// eslint-disable-next-line sonarjs/no-os-command-from-path
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
try {
  git('checkout-index', '--all', '--ignore-skip-worktree-bits', `--prefix=${dir}/`);
  const { linkInstalledDependencies } = await import(
    pathToFileURL(join(dir, 'scripts/test-workspace.mjs')).href
  );
  linkInstalledDependencies(process.cwd(), dir);
  const env = { ...process.env };
  for (const key of git('rev-parse', '--local-env-vars').trim().split('\n'))
    delete env[key];
  // Use the staged runner with staged configuration, from the staged root.
  // Keep the child in this process group: runLanes internally owns/cleans its
  // detached lanes. Forward signals to it, waiting for teardown before removal.
  const runner = spawn(process.execPath, ['scripts/test-lanes.mjs'], {
    cwd: dir,
    env,
    stdio: 'inherit',
  });
  const interrupt = () => runner.kill('SIGINT');
  const terminate = () => runner.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    process.exitCode = await new Promise((done, fail) => {
      runner.on('error', fail);
      runner.on('close', (code, signal) =>
        done(code ?? (signal === 'SIGINT' ? 130 : 143)),
      );
    });
    const artifacts = join(dir, 'tmp', 'poll-test-results');
    if (process.exitCode !== 0 && existsSync(artifacts)) {
      const kept = mkdtempSync(join(parent, 'ainooga-hook-results-'));
      cpSync(artifacts, kept, { recursive: true, verbatimSymlinks: true });
      process.stderr.write(`Playwright failure artifacts: ${kept}\n`);
    }
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
