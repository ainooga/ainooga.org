import type { PollApi } from './client.js';
import { readEligibility, readPoll } from './files.js';

export const usage = `Usage: pnpm poll [--env-file .env.prod.local] <command>
  validate <poll.md>
  create <poll.md> | update <poll.md>
  show <slug> | list | publish <slug> | archive <slug>
  allowlist add <slug> <voters.yml> | allowlist revoke <slug> <voters.yml>
  allowlist list <slug> | results <slug> | ballots <slug>`;
function arity(args: string[], length: number): void {
  if (args.length !== length) throw new Error(usage);
}
function pathFor(slug: string): string {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(slug)) throw new Error('Invalid poll slug.');
  return `/${slug}`;
}
async function allowlist(args: string[], api: PollApi) {
  const action = args[1];
  if (action === 'list') {
    arity(args, 3);
    return api.request(`${pathFor(args[2]!)}/allowlist`);
  }
  if (action !== 'add' && action !== 'revoke') throw new Error(usage);
  arity(args, 4);
  const path = `${pathFor(args[2]!)}/allowlist`;
  const identifiers = await readEligibility(args[3]!);
  let completed = 0;
  for (let offset = 0; offset < identifiers.length; offset += 50) {
    try {
      await api.request(path, 'POST', {
        action,
        identifiers: identifiers.slice(offset, offset + 50),
      });
      completed += Math.min(50, identifiers.length - offset);
    } catch {
      throw new Error(
        `Eligibility upload stopped after ${completed} confirmed entries. The last batch may have committed; safely rerun the same file.`,
      );
    }
  }
  return { processed: completed };
}
export async function runPollCommand(args: string[], api: PollApi): Promise<unknown> {
  const command = args[0];
  if (command === 'allowlist') return allowlist(args, api);
  if (command === 'list') {
    arity(args, 1);
    return api.request('');
  }
  arity(args, 2);
  if (command === 'validate' || command === 'create' || command === 'update') {
    const input = await readPoll(args[1]!);
    if (command === 'validate') return { valid: true, slug: input.slug };
    return api.request(
      command === 'create' ? '' : pathFor(input.slug),
      command === 'create' ? 'POST' : 'PUT',
      input,
    );
  }
  return simpleCommand(command, pathFor(args[1]!), api);
}
async function simpleCommand(command: string | undefined, path: string, api: PollApi) {
  switch (command) {
    case 'show':
      return api.request(path);
    case 'publish':
    case 'archive':
      return api.request(`${path}/${command}`, 'POST');
    case 'results':
    case 'ballots':
      return api.request(`${path}/${command}`);
    default:
      throw new Error(usage);
  }
}
