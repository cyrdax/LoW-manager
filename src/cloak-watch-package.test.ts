import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(path: URL): Promise<Record<string, any>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

test('cloak watch remains isolated from the Railway package', async () => {
  const root = await readJson(new URL('../package.json', import.meta.url));
  const desktop = await readJson(
    new URL('../desktop/cloak-watch/package.json', import.meta.url),
  );

  assert.equal(root.workspaces, undefined);
  assert.equal(root.dependencies?.electron, undefined);
  assert.equal(root.devDependencies?.electron, undefined);
  assert.equal(desktop.main, 'dist/main/index.js');
  assert.equal(desktop.dependencies.chokidar, '5.0.0');
  assert.equal(desktop.devDependencies.electron, '44.4.5');
  assert.equal(desktop.devDependencies['electron-builder'], '26.15.3');
});
