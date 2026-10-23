import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

// Run the real entry's control flow with filesystem access confined to a fresh
// temporary project. No application data, network, shell or real child is used.
const source = (await fs.readFile(new URL('../scripts/tunnel.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', 'moduleUrl');
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) { if (await predicate()) return; await tick(); }
  assert.fail('isolated tunnel did not reach the expected lifecycle stage');
}
async function exists(path) { try { await fs.access(path); return true; } catch { return false; } }

async function project(t) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'bead-tunnel-'));
  await fs.mkdir(join(dir, 'data'));
  await fs.mkdir(join(dir, 'tools'));
  await fs.writeFile(join(dir, 'tools', 'cloudflared.exe'), 'synthetic executable; never run');
  const runs = [];
  t.after(async () => {
    for (const run of runs) {
      run.releaseAll();
      run.process.emit('SIGINT');
      for (const child of run.children) child.emit('exit', 0, null);
      await run.done;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, run: options => { const run = execute(dir, options); runs.push(run); return run; } };
}

function execute(dir, options = {}) {
  const children = [], errors = [], unhandled = [], fetches = [], pidWrites = [], browserCommands = [], signatures = [];
  const accessGate = deferred(), downloadGate = deferred();
  const process = new EventEmitter();
  process.env = { PORT: options.port || '3210' };
  process.pid = options.runnerPid || 9001;
  process.stdout = { write() {} };
  const result = { process, children, errors, unhandled, fetches, pidWrites, browserCommands, signatures,
    accessEntered: false, downloadEntered: false, settled: false,
    releaseAll() { accessGate.resolve(); downloadGate.resolve(); } };
  const context = { URL, Buffer, AbortSignal, AbortController, fileURLToPath, randomUUID,
    moduleUrl: pathToFileURL(join(dir, 'scripts', 'tunnel.mjs')).href,
    process, console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
    ...fs,
    readFile: (path, encoding) => String(path).endsWith('/room.json') || String(path).endsWith('\\room.json')
      ? Promise.resolve(JSON.stringify({ key: 'a'.repeat(48) })) : fs.readFile(path, encoding),
    access: async path => {
      result.accessEntered = true;
      if (options.pauseAccess) await accessGate.promise;
      if (options.download) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return fs.access(path);
    },
    writeFile: async (path, text, settings) => {
      if (options.pidWriteError && String(path).endsWith('tunnel.pid')) {
        await fs.writeFile(path, '');
        throw Object.assign(new Error('synthetic PID write EIO'), { code: 'EIO' });
      }
      if (options.downloadWriteError && /cloudflared.*\.exe$/.test(String(path))) {
        await fs.writeFile(path, 'partial download');
        throw Object.assign(new Error('synthetic download write EIO'), { code: 'EIO' });
      }
      await fs.writeFile(path, text, settings);
      // Observers use this as a completion signal, not a write-start signal.
      if (String(path).endsWith('tunnel.pid')) pidWrites.push(String(text));
    },
    fetch: async (url, settings) => {
      fetches.push({ url, signal: settings.signal });
      if (url.includes('github.com')) {
        result.downloadEntered = true;
        if (options.pauseDownload) await downloadGate.promise;
        return { ok: true, arrayBuffer: async () => Buffer.from('download fixture') };
      }
      return { ok: true, json: async () => ({ service: 'bead-room' }) };
    },
    execFileSync: (...args) => { signatures.push(args); return Buffer.alloc(0); },
    spawn: (command, args) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.unref = () => child;
      if (command === 'powershell.exe') { browserCommands.push(args); return child; }
      child.pid = options.spawnError ? undefined : (options.childPid || 9101);
      child.args = args;
      child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('exit', 0, 'SIGTERM')); return true; };
      children.push(child);
      if (options.spawnError) queueMicrotask(() => {
        try { child.emit('error', Object.assign(new Error('synthetic permission denied'), { code: 'EACCES' })); }
        catch (error) { unhandled.push(error); }
      });
      else if (!options.manualSpawn) queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  };
  result.done = vm.runInNewContext(`(async () => {\n${source}\n})()`, context).finally(() => { result.settled = true; });
  return result;
}

test('Ctrl+C during preflight never creates a tunnel later', async t => {
  const app = await project(t), run = app.run({ pauseAccess: true });
  await until(() => run.accessEntered);
  run.process.emit('SIGINT'); run.releaseAll();
  await until(() => run.settled || run.children.length);
  assert.equal(run.children.length, 0);
});

test('Ctrl+C aborts the active download and prevents executable replacement or spawn', async t => {
  const app = await project(t), run = app.run({ download: true, pauseDownload: true });
  await until(() => run.downloadEntered);
  run.process.emit('SIGINT');
  assert.equal(run.fetches[1].signal.aborted, true);
  run.releaseAll(); await until(() => run.settled || run.children.length);
  assert.equal(run.children.length, 0);
  assert.equal(await fs.readFile(join(app.dir, 'tools', 'cloudflared.exe'), 'utf8'), 'synthetic executable; never run');
});

test('a rejected child spawn is handled immediately and leaves no PID record', async t => {
  const app = await project(t), run = app.run({ spawnError: true });
  await until(() => run.settled);
  assert.equal(run.unhandled.length, 0);
  assert.deepEqual(run.pidWrites, []);
  assert.equal(await exists(join(app.dir, 'data', 'tunnel.pid')), false);
  assert.match(run.errors.join('\n'), /启动.*穿透|穿透.*启动/);
  assert.equal(await exists(join(app.dir, 'data', 'tunnel.lock')), false);
});

test('a PID is recorded only after the child confirms spawn', async t => {
  const app = await project(t), run = app.run({ manualSpawn: true });
  await until(() => run.children.length === 1);
  assert.deepEqual(run.pidWrites, []);
  run.children[0].emit('spawn');
  await until(() => run.pidWrites.length === 1);
  assert.deepEqual(run.pidWrites, ['9101']);
});

test('a partial PID write failure kills its child and removes the invalid record', async t => {
  const app = await project(t), run = app.run({ pidWriteError: true });
  await until(() => run.settled);
  assert.equal(run.children[0].killed, true);
  assert.equal(await exists(join(app.dir, 'data', 'tunnel.pid')), false);
  assert.equal(await exists(join(app.dir, 'data', 'tunnel.lock')), false);
  assert.match(run.errors.join('\n'), /EIO/);
});

test('an interrupted executable write leaves no installed or temporary binary and can retry', async t => {
  const app = await project(t), exe = join(app.dir, 'tools', 'cloudflared.exe');
  await fs.unlink(exe);
  const failed = app.run({ download: true, downloadWriteError: true });
  await until(() => failed.settled);
  assert.equal(failed.children.length, 0);
  assert.equal(await exists(exe), false);
  assert.deepEqual(await fs.readdir(join(app.dir, 'tools')), []);
  assert.equal(await exists(join(app.dir, 'data', 'tunnel.lock')), false);
  const retry = app.run({ download: true });
  await until(() => retry.pidWrites.length === 1);
  assert.equal(await fs.readFile(exe, 'utf8'), 'download fixture');
  assert.deepEqual(await fs.readdir(join(app.dir, 'tools')), ['cloudflared.exe']);
  assert.match(retry.signatures[0][1].join(' '), /cloudflared.*download\.exe/);
});

test('concurrent starts share an exclusive lock and cannot replace the first PID or URL', async t => {
  const app = await project(t), first = app.run({ childPid: 9101 });
  await until(() => first.pidWrites.length === 1);
  await until(() => first.children[0].stderr.listenerCount('data') === 1);
  first.children[0].stderr.emit('data', Buffer.from('https://first-room.trycloudflare.com'));
  const urlFile = join(app.dir, 'data', 'public-url.txt');
  await until(() => exists(urlFile));
  const second = app.run({ childPid: 9102, runnerPid: 9002 });
  await until(() => second.settled || second.children.length);
  assert.equal(second.children.length, 0);
  assert.equal(await fs.readFile(join(app.dir, 'data', 'tunnel.pid'), 'utf8'), '9101');
  assert.equal(await fs.readFile(urlFile, 'utf8'), 'https://first-room.trycloudflare.com/');
  assert.match(second.errors.join('\n'), /已经|已有|运行|锁/);
});

test('normal child exit releases its lock and PID so the next run can start', async t => {
  const app = await project(t), first = app.run();
  await until(() => first.pidWrites.length === 1);
  assert.equal(await exists(join(app.dir, 'data', 'tunnel.lock')), true);
  first.children[0].emit('exit', 0, null); await first.done;
  assert.equal(await exists(join(app.dir, 'data', 'tunnel.lock')), false);
  assert.equal(await exists(join(app.dir, 'data', 'tunnel.pid')), false);
  const second = app.run({ childPid: 9102 });
  await until(() => second.children.length === 1);
});

test('an existing stale or unknown lock is preserved rather than guessed away', async t => {
  const app = await project(t), lock = join(app.dir, 'data', 'tunnel.lock');
  await fs.writeFile(lock, 'unknown previous owner');
  const run = app.run(); await until(() => run.settled || run.children.length);
  assert.equal(run.children.length, 0);
  assert.equal(await fs.readFile(lock, 'utf8'), 'unknown previous owner');
  assert.match(run.errors.join('\n'), /停止|清理/);
});

test('simultaneous starters can create only one channel', async t => {
  const app = await project(t);
  const first = app.run({ childPid: 9201 }), second = app.run({ childPid: 9202, runnerPid: 9002 });
  await until(() => first.children.length + second.children.length === 1 && (first.settled || second.settled));
  const winner = first.children.length ? first : second;
  await until(() => winner.pidWrites.length === 1);
  assert.equal(first.children.length + second.children.length, 1);
  assert.equal(await fs.readFile(join(app.dir, 'data', 'tunnel.pid'), 'utf8'), String(winner.children[0].pid));
});

test('cleanup never deletes a replacement lock or another owner PID', async t => {
  const app = await project(t), run = app.run();
  await until(() => run.pidWrites.length === 1);
  const lock = join(app.dir, 'data', 'tunnel.lock');
  await fs.unlink(lock);
  await fs.writeFile(lock, 'replacement owner');
  await fs.writeFile(join(app.dir, 'data', 'tunnel.pid'), '9999');
  run.children[0].emit('exit', 0, null); await run.done;
  assert.equal(await fs.readFile(lock, 'utf8'), 'replacement owner');
  assert.equal(await fs.readFile(join(app.dir, 'data', 'tunnel.pid'), 'utf8'), '9999');
});

test('late logs from an exited channel cannot overwrite the next channel invitation', async t => {
  const app = await project(t), first = app.run();
  await until(() => first.pidWrites.length === 1);
  first.children[0].emit('exit', 0, null); await first.done;
  const second = app.run({ childPid: 9202 });
  await until(() => second.pidWrites.length === 1);
  second.children[0].stdout.emit('data', Buffer.from('https://current-room.trycloudflare.com'));
  const urlFile = join(app.dir, 'data', 'public-url.txt');
  await until(() => exists(urlFile));
  first.children[0].stderr.emit('data', Buffer.from('https://expired-room.trycloudflare.com'));
  await tick();
  assert.equal(await fs.readFile(urlFile, 'utf8'), 'https://current-room.trycloudflare.com/');
});

test('custom PORT, signed Windows binary and a split complete invitation still work', async t => {
  const app = await project(t), run = app.run({ port: '4321' });
  await until(() => run.pidWrites.length === 1);
  await until(() => run.children[0].stderr.listenerCount('data') === 1);
  assert.equal(run.fetches[0].url, 'http://127.0.0.1:4321/api/health');
  assert.deepEqual(Array.from(run.children[0].args), ['tunnel', '--protocol', 'http2', '--url', 'http://127.0.0.1:4321']);
  assert.equal(run.signatures[0][0], 'powershell.exe');
  assert.match(run.signatures[0][1].join(' '), /Get-AuthenticodeSignature.*Cloudflare/);
  run.children[0].stdout.emit('data', Buffer.from('https://share-test.trycloud'));
  run.children[0].stderr.emit('data', Buffer.from('flare.com\n'));
  const inviteFile = join(app.dir, 'data', 'public-url.txt');
  await until(() => exists(inviteFile));
  assert.equal(await fs.readFile(inviteFile, 'utf8'), 'https://share-test.trycloudflare.com/');
  assert.equal(run.browserCommands.length, 1);
});
