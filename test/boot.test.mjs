import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Run the real classic bootstrap. Only the DOM boundary is replaced; neither
// branch can load a browser module or touch a real room during this test.
async function boot(protocol) {
  const source = await readFile(new URL('../public/boot.js', import.meta.url), 'utf8');
  const elements = {
    'app-root': {hidden:false},
    'startup-notice': {hidden:true},
  };
  const scripts = [];
  const document = {
    getElementById: id => elements[id],
    createElement: () => ({}),
    head: {appendChild: element => scripts.push(element)},
  };
  runInNewContext(source, {document, location:{protocol}});
  return {elements, scripts};
}

test('opening HTML as a local file shows startup instructions without requesting an ES module', async () => {
  const {elements, scripts} = await boot('file:');
  assert.equal(elements['app-root'].hidden, true);
  assert.equal(elements['startup-notice'].hidden, false);
  assert.equal(scripts.length, 0);
});

for (const protocol of ['http:', 'https:']) {
  test(`${protocol} entry loads the application module and keeps the local-file instructions hidden`, async () => {
    const {elements, scripts} = await boot(protocol);
    assert.equal(elements['app-root'].hidden, false);
    assert.equal(elements['startup-notice'].hidden, true);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].type, 'module');
    assert.equal(scripts[0].src, './app.mjs');
  });
}
