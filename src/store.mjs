import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createBoard, isValidBoard } from './board.mjs';
import { upgradeLegacyBoard } from './palette.mjs';
import { initializeCanvases, validCanvases } from './canvases.mjs';

function validRoom(room) {
  return room?.schema === 1 && typeof room.key === 'string'
    && /^[a-f0-9]{48}$/.test(room.key) && isValidBoard(room.board) && validCanvases(room);
}

export async function saveRoom(dataDir, room) {
  if (!validRoom(room)) throw new Error('拼豆数据无效，无法保存');
  await mkdir(dataDir, { recursive: true });
  const temp = join(dataDir, 'room.json.tmp');
  let handle;
  try {
    handle = await open(temp, 'w', 0o600);
    await handle.writeFile(JSON.stringify(room));
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, join(dataDir, 'room.json'));
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function loadRoom(dataDir) {
  await mkdir(dataDir, { recursive: true });
  let text;
  try { text = await readFile(join(dataDir, 'room.json'), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const room = { schema: 1, key: randomBytes(24).toString('hex'), board: createBoard() };
    await saveRoom(dataDir, room);
    return initializeCanvases(room);
  }
  try {
    const room = JSON.parse(text);
    if (!validRoom(room)) throw new Error('结构无效');
    const upgraded = { ...room, board: upgradeLegacyBoard(room.board) };
    if (room.canvases) upgraded.canvases = room.canvases.map(c => ({ ...c, board: upgradeLegacyBoard(c.board) }));
    return initializeCanvases(upgraded);
  } catch (cause) {
    throw new Error('本机拼豆数据损坏或无效。原文件已保留，请备份 data/room.json 后检查。', { cause });
  }
}
