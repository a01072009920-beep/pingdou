import { readFile, readdir, open, rename, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { loadRoom, saveRoom } from './store.mjs';
import { createBoard } from './board.mjs';
import { initializeCanvases } from './canvases.mjs';

const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const failure = (code, message, status = 400) => Object.assign(new Error(message), {code, status});

function normalizeCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{8,32}$/.test(code)) throw failure('invalid', '邀请码需为 8–32 位字母、数字、短横线或下划线');
  return code;
}

async function optionalJSON(file) {
  try {
    const value=JSON.parse(await readFile(file, 'utf8'));
    if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('结构无效');
    return value;
  }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('房间目录数据损坏或无法读取，原文件已保留', {cause:error});
  }
}

async function writeJSON(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value));
    await handle.sync(); await handle.close(); handle = null;
    await rename(temp, file);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
  }
}

export const roomInfo = entry => ({id:entry.id, name:entry.name, hasInvite:!!entry.inviteDigest});

export async function openRooms(dataDir, {save = saveRoom} = {}) {
  const legacyRoom = await loadRoom(dataDir);
  const roomsDir = join(dataDir, 'rooms');
  await mkdir(roomsDir, {recursive:true});
  const folders = (await readdir(roomsDir, {withFileTypes:true})).filter(d => d.isDirectory() && uuid.test(d.name));
  const loaded = [];
  for (const folder of folders) {
    const dir = join(roomsDir, folder.name);
    // An interrupted initial write can leave an empty directory. Never create a room while scanning it.
    const raw = await optionalJSON(join(dir, 'room.json'));
    if (!raw) continue;
    const meta = raw.roomMeta;
    if (!meta || meta.id !== folder.name || typeof meta.name !== 'string' || !meta.name.trim()
      || meta.name.length > 40 || !digestPattern.test(meta.inviteDigest)
      || typeof meta.createdAt !== 'string' || !Number.isFinite(Date.parse(meta.createdAt))) {
      throw new Error('房间目录数据损坏或无效，原文件已保留');
    }
    loaded.push({dir, room:await loadRoom(dir), meta});
  }
  const legacyMeta = await optionalJSON(join(dataDir, 'legacy-room-meta.json'));
  if (legacyMeta && (legacyMeta.schema !== 1 || !digestPattern.test(legacyMeta.inviteDigest))) {
    throw new Error('原有房间元信息损坏，原文件已保留');
  }
  const keyFile = join(dataDir, 'room-index-key.json');
  let indexKey = await optionalJSON(keyFile);
  if (!indexKey) {
    if (loaded.length || legacyMeta) throw new Error('房间索引密钥缺失，请从备份恢复 room-index-key.json；已有作品保留');
    indexKey = {schema:1, key:randomBytes(32).toString('hex')};
    await writeJSON(keyFile, indexKey);
  }
  if (indexKey.schema !== 1 || !digestPattern.test(indexKey.key)) throw new Error('房间索引密钥无效，请从备份恢复');
  const digest = code => createHmac('sha256', Buffer.from(indexKey.key, 'hex')).update(normalizeCode(code)).digest('hex');
  const entries = new Map(), keys = new Map(), invites = new Map();
  function add(id, name, room, dir, inviteDigest) {
    if (keys.has(room.key) || (inviteDigest && invites.has(inviteDigest))) throw new Error('房间身份或邀请码重复，原文件已保留');
    const entry = {id, name, room, dataDir:dir, inviteDigest, queue:Promise.resolve(), queued:0};
    entries.set(id, entry); keys.set(room.key, entry);
    if (inviteDigest) invites.set(inviteDigest, entry);
    return entry;
  }
  const legacy = add('legacy', '原有房间', legacyRoom, dataDir, legacyMeta?.inviteDigest ?? null);
  for (const {dir, room, meta} of loaded) add(meta.id, meta.name, room, dir, meta.inviteDigest);
  const byKey = key => typeof key === 'string' && /^[a-f0-9]{48}$/.test(key) ? keys.get(key) : undefined;
  let management = Promise.resolve();
  function serial(task) {
    const result = management.then(task);
    management = result.catch(() => {});
    return result;
  }
  function available(code) {
    const hash = digest(code);
    if (invites.has(hash)) throw failure('invite_taken', '这个邀请码已被使用，请换一个', 409);
    return hash;
  }
  return {
    legacy, entries, byKey,
    idle: () => management,
    join(code) {
      let entry;
      try { entry = invites.get(digest(code)); } catch {}
      if (!entry) throw failure('invalid_invite', '邀请码不正确，请核对后重试', 401);
      return entry;
    },
    create(input) {
      return serial(async () => {
        const name = typeof input?.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 40) throw failure('invalid', '房间名称需为 1–40 个字符');
        const inviteDigest = available(input.code), id = randomUUID();
        const roomMeta = {id, name, inviteDigest, createdAt:new Date().toISOString()};
        const room = initializeCanvases({schema:1, key:randomBytes(24).toString('hex'), roomMeta, board:createBoard()});
        const dir = join(roomsDir, id);
        await save(dir, room);
        return add(id, name, room, dir, inviteDigest);
      });
    },
    setLegacyCode(key, code) {
      return serial(async () => {
        if (byKey(key) !== legacy) throw failure('unauthorized', '需要原有房间的访问凭据', 401);
        if (legacy.inviteDigest) throw failure('invite_exists', '这个房间已经设置邀请码，请向邀请人索取', 409);
        const hash = available(code);
        await writeJSON(join(dataDir, 'legacy-room-meta.json'), {schema:1, inviteDigest:hash});
        legacy.inviteDigest = hash; invites.set(hash, legacy);
        return legacy;
      });
    },
  };
}
