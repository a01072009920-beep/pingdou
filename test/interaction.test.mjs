import test from 'node:test';
import assert from 'node:assert/strict';
import { TapGesture } from '../public/interaction.mjs';

test('a single jittery tap places once in the same cell', () => {
  const gesture = new TapGesture();
  gesture.down(1, 100, 100, 12);
  gesture.move(1, 103, 102);
  assert.equal(gesture.up(1, 103, 102, 12), 12);
  assert.equal(gesture.up(1, 103, 102, 12), null);
});

test('dragging out and back cannot accidentally place a bead', () => {
  const gesture = new TapGesture();
  gesture.down(1, 0, 0, 0); gesture.move(1, 30, 0); gesture.move(1, 0, 0);
  assert.equal(gesture.up(1, 0, 0, 0), null);
});

test('pinching suppresses both fingers until the entire gesture has ended', () => {
  const gesture = new TapGesture();
  gesture.down(1, 0, 0, 0); gesture.down(2, 10, 0, 1);
  assert.equal(gesture.up(2, 10, 0, 1), null);
  assert.equal(gesture.up(1, 0, 0, 0), null);
  gesture.down(1, 0, 0, 2);
  assert.equal(gesture.up(1, 0, 0, 2), 2);
});

test('cancelled gesture and a tap crossing a cell border never place', () => {
  const gesture = new TapGesture();
  gesture.down(1, 0, 0, 0); gesture.cancel();
  assert.equal(gesture.up(1, 0, 0, 0), null);
  gesture.down(2, 0, 0, 0);
  assert.equal(gesture.up(2, 2, 0, 1), null);
});

test('cancelling one pointer retains suppression until the remaining fingers lift', () => {
  const gesture = new TapGesture();
  gesture.down(1,100,100,12); gesture.down(2,110,100,13);
  gesture.cancel(1);
  gesture.down(3,100,100,12);
  assert.equal(gesture.up(3,100,100,12), null);
  assert.equal(gesture.up(2,110,100,13), null);
  gesture.down(4,100,100,12);
  assert.equal(gesture.up(4,100,100,12),12);
});
