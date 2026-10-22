import { PALETTE, LEGACY_PALETTE, COMPATIBLE_PALETTE, matchesPalette } from './palette.mjs';
export { PALETTE } from './palette.mjs';
export const SIZE = 64;

export function createBoard(width = SIZE, height = width) {
  return { size: width, width, height, palette: PALETTE.map(c => ({ ...c })), revision: 0,
    cells: Array.from({ length: width * height }, () => ({ color: null, revision: 0 })) };
}
export const boardWidth = board => board.width ?? board.size;
export const boardHeight = board => board.height ?? board.size;
export const validDimension = n => Number.isInteger(n) && n >= 8 && n <= 256;

const integer = n => Number.isSafeInteger(n) && n >= 0;
export function isValidBoard(board) {
  return board && validDimension(boardWidth(board)) && validDimension(boardHeight(board)) && integer(board.revision)
    && [PALETTE, LEGACY_PALETTE, COMPATIBLE_PALETTE].some(palette => matchesPalette(board.palette, palette))
    && Array.isArray(board.cells) && board.cells.length === boardWidth(board) * boardHeight(board)
    && board.cells.every(c => c && integer(c.revision) && c.revision <= board.revision
      && (c.color === null || (integer(c.color) && c.color < board.palette.length)));
}

export function applyOperation(board, op) {
  if (!op || typeof op.requestId !== 'string' || op.requestId.length < 1 || op.requestId.length > 80
      || !['place', 'erase'].includes(op.action) || !integer(op.index) || op.index >= board.cells.length
      || !integer(op.expectedRevision)
      || (op.action === 'place' && (!integer(op.color) || op.color >= board.palette.length))) {
    return { ok: false, code: 'invalid' };
  }
  const cell = board.cells[op.index];
  if (cell.revision !== op.expectedRevision) return { ok: false, code: 'stale' };
  if (op.action === 'place' && cell.color !== null) return { ok: false, code: 'occupied' };
  if (op.action === 'erase' && cell.color === null) return { ok: true, changed: false, board };
  if (!Number.isSafeInteger(board.revision + 1)) return { ok: false, code: 'revision_limit' };
  const cells = board.cells.slice();
  cells[op.index] = { color: op.action === 'place' ? op.color : null, revision: cell.revision + 1 };
  const next = { ...board, cells, revision: board.revision + 1 };
  return { ok: true, changed: true, board: next,
    patch: { requestId: op.requestId, index: op.index, cell: cells[op.index], revision: next.revision } };
}
