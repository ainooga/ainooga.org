import { parseAll } from './parse.js';
import { processAllImages } from './images.js';
import { renderAll } from './render.js';
import { emitAll } from './emit.js';
import { verifyOutput } from './verify.js';

function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`);
}

function logErrors(errors: { filePath: string; field: string; message: string }[]): void {
  console.error('\n  Validation errors:');
  for (const err of errors) {
    console.error(`    ${err.filePath} — ${err.field}: ${err.message}`);
  }
  const fileCount = new Set(errors.map((e) => e.filePath)).size;
  console.error(`\n  Build failed. ${errors.length} error(s) in ${fileCount} file(s).`);
}

async function processStageImages(): Promise<void> {
  log('images', 'Processing images...');
  const imgResult = await processAllImages();
  log('images', `${imgResult.processed} images processed.`);
  if (imgResult.errors.length > 0) {
    for (const err of imgResult.errors) {
      console.error(`    ${err}`);
    }
    process.exit(1);
  }
}

async function main() {
  console.log('\n  Building AI Nooga content...\n');

  // Stage 1: Parse
  log('parse', 'Reading and validating markdown...');
  const { docs, errors } = parseAll();
  if (errors.length > 0) {
    logErrors(errors);
    process.exit(1);
  }
  log('parse', `${docs.length} documents parsed successfully.`);

  // Stage 2: Process images
  await processStageImages();

  // Stage 3: Render
  log('render', 'Converting markdown to HTML...');
  const processed = renderAll(docs);
  log('render', `${processed.length} documents rendered.`);

  // Stage 4: Emit
  log('emit', 'Writing JSON output...');
  emitAll(processed);
  log('emit', 'JSON files written to static/data/.');

  // Stage 5: Verify
  log('verify', 'Running sanity checks...');
  const verification = verifyOutput();
  if (!verification.pass) {
    for (const err of verification.errors) {
      console.error(`    ${err}`);
    }
    process.exit(1);
  }
  if (verification.warnings.length > 0) {
    console.log('\n  Warnings:');
    for (const w of verification.warnings) {
      console.log(`    ${w}`);
    }
  }
  log('verify', 'All checks passed.');

  console.log('\n  Build complete.\n');
}

main().catch((err) => {
  console.error('Build failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
