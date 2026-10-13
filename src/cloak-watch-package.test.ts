import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { load } from 'js-yaml';

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
  assert.deepEqual(desktop.repository, {
    type: 'git',
    url: 'https://github.com/cyrdax/LoW-manager.git',
    directory: 'desktop/cloak-watch',
  });
  assert.equal(desktop.build.publish.owner, 'cyrdax');
  assert.equal(desktop.build.publish.repo, 'LoW-manager');
});

test('cloak watch release workflow verifies and packages both desktop platforms natively', async () => {
  const source = await readFile(
    new URL('../.github/workflows/cloak-watch.yml', import.meta.url),
    'utf8',
  );
  const workflow = load(source) as Record<string, any>;

  assert.deepEqual(workflow.on.push.tags, ['cloak-watch-v*']);
  assert.equal(workflow.permissions.contents, 'write');
  assert.deepEqual(
    workflow.jobs.package.strategy.matrix.include.map(
      ({ os, package_script }: { os: string; package_script: string }) => ({
        os,
        package_script,
      }),
    ),
    [
      { os: 'macos-latest', package_script: 'package:mac' },
      { os: 'windows-latest', package_script: 'package:win' },
    ],
  );
  assert.equal(workflow.jobs.package['runs-on'], '${{ matrix.os }}');

  const commands = workflow.jobs.package.steps
    .map(({ run }: { run?: string }) => run)
    .filter(Boolean);
  assert.ok(commands.includes('npm ci'));
  assert.ok(commands.includes('npm test'));
  assert.ok(commands.includes('npm run typecheck'));
  assert.ok(commands.includes('npm run ${{ matrix.package_script }}'));
  assert.ok(commands.includes('npm run ${{ matrix.publish_script }}'));
});
