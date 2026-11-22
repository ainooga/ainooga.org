import { parseArgs } from 'node:util';
import type { EventClient } from './client.js';
import type { parseAll } from '../parse.js';
import { EventFrontmatter } from '../types.js';
import { eventSlugSchema, invitationSchema } from '../../worker/src/events/schemas.js';

export const usage = `Usage: pnpm events validate | sync --local|--remote [--dry-run]
  pnpm events [--env-file .env.prod.local] invite <slug> [--dry-run]`;

export function commandOptions(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
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

export function runInvitation(
  args: ReturnType<typeof commandOptions>,
  content: ReturnType<typeof parseAll>,
  client: () => Pick<EventClient, 'invite'>,
) {
  const fields = invitationFields(args.slug!, content);
  return client().invite(args.slug!, args.values['dry-run'] === true, fields);
}

function invitationFields(slug: string, { docs, errors }: ReturnType<typeof parseAll>) {
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
