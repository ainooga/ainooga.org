import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function run(cmd: string) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function main() {
  console.log('\n  Setting up AI Nooga...\n');

  if (!existsSync('node_modules/.package-lock.json') && !existsSync('node_modules/.modules.yaml')) {
    run('pnpm install');
  }

  run('npx simple-git-hooks');

  if (!existsSync('static/data/posts/index.json')) {
    console.log('\n  Building content for the first time...');
    run('npm run build:content');
  }

  console.log('\n  Done. Run npm run dev to start.\n');
}

main();
