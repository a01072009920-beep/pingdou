import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRooms } from '../src/rooms.mjs';
import { loadRoom, saveRoom } from '../src/store.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bead-rooms-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await loadRoom(dir);
  return { dir, rooms: await openRooms(dir) };
}

test('custom invite joins only its room, normalizes case and survives restart without changing legacy artwork', async t => {
  const {dir, rooms} = await fixture(t);
  const original = await readFile(join(dir, 'room.json'), 'utf8');
  const a = await rooms.create({name:'朋友的小屋',code:'  Friend_2026  '});
  const b = await rooms.create({name:'另一个房间',code:'ANOTHER-ROOM'});
  assert.equal(rooms.join('friend_2026'), a);
  assert.equal(rooms.byKey(a.room.key), a);
  assert.notEqual(a.room.key, b.room.key);
  assert.notEqual(a.room.activeId, b.room.activeId);
  assert.throws(() => rooms.join('UNKNOWN1'), {code:'invalid_invite'});
  assert.equal(rooms.byKey('你'.repeat(48)), undefined);
  const restored = await openRooms(dir);
  assert.equal(restored.join('FRIEND_2026').room.key, a.room.key);
  assert.equal(restored.join('another-room').name, '另一个房间');
  assert.equal(await readFile(join(dir, 'room.json'), 'utf8'), original);
  assert.equal((await readFile(join(a.dataDir,'room.json'),'utf8')).includes('FRIEND_2026'), false);
});

test('duplicate concurrent invites have one durable winner and invalid names and codes cannot create rooms', async t => {
  const {dir, rooms} = await fixture(t);
  const results = await Promise.allSettled(['samecode','SAMECODE'].map(code => rooms.create({name:'房间',code})));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'invite_taken');
  for (const input of [{name:'',code:'ABCDEFGH'},{name:'x'.repeat(41),code:'ABCDEFGH'},
    {name:'ok',code:'short'},{name:'ok',code:'../outside'},{name:'ok',code:'a'.repeat(33)}]) {
    await assert.rejects(rooms.create(input), {code:'invalid'});
  }
  assert.equal((await openRooms(dir)).entries.size, 2);
});

test('failed creation never publishes a joinable room and can be retried', async t => {
  const {dir} = await fixture(t);
  let fail = true;
  const rooms = await openRooms(dir, {save:async (...args) => {
    if (fail) throw new Error('disk unavailable');
    return saveRoom(...args);
  }});
  await assert.rejects(rooms.create({name:'room',code:'RETRY123'}), /disk unavailable/);
  assert.throws(() => rooms.join('RETRY123'), {code:'invalid_invite'});
  assert.equal((await openRooms(dir)).entries.size, 1);
  fail = false;
  const room = await rooms.create({name:'room',code:'RETRY123'});
  assert.equal(rooms.join('retry123'), room);
});

test('legacy invitation is saved separately and does not replace its key or artwork', async t => {
  const {dir, rooms} = await fixture(t);
  const original = await readFile(join(dir, 'room.json'), 'utf8');
  await assert.rejects(rooms.setLegacyCode('0'.repeat(48),'LEGACY12'), {code:'unauthorized'});
  await rooms.setLegacyCode(rooms.legacy.room.key, 'LEGACY12');
  assert.equal(rooms.join('legacy12'), rooms.legacy);
  await assert.rejects(rooms.setLegacyCode(rooms.legacy.room.key,'OTHER123'), {code:'invite_exists'});
  const restored = await openRooms(dir);
  assert.equal(restored.join('LEGACY12').room.key, rooms.legacy.room.key);
  assert.equal(await readFile(join(dir, 'room.json'), 'utf8'), original);
});

test('missing index key or damaged room data is reported and never reset', async t => {
  const {dir, rooms} = await fixture(t);
  const a = await rooms.create({name:'room',code:'KEEP1234'});
  const secretFile = join(dir, 'room-index-key.json');
  const secret = await readFile(secretFile,'utf8');
  await rm(secretFile);
  await assert.rejects(openRooms(dir), /索引密钥/);
  await writeFile(secretFile, secret);
  await writeFile(join(a.dataDir,'room.json'), '{broken');
  await assert.rejects(openRooms(dir), /损坏|无效/);
  assert.equal(await readFile(join(a.dataDir,'room.json'),'utf8'), '{broken');
});

test('failed legacy invitation persistence leaves no active invitation', async t => {
  const {dir, rooms} = await fixture(t);
  await mkdir(join(dir,'legacy-room-meta.json'));
  await assert.rejects(rooms.setLegacyCode(rooms.legacy.room.key,'FAIL1234'));
  assert.throws(() => rooms.join('FAIL1234'), {code:'invalid_invite'});
  assert.equal(rooms.legacy.inviteDigest, null);
});

test('JSON null is corruption, not a missing file that can be silently replaced',async t=>{
  const {dir,rooms}=await fixture(t);
  const a=await rooms.create({name:'room',code:'NOTNULL1'});
  await writeFile(join(a.dataDir,'room.json'),'null');
  await assert.rejects(openRooms(dir),/损坏|无效/);
  assert.equal(await readFile(join(a.dataDir,'room.json'),'utf8'),'null');
});
