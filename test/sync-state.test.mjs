import test from 'node:test';
import assert from 'node:assert/strict';
import { beginSync, acceptSnapshot, canExport } from '../public/sync-state.mjs';

test('foreground sync and an old committed snapshot cannot enable export before pending ack', () => {
  const state={ready:true, exporting:false, board:{revision:0}, pending:new Map([['waiting',{index:12}]])};
  beginSync(state);
  assert.equal(state.ready,false);
  acceptSnapshot(state,{board:{revision:0},online:1});
  assert.equal(state.pending.has('waiting'),true);
  assert.equal(canExport(state),false);
  state.pending.delete('waiting');
  assert.equal(canExport(state),true);
  state.exporting=true;
  assert.equal(canExport(state),false);
});
