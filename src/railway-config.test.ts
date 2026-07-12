import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

test('railway config deploys the app with migrations and healthchecks', () => {
  const config = JSON.parse(readFileSync(resolve('railway.json'), 'utf8')) as {
    build?: { buildCommand?: string };
    deploy?: {
      startCommand?: string;
      preDeployCommand?: string;
      healthcheckPath?: string;
      healthcheckTimeout?: number;
    };
  };

  assert.equal(config.build?.buildCommand, 'npm run build:mastery && npm run build');
  assert.equal(config.deploy?.preDeployCommand, 'npm run db:migrate');
  assert.equal(config.deploy?.startCommand, 'npm start');
  assert.equal(config.deploy?.healthcheckPath, '/api/health');
  assert.equal(config.deploy?.healthcheckTimeout, 300);
});
