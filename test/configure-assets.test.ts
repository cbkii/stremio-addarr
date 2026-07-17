import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../assets/configure.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/configure.css', import.meta.url), 'utf8');

test('configuration UI assets contain TV navigation and compact responsive layout safeguards', () => {
  assert.match(script, /FIELD_HELP/);
  const helpDeclaration = script.indexOf('const FIELD_HELP');
  const startupCall = script.indexOf('enhanceConfigurationUi();');
  assert.ok(helpDeclaration >= 0 && startupCall > helpDeclaration, 'configuration UI must initialise after FIELD_HELP');
  assert.match(script, /dataset\.tvLast/);
  assert.match(script, /active\.type === 'number'/);
  assert.match(script, /BrowserBack/);
  assert.match(script, /switchTab/);
  assert.match(css, /--button: #3b2367/);
  assert.match(css, /grid-template-columns: repeat\(2/);
  assert.match(css, /status-card\[data-state="online"\]/);
});
