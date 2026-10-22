import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRoom, saveRoom } from '../src/store.mjs';
import { applyOperation } from '../src/board.mjs';
import legacyPalette from './fixtures/legacy-palette.json' with { type: 'json' };

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bead-room-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('first start creates a persistent key and subsequent load restores confirmed beads', async t => {
  const dir = await temporary(t);
  const room = await loadRoom(dir);
  assert.match(room.key, /^[a-f0-9]{48}$/);
  assert.equal(room.board.cells.length, 4096);
  const next = { ...room, board: applyOperation(room.board, { requestId:'x', action:'place', index:3, color:1, expectedRevision:0 }).board };
  await saveRoom(dir, next);
  const restored = await loadRoom(dir);
  assert.equal(restored.key, room.key);
  assert.deepEqual(restored.board.cells[3], { color: 1, revision: 1 });
});

test('corrupt and structurally invalid data are preserved and never silently replaced', async t => {
  const dir = await temporary(t);
  const file = join(dir, 'room.json');
  for (const invalid of ['{broken', JSON.stringify({schema:1,key:'bad',board:{}})]) {
    await writeFile(file, invalid);
    await assert.rejects(loadRoom(dir), /数据|损坏|无效/);
    assert.equal(await readFile(file, 'utf8'), invalid);
  }
});

test('a failed replacement does not destroy previous data', async t => {
  const dir = await temporary(t);
  const room = await loadRoom(dir);
  const file = join(dir, 'room.json');
  const original = await readFile(file, 'utf8');
  // A directory at the fixed write location forces a real filesystem failure.
  await mkdir(join(dir, 'room.json.tmp'));
  await assert.rejects(saveRoom(dir, room));
  assert.equal(await readFile(file, 'utf8'), original);
});

test('legacy artwork loads without rewriting disk and preserves every original color and revision across saves', async t => {
  const dir = await temporary(t);
  const file = join(dir, 'room.json');
  const cells = Array.from({length:4096}, (_, i) => ({color:i < 24 ? i : null, revision:i < 24 ? 1 : 0}));
  const original = JSON.stringify({schema:1, key:'a'.repeat(48), board:{size:64, palette:legacyPalette, cells, revision:24}});
  await writeFile(file, original);
  const room = await loadRoom(dir);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal(room.key, 'a'.repeat(48));
  assert.equal(room.board.palette.filter(c => !c.legacy).length, 291);
  for (let i = 0; i < 24; i++) {
    assert.equal(room.board.palette[room.board.cells[i].color].hex, legacyPalette[i].hex);
    assert.equal(room.board.cells[i].revision, 1);
  }
  assert.equal(room.board.revision, 24);
  const color = room.board.palette.findIndex(c => c.code === 'ZG8');
  const next = {...room, board:applyOperation(room.board, {requestId:'new',action:'place',index:24,color,expectedRevision:0}).board};
  await saveRoom(dir, next);
  assert.deepEqual(await loadRoom(dir), next);
});

test('modified legacy and MARD palettes are rejected without rewriting the source', async t => {
  const dir = await temporary(t);
  const file = join(dir, 'room.json');
  const room = await loadRoom(dir);
  room.board.palette[0].hex = '#123456';
  await writeFile(file, JSON.stringify(room));
  const original = await readFile(file, 'utf8');
  await assert.rejects(loadRoom(dir), /损坏|无效/);
  assert.equal(await readFile(file, 'utf8'), original);
});
