import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, applyOperation } from '../src/board.mjs';

const place = (index, color = 0, expectedRevision = 0) => ({ requestId: 'p', action: 'place', index, color, expectedRevision });
const erase = (index, expectedRevision) => ({ requestId: 'e', action: 'erase', index, expectedRevision });

test('one placement changes only its cell and does not mutate the saved input', () => {
  const board = createBoard();
  const result = applyOperation(board, place(12));
  assert.equal(result.ok, true);
  assert.deepEqual(result.board.cells[12], { color: 0, revision: 1 });
  assert.equal(result.board.revision, 1);
  assert.deepEqual(board.cells[12], { color: null, revision: 0 });
  assert.equal(result.board.cells.filter(c => c.color !== null).length, 1);
});

test('occupied cell rejects both same-color and different-color placement', () => {
  const first = applyOperation(createBoard(), place(0)).board;
  for (const color of [0, 1]) {
    assert.equal(applyOperation(first, place(0, color, 1)).code, 'occupied');
  }
});

test('any participant can erase, then a new color can be placed', () => {
  const first = applyOperation(createBoard(), { ...place(4), participant: 'A' }).board;
  const second = applyOperation(first, { ...erase(4, 1), participant: 'B' }).board;
  assert.deepEqual(second.cells[4], { color: null, revision: 2 });
  const third = applyOperation(second, place(4, 2, 2)).board;
  assert.deepEqual(third.cells[4], { color: 2, revision: 3 });
  assert.equal(applyOperation(third, erase(4, 1)).code, 'stale');
});

test('empty erase is a no-op and unrelated cells do not conflict', () => {
  const empty = createBoard();
  const noChange = applyOperation(empty, erase(3, 0));
  assert.equal(noChange.ok, true);
  assert.equal(noChange.changed, false);
  assert.equal(noChange.board, empty);
  const next = applyOperation(empty, place(0)).board;
  assert.equal(applyOperation(next, place(1)).ok, true);
});

test('invalid client input cannot place or erase outside the board or palette', () => {
  for (const change of [{ index: -1 }, { index: 4096 }, { index: 0.5 }, { color: 291 }, { color: -1 }, { color: null }, { expectedRevision: -1 }, { action: 'clear' }, { requestId: {} }]) {
    assert.equal(applyOperation(createBoard(), { ...place(0), ...change }).ok, false, JSON.stringify(change));
  }
});

test('all 291 MARD codes can be placed in series and numeric order with the requested reference colors', () => {
  let board = createBoard();
  assert.equal(board.palette.length, 291);
  assert.equal(new Set(board.palette.map(c => c.code)).size, 291);
  const groups = [...new Set(board.palette.map(c => c.group))];
  assert.deepEqual(groups, ['A','B','C','D','E','F','G','H','M','P','T','R','Y','Q','ZG']);
  assert.deepEqual(board.palette.slice(0, 11).map(c => c.code), ['A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11']);
  for (const [code, hex] of Object.entries({A5:'#F4D738', A7:'#FE8B4C', B7:'#3EAE7C', C7:'#3677D2', D5:'#B34EC6', E5:'#F551A2', F4:'#FC283C', G7:'#9D5B3E', H1:'#FFFFFF', H4:'#868686', H7:'#000000', ZG8:'#AB91C0'})) {
    assert.equal(board.palette.find(c => c.code === code)?.hex, hex, code);
  }
  for (let color = 0; color < 291; color++) {
    const result = applyOperation(board, place(color, color));
    assert.equal(result.ok, true);
    board = result.board;
  }
  assert.equal(board.revision, 291);
  assert.equal(board.cells[290].color, 290);
});
