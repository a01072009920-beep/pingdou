import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard } from '../src/board.mjs';
import { readFile } from 'node:fs/promises';

test('every selectable code uses its upstream RGB except the four explicit reference adjustments', async () => {
  const lines = (await readFile(new URL('../vendor/makebead/mard-291.csv', import.meta.url),'utf8')).trim().split(/\r?\n/).slice(1);
  const board = createBoard();
  const overrides = {B7:'#3EAE7C',D5:'#B34EC6',H1:'#FFFFFF',H4:'#868686'};
  for (const line of lines) {
    const [code, , hex] = line.split(',');
    assert.equal(board.palette.find(c => c.code === code)?.hex, overrides[code] || hex, code);
  }
});

test('palette filtering keeps numeric order and original indices for actual placement', async () => {
  const { paletteEntries } = await import('../public/palette.mjs');
  const palette = createBoard().palette;
  const visible = paletteEntries(palette, 'A', '');
  assert.equal(visible.length, 26);
  assert.deepEqual(visible.slice(8, 11).map(e => e.color.code), ['A9','A10','A11']);
  const exact = paletteEntries(palette, '', ' c07 ');
  assert.equal(exact.length, 1);
  assert.equal(palette[exact[0].index].code, 'C7');
  assert.deepEqual(paletteEntries(palette, 'B', 'C7'), []);
  assert.deepEqual(paletteEntries(palette, '', '#fc283c').map(e => e.color.code), ['F4']);
  assert.deepEqual(paletteEntries(palette, '', 'ZG8').map(e => e.color.code), ['ZG8']);
  assert.deepEqual(paletteEntries(palette, '', 'unknown'), []);
  const compatible = [...palette, {name:'旧草莓',hex:'#E94E62',legacy:true}];
  assert.equal(paletteEntries(compatible).length, 291);
});
