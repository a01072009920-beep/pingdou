// A snapshot can precede a disk write that is still in progress on this socket.
// Pending operations survive ordinary resync; only replacing the socket discards them.
export function beginSync(state) { state.ready = false; }
export function acceptSnapshot(state, message) {
  state.board = message.board; state.online = message.online; state.ready = true;
}
export function canExport(state) { return state.ready && state.pending.size === 0 && !state.exporting; }
