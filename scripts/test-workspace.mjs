import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Independent Vite/Vitest/Miniflare caches. Installed packages/browser binaries
// are prerequisites, not test results; never copy .env, dist, or generated data.
export function linkInstalledDependencies(source, destination) {
  const modules = join(source, 'node_modules');
  mkdirSync(join(destination, 'node_modules'));
  for (const name of readdirSync(modules)) {
    if (name.startsWith('.') && !['.bin', '.pnpm', '.modules.yaml'].includes(name))
      continue;
    symlinkSync(resolve(modules, name), join(destination, 'node_modules', name));
  }
}
