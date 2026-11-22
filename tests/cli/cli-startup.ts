import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

export async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return `http://127.0.0.1:${address.port}`;
}

export function close(server: Server) {
  server.closeAllConnections();
  return new Promise<void>((done) => server.close(() => done()));
}

export async function cliStartup(
  executable: 'poll' | 'events' | 'members' | 'api-whoami',
  cwd: string,
  origin: string,
  token: string,
  args: string[],
  config: { envToken?: string; defaultEnvFile?: boolean } = {},
) {
  // A CLI ignoring --env-file must not pass by loading its default file.
  const envFile =
    executable === 'api-whoami' || config.defaultEnvFile ? '.env' : '.env.test';
  await writeFile(
    join(cwd, envFile),
    `AINOOGA_API_TOKEN=${token}\nAINOOGA_API_URL=${origin}\n`,
    { mode: 0o600 },
  );
  const env = {
    PATH: process.env.PATH,
    TEST_CLI_ORIGIN: origin,
    AINOOGA_API_TOKEN: config.envToken,
  };
  const script = resolve(`scripts/${executable}.ts`);
  const guard = resolve('tests/cli/cli-loopback.mjs');
  const nodeArgs =
    executable === 'api-whoami'
      ? [
          resolve('node_modules/tsx/dist/cli.mjs'),
          '--env-file=.env',
          '--import',
          guard,
          script,
        ]
      : [
          '--import',
          createRequire(import.meta.url).resolve('tsx'),
          '--import',
          guard,
          script,
          ...(config.defaultEnvFile ? [] : ['--env-file', envFile]),
          ...args,
        ];
  return promisify(execFile)(process.execPath, nodeArgs, { cwd, env, timeout: 15000 });
}
