import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ControlPanel } from '../web/src/components/ControlPanel.tsx';

test('sidebar brand renders a safe external link to the GitHub repository', () => {
  const html = renderToStaticMarkup(createElement(ControlPanel, {
    chars: [],
    selection: new Set<number>(),
    view: 'pilots',
    setView: () => undefined,
  }));

  assert.match(html, />GitHub repository<\/a>/);
  assert.match(html, /href="https:\/\/github\.com\/cyrdax\/LoW-manager"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer"/);
});
