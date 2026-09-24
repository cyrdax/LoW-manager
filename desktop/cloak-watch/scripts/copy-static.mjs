import { copyFile, mkdir } from 'node:fs/promises';

const ui = new URL('../dist/ui/', import.meta.url);
await mkdir(ui, { recursive: true });

for (const file of ['index.html', 'styles.css', 'renderer.js', 'preload.cjs']) {
  await copyFile(new URL(`../src/ui/${file}`, import.meta.url), new URL(file, ui));
}
