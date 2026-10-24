import { randomUUID } from 'node:crypto';
import { createBoard, boardWidth, boardHeight, validDimension, isValidBoard } from './board.mjs';
import { validImportReference } from './import-pattern.mjs';

export function initializeCanvases(room) {
  if (room.canvases) return room;
  const id = randomUUID();
  return { ...room, activeId: id, canvasEpoch: 0,
    canvases: [{ id, name: '我的第一张画布', createdAt: new Date().toISOString(), board: room.board }] };
}
export function validCanvases(room) {
  return room.canvases === undefined || (Array.isArray(room.canvases) && room.canvases.length > 0
    && Number.isSafeInteger(room.canvasEpoch) && room.canvasEpoch >= 0
    && room.canvases.every(c => c && typeof c === 'object')
    && new Set(room.canvases.map(c => c.id)).size === room.canvases.length
    && room.canvases.some(c => c.id === room.activeId)
    && room.canvases.every(c => typeof c.id === 'string' && typeof c.name === 'string' && isValidBoard(c.board)
      && (c.reference === undefined || validImportReference(c.reference,boardWidth(c.board),boardHeight(c.board)))));
}
export function catalog(room) {
  return room.canvases.map(c => ({ id: c.id, name: c.name, createdAt: c.createdAt,
    width: boardWidth(c.id === room.activeId ? room.board : c.board),
    height: boardHeight(c.id === room.activeId ? room.board : c.board) }));
}
export function withBoard(room, board) {
  return { ...room, board, canvases: room.canvases.map(c => c.id === room.activeId ? { ...c, board } : c) };
}
export function changeCanvas(room, message) {
  if (message.canvasId !== room.activeId || message.epoch !== room.canvasEpoch
      || message.expectedRevision !== room.board.revision) return { ok: false, code: 'stale_canvas' };
  if (!Number.isSafeInteger(room.canvasEpoch + 1) || !Number.isSafeInteger(room.board.revision + 1))
    return { ok: false, code: 'revision_limit' };
  let next = withBoard(room, room.board);
  const { action, width, height } = message;
  if (['new', 'expand'].includes(action) && (!validDimension(width) || !validDimension(height))) return { ok: false, code: 'invalid' };
  if (action === 'new') {
    const name = typeof message.name === 'string' ? message.name.trim().slice(0, 60) : '';
    if (!name) return { ok: false, code: 'invalid' };
    const entry = { id: randomUUID(), name, createdAt: new Date().toISOString(), board: createBoard(width, height) };
    next = { ...next, activeId: entry.id, board: entry.board, canvases: [...next.canvases, entry] };
  } else if (action === 'switch') {
    const entry = next.canvases.find(c => c.id === message.targetId);
    if (!entry) return { ok: false, code: 'invalid' };
    next = { ...next, activeId: entry.id, board: entry.board };
  } else if (action === 'clear') {
    const current = next.canvases.find(c => c.id === next.activeId);
    const backup = { ...current, id: randomUUID(), name: `${current.name} · 清盘备份`, createdAt: new Date().toISOString() };
    next = { ...next, canvases: [...next.canvases, backup] };
    next = withBoard(next, { ...room.board, revision: room.board.revision + 1,
      cells: room.board.cells.map(c => ({ color: null, revision: c.revision + 1 })) });
  } else if (action === 'expand') {
    const oldWidth = boardWidth(room.board), oldHeight = boardHeight(room.board);
    if (width < oldWidth || height < oldHeight) return { ok: false, code: 'invalid' };
    const cells = Array.from({ length: width * height }, (_, i) => {
      const x = i % width, y = Math.floor(i / width);
      return x < oldWidth && y < oldHeight ? room.board.cells[y * oldWidth + x] : { color: null, revision: 0 };
    });
    next = withBoard(next, { ...room.board, size: width, width, height, cells, revision: room.board.revision + 1 });
  } else return { ok: false, code: 'invalid' };
  return { ok: true, room: { ...next, canvasEpoch: room.canvasEpoch + 1 } };
}
