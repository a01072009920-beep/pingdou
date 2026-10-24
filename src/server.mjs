import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { applyOperation } from './board.mjs';
import { saveRoom } from './store.mjs';
import { openRooms, roomInfo } from './rooms.mjs';
import { createRoomAPI, sameOrigin } from './room-api.mjs';
import { ExportManager } from './export.mjs';
import { catalog, changeCanvas, withBoard } from './canvases.mjs';
import { createImportAPI } from './import-pattern.mjs';

const publicDir = new URL('../public/', import.meta.url);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/boot.js', ['boot.js', 'text/javascript; charset=utf-8']],
  ['/interaction.mjs', ['interaction.mjs', 'text/javascript; charset=utf-8']],
  ['/sync-state.mjs', ['sync-state.mjs', 'text/javascript; charset=utf-8']],
  ['/palette.mjs', ['palette.mjs', 'text/javascript; charset=utf-8']],
  ['/rooms.mjs', ['rooms.mjs', 'text/javascript; charset=utf-8']],
  ['/workspace.mjs', ['workspace.mjs', 'text/javascript; charset=utf-8']],
  ...['image-input','converter-ui','color-box','pattern-sheet','pattern-guide','color-science','pattern-data','convert-core','convert-worker']
    .map(name => [`/${name}.mjs`, [`${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/converter.css', ['converter.css', 'text/css; charset=utf-8']],
]);
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

export async function createApp({ dataDir = fileURLToPath(new URL('../data/', import.meta.url)), port = 3210,
  host = '127.0.0.1', save = saveRoom, onError = () => {} } = {}) {
  const rooms = await openRooms(dataDir, {save});
  const room = rooms.legacy.room;
  const exporter = new ExportManager();
  const roomAPI = createRoomAPI(rooms, onError);
  let closing = false, closedPromise;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const online = entry => [...wss.clients].filter(ws => ws.authorized && ws.entry === entry && ws.readyState === WebSocket.OPEN).length;
  const send = (ws, message) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.terminate(); return; }
    ws.send(JSON.stringify(message));
  };
  const broadcast = (entry, message) => { for (const ws of wss.clients) if (ws.authorized && ws.entry === entry) send(ws, message); };
  const presence = entry => broadcast(entry, { type: 'presence', online: online(entry) });
  const snapshotData = entry => ({ type: 'snapshot', board: entry.room.board, online: online(entry), room:roomInfo(entry),
    canvasId: entry.room.activeId, epoch: entry.room.canvasEpoch, canvases: catalog(entry.room),
    reference: entry.room.canvases.find(canvas => canvas.id === entry.room.activeId)?.reference ?? null });
  const snapshot = ws => send(ws, snapshotData(ws.entry));
  const importAPI = createImportAPI({rooms,save,isClosing:()=>closing,sameOrigin,onError,
    broadcast:(entry,requestId)=>broadcast(entry,{...snapshotData(entry),requestId})});

  const server = createServer(async (req, res) => {
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (closing) { res.writeHead(503); res.end('服务正在关闭'); return; }
      if (await importAPI.handle(req, res, path)) return;
      if (await roomAPI(req, res, path)) return;
      if (path === '/api/export' && req.method === 'POST') {
        const key = req.headers.authorization?.replace(/^Bearer /, '');
        const entry = rooms.byKey(key);
        if (!entry) { res.writeHead(401); res.end('需要有效房间凭据'); return; }
        const board = entry.room.board;
        try {
          const png = await exporter.render(board);
          if (res.destroyed) return;
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length,
            'Content-Disposition': `attachment; filename="bead-room-v${board.revision}-4096x4096.png"` });
          res.end(png);
        } catch (error) {
          if (!res.destroyed) { res.writeHead(error.code === 'export_busy' ? 429 : 500, {'Content-Type':'text/plain; charset=utf-8'}); res.end(error.message); }
        }
        return;
      }
      if (path === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'bead-room' }));
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method) || !assets.has(path)) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const [file, contentType] = assets.get(path);
      const content = await readFile(new URL(file, publicDir));
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 500);
      res.end('Unable to serve request');
      onError(error);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const originMatches = sameOrigin(req);
    if (closing || req.url !== '/ws' || !originMatches || wss.clients.size >= 64) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', ws => {
    ws.authorized = false;
    ws.alive = true;
    ws.pending = 0;
    ws.rate = { since: Date.now(), count: 0 };
    const authTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
    authTimer.unref();
    ws.on('error', () => {});
    ws.on('pong', () => { ws.alive = true; });
    ws.on('close', () => { clearTimeout(authTimer); if (ws.authorized && !closing) presence(ws.entry); });
    ws.on('message', (raw, isBinary) => {
      if (closing) return;
      if (Date.now() - ws.rate.since > 1000) ws.rate = { since: Date.now(), count: 0 };
      if (++ws.rate.count > 60) { ws.close(1008, 'Too many messages'); return; }
      if (isBinary) { ws.close(1003, 'Text messages only'); return; }
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { send(ws, { type: 'error', code: 'invalid', message: '消息格式无效' }); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        send(ws, { type: 'error', code: 'invalid', message: '消息格式无效' }); return;
      }
      if (!ws.authorized) {
        const entry = message.type === 'auth' ? rooms.byKey(message.key) : null;
        if (!entry) {
          send(ws, { type: 'error', code: 'unauthorized', message: '邀请密钥不正确，请重新打开完整邀请链接' });
          ws.close(1008, 'Unauthorized'); return;
        }
        ws.authorized = true;
        ws.entry = entry;
        clearTimeout(authTimer);
        snapshot(ws); presence(entry); return;
      }
      if (message.type === 'sync') { snapshot(ws); return; }
      if (!['op', 'canvas'].includes(message.type)) { send(ws, { type: 'error', code: 'invalid', message: '不支持的操作' }); return; }
      const entry = ws.entry, room = entry.room;
      if (ws.pending >= 32 || entry.queued >= 256) {
        send(ws, { type: 'rejected', requestId: message.requestId, code: 'busy' }); return;
      }
      ws.pending++; entry.queued++;
      entry.queue = entry.queue.then(async () => {
        if (closing || ws.readyState !== WebSocket.OPEN) return;
        if (message.type === 'canvas') {
          if (typeof message.requestId !== 'string' || message.requestId.length > 80) {
            send(ws, { type: 'rejected', requestId: message.requestId, code: 'invalid' }); return;
          }
          const changed = changeCanvas(room, message);
          if (!changed.ok) { send(ws, { type: 'rejected', requestId: message.requestId, code: changed.code }); return; }
          try { await save(entry.dataDir, changed.room); }
          catch (error) { onError(error); send(ws, { type: 'rejected', requestId: message.requestId, code: 'save_failed' }); return; }
          Object.assign(room, changed.room);
          broadcast(entry, { ...snapshotData(entry), requestId: message.requestId }); return;
        }
        if ((message.canvasId !== undefined || room.canvasEpoch !== 0)
          && (message.canvasId !== room.activeId || message.epoch !== room.canvasEpoch)) {
          send(ws, { type: 'rejected', requestId: message.requestId, code: 'stale_canvas' }); return;
        }
        const result = applyOperation(room.board, message);
        const cell = Number.isInteger(message.index) ? room.board.cells[message.index] : undefined;
        if (!result.ok) {
          send(ws, { type: 'rejected', requestId: message.requestId, code: result.code,
            index: cell ? message.index : undefined, cell, revision: room.board.revision }); return;
        }
        if (!result.changed) {
          send(ws, { type: 'unchanged', requestId: message.requestId, index: message.index, cell,
            revision: room.board.revision }); return;
        }
        const updated = withBoard(room, result.board);
        try { await save(entry.dataDir, updated); }
        catch (error) {
          onError(error);
          send(ws, { type: 'rejected', requestId: message.requestId, code: 'save_failed' }); return;
        }
        Object.assign(room, updated);
        broadcast(entry, { type: 'patch', ...result.patch, canvasId: room.activeId, epoch: room.canvasEpoch });
      }).catch(error => { onError(error); send(ws, { type: 'error', code: 'internal', message: '操作失败，请重新连接' }); })
        .finally(() => { ws.pending--; entry.queued--; });
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }, 25000);
  heartbeat.unref();

  return { server, room, rooms,
    address: () => server.address(),
    start: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(); });
    }),
    close: () => {
      if (closedPromise) return closedPromise;
      closing = true; clearInterval(heartbeat);
      importAPI.close();
      for (const ws of wss.clients) ws.terminate();
      closedPromise = (async () => {
        await importAPI.idle();
        await rooms.idle();
        await Promise.all([...rooms.entries.values()].map(entry => entry.queue));
        await exporter.close();
        await new Promise(resolve => wss.close(resolve));
        if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      })();
      return closedPromise;
    },
  };
}
