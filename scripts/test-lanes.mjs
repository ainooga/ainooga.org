import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
import { pathToFileURL } from 'node:url';

// Start separate POSIX groups so cancellation cannot signal Git or another hook.
export async function runLanes(lanes) {
  const start = performance.now();
  const parent = resolve(tmpdir());
  const cache = lanes.some(({ name }) => name === 'browser')
    ? mkdtempSync(join(parent, 'ainooga-pw-cache-'))
    : null;
  if (cache && dirname(cache) !== parent)
    throw new Error('Unexpected Playwright cache path');
  const groups = new Set();
  let status = 0;
  let escalation;
  let hardStop;
  const signal = (pid, sig) => {
    try {
      process.kill(pid, sig);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  function stop(code) {
    if (status !== 0) return;
    status = code;
    // Give Playwright a chance to close Chromium (its own process group).
    for (const pid of groups) signal(pid, 'SIGINT');
    escalation = setTimeout(() => {
      for (const pid of groups) signal(-pid, 'SIGTERM');
    }, 1500);
    hardStop = setTimeout(() => {
      for (const pid of groups) signal(-pid, 'SIGKILL');
    }, 3000);
  }
  const interrupt = () => stop(130);
  const terminate = () => stop(143);
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  function run({ name, cmd, args }) {
    const env =
      name === 'browser' && cache
        ? { ...process.env, PWTEST_CACHE_DIR: cache }
        : process.env;
    const child = spawn(cmd, args, { stdio: 'inherit', detached: true, env });
    if (child.pid) groups.add(child.pid);
    process.stderr.write(
      `[lanes] +${Math.round(performance.now() - start)}ms start ${name}: ${[cmd, ...args].join(' ')}\n`,
    );
    return new Promise((resolve) => {
      child.on('error', (error) => {
        process.stderr.write(`[lanes] ${name}: ${error.message}\n`);
        stop(1);
      });
      child.on('close', (code, sig) => {
        process.stderr.write(
          `[lanes] +${Math.round(performance.now() - start)}ms end ${name}: ${code ?? sig}\n`,
        );
        if (code !== 0) stop(code ?? 1);
        // Keep failed/cancelled group IDs until final cleanup, even if leader exited.
        if (code === 0 && status === 0) groups.delete(child.pid);
        resolve();
      });
    });
  }
  try {
    await Promise.all(lanes.map(run));
  } finally {
    clearTimeout(escalation);
    clearTimeout(hardStop);
    if (status !== 0) for (const pid of groups) signal(-pid, 'SIGKILL');
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    if (cache) rmSync(cache, { recursive: true, force: true });
  }
  return status;
}

function lane(name, cap, projects) {
  const key = `AINOOGA_${name.toUpperCase()}_WORKERS`;
  const override = process.env[key];
  if (override !== undefined && !/^[1-9]\d*$/.test(override))
    throw new Error(`${key}: expected a positive worker cap`);
  const limit = Math.min(
    availableParallelism(),
    override === undefined
      ? Math.max(1, Math.min(cap, Math.floor(availableParallelism() / 2)))
      : Number(override),
  );
  return {
    name,
    cmd: 'node_modules/.bin/vitest',
    args: [
      'run',
      '--no-cache',
      `--maxWorkers=${limit}`,
      ...projects.flatMap((p) => ['--project', p]),
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lanes = [
    lane('db', 7, ['db']),
    lane('fast', 4, ['node', 'dom']),
    { name: 'browser', cmd: 'node_modules/.bin/playwright', args: ['test'] },
  ];
  const selected = process.argv.slice(2);
  if (selected.some((name) => !lanes.some((item) => item.name === name)))
    throw new Error('Expected lanes: db, fast, browser');
  process.exitCode = await runLanes(
    lanes.filter(({ name }) => !selected.length || selected.includes(name)),
  );
}
