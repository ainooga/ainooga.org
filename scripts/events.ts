import { parseArgs } from 'node:util';
import { WranglerStore } from '../db/wrangler.js';
import { parseAll } from './parse.js';
import { eventRecord, syncEvents } from './event-sync.js';

const usage = 'Usage: pnpm events validate | sync --local|--remote [--dry-run]';

function commandOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  const [command] = positionals;
  if (values.help === true) return { command, values };
  if (positionals.length !== 1 || !['validate', 'sync'].includes(command ?? ''))
    throw new Error(usage);
  if (command === 'sync' && Boolean(values.local) === Boolean(values.remote))
    throw new Error(usage);
  if (command === 'validate' && Object.keys(values).length > 0) throw new Error(usage);
  return { command, values };
}

async function main(): Promise<void> {
  const { command, values } = commandOptions();
  if (values.help === true) {
    console.log(usage);
    return;
  }
  const { docs, errors } = parseAll(['events']);
  if (errors.length > 0)
    throw new Error(
      errors
        .map((error) => `${error.filePath}: ${error.field}: ${error.message}`)
        .join('\n'),
    );
  const result =
    command === 'validate'
      ? {
          events: docs.map(eventRecord).filter((event) => event.published),
          skipped: docs.filter((doc) => doc.frontmatter.status === 'draft').length,
        }
      : await syncEvents(
          new WranglerStore(values.remote === true, true),
          docs,
          values['dry-run'] === true,
        );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Event command failed.');
  process.exitCode = 1;
});
