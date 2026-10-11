import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { WranglerStore } from '../db/wrangler.js';
import { parseAll } from './parse.js';
import { eventRecord, syncEvents } from './event-sync.js';
import { EventClient } from './events/client.js';
import { EventFrontmatter } from './types.js';
import { eventSlugSchema, invitationSchema } from '../worker/src/events/schemas.js';

const usage = `Usage: pnpm events validate | sync --local|--remote [--dry-run]
  pnpm events [--env-file .env.prod.local] invite <slug> [--dry-run]`;

function commandOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'env-file': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const [command] = positionals;
  const slug = positionals[1];
  if (values.help === true) return { command, values, slug };
  if (!['validate', 'sync', 'invite'].includes(command ?? '')) throw new Error(usage);
  if (positionals.length !== (command === 'invite' ? 2 : 1)) throw new Error(usage);
  if (command === 'invite' && !eventSlugSchema.safeParse(slug).success)
    throw new Error(usage);
  if (!validOptions(command, values)) throw new Error(usage);
  return { command, values, slug };
}

function validOptions(
  command: string | undefined,
  values: { local?: boolean; remote?: boolean; 'env-file'?: string },
) {
  if (command === 'invite')
    return values.local === undefined && values.remote === undefined;
  if (command === 'sync')
    return (
      Boolean(values.local) !== Boolean(values.remote) && values['env-file'] === undefined
    );
  return Object.keys(values).length === 0;
}

async function main(): Promise<void> {
  const { command, values, slug } = commandOptions();
  if (values.help === true) {
    console.log(usage);
    return;
  }
  if (command === 'invite') {
    const result = await invite(slug!, values['env-file'], values['dry-run'] === true);
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

async function invite(
  slug: string,
  configuredEnvFile: string | undefined,
  preview: boolean,
) {
  const fields = invitationFields(slug);
  const envFile = configuredEnvFile ?? '.env';
  if (configuredEnvFile !== undefined || existsSync(envFile)) loadEnvFile(envFile);
  return new EventClient(
    process.env.AINOOGA_API_TOKEN ?? '',
    process.env.AINOOGA_API_URL ?? 'https://ainooga.org',
  ).invite(slug, preview, fields);
}

function invitationFields(slug: string) {
  const { docs, errors } = parseAll(['events']);
  if (errors.length)
    throw new Error(
      errors
        .map((error) => `${error.filePath}: ${error.field}: ${error.message}`)
        .join('\n'),
    );
  const doc = docs.find((doc) => doc.slug === slug);
  if (!doc) throw new Error(`Event not found: ${slug}`);
  const event = EventFrontmatter.parse(doc.frontmatter);
  const parsed = invitationSchema.safeParse({
    title: event.title,
    date: event.date.toISOString(),
    endDate: event.endDate?.toISOString(),
    timezone: event.timezone,
    location: event.location,
    status: event.status,
    inviteTags: event.inviteTags,
    inviteMessage: event.inviteMessage,
    links: event.links?.map(({ platform, url }) => ({ platform, url })),
  });
  if (!parsed.success) throw new Error(`${doc.filePath}: ${parsed.error.message}`);
  return parsed.data;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Event command failed.');
  process.exitCode = 1;
});
