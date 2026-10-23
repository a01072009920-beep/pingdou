import { randomBytes } from 'node:crypto';
import { roomInfo } from './rooms.mjs';

const routes = new Set(['/api/rooms', '/api/rooms/join', '/api/rooms/invite']);
const fail = (status, message) => Object.assign(new Error(message), {status});

export function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try { const origin = new URL(req.headers.origin); return ['http:','https:'].includes(origin.protocol) && origin.host === req.headers.host; }
  catch { return false; }
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [], settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); chunks = [];
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(fail(408, '请求超时，请重试')), 5000);
    timer.unref();
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > 4096) {finish(fail(413, '提交内容过长'));return;}
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString());
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        finish(null, value);
      } catch { finish(fail(400, '提交格式无效')); }
    });
    req.on('error', () => finish(fail(400, '请求中断，请重试')));
    req.on('aborted', () => finish(fail(400, '请求中断，请重试')));
  });
}

export function createRoomAPI(rooms, onError) {
  // Browser sessions have separate budgets even behind the same tunnel proxy.
  // The global budget bounds callers that deliberately discard their cookie.
  const clients = new Map();
  let global = {since:Date.now(), all:0, creates:0};
  return async (req, res, path) => {
    if (!routes.has(path)) return false;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      if (req.method !== 'POST') throw fail(405, '请使用页面中的创建或加入入口');
      if (!sameOrigin(req)) throw fail(403, '请从当前网站提交操作');
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw fail(415, '提交格式无效');
      const now = Date.now();
      if (now - global.since > 60000) global = {since:now, all:0, creates:0};
      for (const [id, budget] of clients) if (now - budget.since > 60000) clients.delete(id);
      let id = /(?:^|;\s*)bead_client=([a-f0-9]{32})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      let budget = clients.get(id);
      if (!budget) {
        id = randomBytes(16).toString('hex');
        budget = {since:now, all:0, creates:0};
        res.setHeader('Set-Cookie', `bead_client=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=60`);
        if (clients.size < 1024) clients.set(id, budget);
      }
      const creating = path === '/api/rooms';
      if (++global.all > 300 || ++budget.all > 40 || (creating && (++global.creates > 30 || ++budget.creates > 5))) {
        res.setHeader('Retry-After', '60'); throw fail(429, '操作较频繁，请稍后再试');
      }
      const body = await readJSON(req);
      let entry;
      if (creating) entry = await rooms.create(body);
      else if (path.endsWith('/join')) entry = rooms.join(body.code);
      else entry = await rooms.setLegacyCode(req.headers.authorization?.replace(/^Bearer /, ''), body.code);
      res.writeHead(creating ? 201 : 200);
      res.end(JSON.stringify({key:entry.room.key, room:roomInfo(entry)}));
    } catch (error) {
      if (!error.status) onError(error);
      if (!res.destroyed) {
        res.writeHead(error.status || 500);
        res.end(JSON.stringify({code:error.code || 'request_failed', message:error.status ? error.message : '房间保存失败，请检查电脑存储空间后重试'}));
      }
    }
    return true;
  };
}
