import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { globSync } from 'node:fs';

interface ImageConfig {
  sourcePath: string;
  outputDir: string;
  sizes: number[];
  formats: ('webp' | 'avif')[];
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.tiff', '.gif'];

function isImage(file: string): boolean {
  return IMAGE_EXTENSIONS.includes(extname(file).toLowerCase());
}

function isGif(file: string): boolean {
  return extname(file).toLowerCase() === '.gif';
}

export function globImages(): string[] {
  return globSync('content/**/*.*')
    .filter(isImage)
    .filter((f) => !f.includes('node_modules'));
}

export async function processImage(
  sourcePath: string,
  outputBase: string,
): Promise<{ outputs: string[] }> {
  const outputs: string[] = [];
  const name = basename(sourcePath, extname(sourcePath));

  if (isGif(sourcePath)) {
    // Passthrough — copy GIF as-is
    const outPath = join(outputBase, `${name}.gif`);
    mkdirSync(dirname(outPath), { recursive: true });
    const buffer = readFileSync(sourcePath);
    const outputFile = join('static/images', basename(outPath));
    mkdirSync(dirname(outputFile), { recursive: true });
    await sharp(buffer).toFile(outputFile);
    outputs.push(outputFile);
    return { outputs };
  }

  const sizes: ImageConfig['sizes'] = [200, 600, 800, 1600];
  const formats: ImageConfig['formats'] = ['webp', 'avif'];

  for (const size of sizes) {
    for (const fmt of formats) {
      const outName = `${name}-${size}w.${fmt}`;
      const outPath = join('static/images', outName);
      mkdirSync(dirname(outPath), { recursive: true });
      await sharp(sourcePath).resize(size).toFormat(fmt).toFile(outPath);
      outputs.push(outPath);
    }
  }

  return { outputs };
}

export async function processAllImages(): Promise<{
  processed: number;
  errors: string[];
}> {
  const images = globImages();
  let processed = 0;
  const errors: string[] = [];

  for (const img of images) {
    try {
      await processImage(img, 'static/images');
      processed++;
    } catch (err) {
      errors.push(`${img}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { processed, errors };
}
