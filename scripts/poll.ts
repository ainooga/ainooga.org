import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { PollClient } from './polls/client.js';
import { runPollCommand, usage } from './polls/commands.js';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'env-file': { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help === true) {
    console.log(usage);
    return;
  }
  const envFile = values['env-file'] ?? '.env';
  if (values['env-file'] !== undefined || existsSync(envFile)) loadEnvFile(envFile);
  // Validation is offline and does not require a token.
  const api = {
    request: (path: string, method?: string, body?: unknown) =>
      new PollClient(
        process.env.AINOOGA_API_TOKEN ?? '',
        process.env.AINOOGA_API_URL ?? 'https://ainooga.org',
      ).request(path, method, body),
  };
  console.log(JSON.stringify(await runPollCommand(positionals, api), null, 2));
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Poll command failed.');
  process.exitCode = 1;
});
