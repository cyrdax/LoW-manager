import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolsView } from '../web/src/components/ToolsView.tsx';

test('tools view explains and links both unsigned Cloak Watch preview builds', () => {
  const html = renderToStaticMarkup(createElement(ToolsView));

  assert.match(html, /Cloak Watch/);
  assert.match(html, />Preview</);
  assert.match(html, />Download for macOS</);
  assert.match(html, />Download for Windows</);
  assert.equal(
    Array.from(html.matchAll(/href="https:\/\/github\.com\/cyrdax\/LoW-manager\/releases\/tag\/cloak-watch-v0\.1\.0"/g)).length,
    2,
  );
  assert.match(html, /Install on macOS/);
  assert.match(html, /Install on Windows/);
  assert.match(html, /Control-click/);
  assert.match(html, /More info/);
  assert.match(html, /EVE GameLogs/);
  assert.match(html, /local parser/);
  assert.match(html, /sound or desktop notification/i);
  assert.match(html, /no network requests/i);
  assert.match(html, /never controls or modifies the EVE client/i);
});

test('the fixed sidebar collapses above public tools content on phone-sized screens', async () => {
  const css = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
  const mobile = css.match(/@media \(max-width: 760px\) \{[\s\S]*?\/\* mobile-shell-end \*\//)?.[0] ?? '';

  assert.match(mobile, /\.layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(mobile, /\.sidebar\s*\{[^}]*border-right:\s*0/s);
  assert.match(mobile, /\.view-nav\.view-nav-10\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
});
