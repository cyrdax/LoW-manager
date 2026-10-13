import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSettingsWindowDefinition,
  createWindowWebPreferences,
} from './window-options.js';

test('settings window web preferences keep the local renderer isolated from Node and remote content', () => {
  assert.deepEqual(createWindowWebPreferences('/app/preload.cjs'), {
    preload: '/app/preload.cjs',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  });
});

test('settings window starts hidden with fixed minimum dimensions and the supplied packaged page', () => {
  const definition = createSettingsWindowDefinition('/app/preload.cjs', '/app/dist/ui/index.html');

  assert.equal(definition.htmlPath, '/app/dist/ui/index.html');
  assert.equal(definition.options.show, false);
  assert.equal(definition.options.width, 720);
  assert.equal(definition.options.height, 680);
  assert.equal(definition.options.minWidth, 620);
  assert.equal(definition.options.minHeight, 560);
  assert.deepEqual(definition.options.webPreferences, createWindowWebPreferences('/app/preload.cjs'));
});
