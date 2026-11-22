import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { WranglerStore } from '../db/wrangler.js';
import { parseAll } from './parse.js';
import { eventRecord, syncEvents } from './event-sync.js';
import { EventClient } from './events/client.js';
import { commandOptions, runInvitation, usage } from './events/commands.js';

async function main(): Promise<void> {
  const options = commandOptions(process.argv.slice(2));
  const { command, values } = options;
  if (values.help === true) {
    console.log(usage);
    return;
  }
  if (command === 'invite') {
    const result = await runInvitation(options, parseAll(['events']), () =>
      eventClient(values['env-file']),
    );
    console.log(JSON.stringify(result, null, 2));
    if ('failed' in result && result.failed > 0) process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify(
      await contentCommand(command, values.remote === true, values['dry-run'] === true),
      null,
      2,
    ),
  );
}

async function contentCommand(
  command: string | undefined,
  remote: boolean,
  dryRun: boolean,
) {
  const { docs, errors } = parseAll(['events']);
  if (errors.length > 0)
    throw new Error(
      errors
        .map((error) => `${error.filePath}: ${error.field}: ${error.message}`)
        .join('\n'),
    );
  return command === 'validate'
    ? {
        events: docs.map(eventRecord).filter((event) => event.published),
        skipped: docs.filter((doc) => doc.frontmatter.status === 'draft').length,
      }
    : await syncEvents(new WranglerStore(remote, true), docs, dryRun);
}

function eventClient(configuredEnvFile: string | undefined) {
  const envFile = configuredEnvFile ?? '.env';
  if (configuredEnvFile !== undefined || existsSync(envFile)) loadEnvFile(envFile);
  return new EventClient(
    process.env.AINOOGA_API_TOKEN ?? '',
    process.env.AINOOGA_API_URL ?? 'https://ainooga.org',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Event command failed.');
  process.exitCode = 1;
});
