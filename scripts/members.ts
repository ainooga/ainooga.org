import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { MemberClient } from './members/client.js';
import { runMemberCommand, usage } from './members/commands.js';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'env-file': { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help === true) {
    console.log(usage);
    return;
  }
  if (positionals[0] !== 'validate') {
    const envFile = values['env-file'] ?? '.env';
    if (values['env-file'] !== undefined || existsSync(envFile)) loadEnvFile(envFile);
  }
  const api = {
    request: (input: Parameters<MemberClient['request']>[0], preview: boolean) =>
      new MemberClient(
        process.env.AINOOGA_API_TOKEN ?? '',
        process.env.AINOOGA_API_URL ?? '',
      ).request(input, preview),
  };
  const result = await runMemberCommand(positionals, api);
  console.log(JSON.stringify(result, null, 2));
  if (result.conflicts > 0) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Member command failed.');
  process.exitCode = 1;
});
