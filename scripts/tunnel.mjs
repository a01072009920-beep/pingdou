import { readFile, writeFile, mkdir, access, open, stat, unlink, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url), data = new URL('../data/', import.meta.url);
const exe = fileURLToPath(new URL('../tools/cloudflared.exe', import.meta.url));
const port = Number(process.env.PORT || 3210);
const lockFile = new URL('tunnel.lock', data), pidFile = new URL('tunnel.pid', data);
const cancellation = new AbortController();
const token = randomUUID();
let child, lock, recordedPid, downloadedFile, childFinished = false, finished, stopping = false;
let publishing = Promise.resolve();
function stop() {
  if (stopping) return;
  stopping = true;
  cancellation.abort();
  if (child && !childFinished) child.kill();
}
const checkCancelled = () => cancellation.signal.throwIfAborted();
const fetchSignal = timeout => AbortSignal.any([cancellation.signal, AbortSignal.timeout(timeout)]);
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, stop);
process.once('exit', stop);
try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 到 65535 之间的整数');
  await mkdir(data, {recursive:true});
  checkCancelled();
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('已有穿透程序正在运行，或上次退出留下了锁。请先关闭原穿透；确认已退出后，可运行“停止服务.cmd”清理陈旧锁再重试。');
  }
  // Keep this handle open for the entire run. The stop helper can exclusively
  // open and remove an orphaned lock only after its owning runner has exited.
  await lock.writeFile(JSON.stringify({pid:process.pid, token}));
  checkCancelled();
  const health = await fetch(`http://127.0.0.1:${port}/api/health`, {signal:fetchSignal(3000)});
  checkCancelled();
  if (!health.ok || (await health.json()).service !== 'bead-room') throw new Error('请先运行“启动拼豆.cmd”，再启动穿透。');
  const room = JSON.parse(await readFile(new URL('room.json', data), 'utf8'));
  checkCancelled();
  await mkdir(new URL('tools/', root), {recursive:true});
  try { await access(exe); }
  catch {
    checkCancelled();
    console.log('正在从 Cloudflare 官方 GitHub 下载 Windows 便携版…');
    const response = await fetch('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', {signal:fetchSignal(120000)});
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    const binary = Buffer.from(await response.arrayBuffer());
    checkCancelled();
    downloadedFile = fileURLToPath(new URL(`tools/cloudflared.${token}.download.exe`, root));
    await writeFile(downloadedFile, binary, {signal:cancellation.signal});
  }
  checkCancelled();
  const literal = (downloadedFile || exe).replaceAll("'", "''");
  execFileSync('powershell.exe', ['-NoProfile','-Command',
    `$s=Get-AuthenticodeSignature -LiteralPath '${literal}'; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Cloudflare'){exit 1}`], {windowsHide:true,stdio:'pipe'});
  checkCancelled();
  if (downloadedFile) await rename(downloadedFile, exe);
  let announced = false, ready = false, buffer = '';
  const announce = () => {
    if (!ready || stopping || childFinished || announced) return;
    const url = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (url) {
      announced = true;
      const invite = `${url[0]}/#${room.key}`;
      console.log(`\n手机和朋友使用这个完整链接：\n${invite}\n\n关闭穿透后链接失效，下次启动会生成新地址。\n`);
      publishing = writeFile(new URL('public-url.txt',data),invite).catch(error => console.error('邀请链接保存失败：', error.message));
      const browser = spawn('powershell.exe',['-NoProfile','-WindowStyle','Hidden','-Command',`Start-Process '${invite}'`],{windowsHide:true,stdio:'ignore',detached:true});
      browser.on('error', () => console.error('无法自动打开浏览器，请复制上方的完整邀请链接。'));
      browser.unref();
    }
  };
  const log = text => {
    const line = text.toString(); process.stdout.write(line);
    buffer = (buffer + line).slice(-12000);
    announce();
  };
  checkCancelled();
  console.log('正在建立临时公网通道，请保持本窗口打开。按 Ctrl+C 停止。');
  let finish;
  finished = new Promise(resolve => { finish = resolve; });
  const started = new Promise((resolve, reject) => {
    let spawned = false;
    child = spawn(exe, ['tunnel','--protocol','http2','--url',`http://127.0.0.1:${port}`], {windowsHide:true,stdio:['ignore','pipe','pipe']});
    // Register these synchronously, before waiting for any filesystem work.
    child.on('error', error => {
      reject(new Error(`无法启动穿透程序：${error.message}`, {cause:error}));
      if (!spawned) { childFinished = true; finish({error}); }
      else console.error('穿透程序提示：', error.message);
    });
    child.once('exit', (code, signal) => {
      childFinished = true;
      reject(new Error('穿透程序在完成启动前退出。'));
      finish({code, signal});
    });
    child.once('spawn', () => {
      spawned = true;
      if (!Number.isInteger(child.pid) || child.pid < 1) reject(new Error('无法启动穿透程序：没有获得有效的进程编号。'));
      else resolve();
    });
    child.stdout.on('data',log); child.stderr.on('data',log);
  });
  await started;
  checkCancelled();
  recordedPid = String(child.pid);
  await writeFile(pidFile, recordedPid, {signal:cancellation.signal});
  checkCancelled();
  ready = true; announce();
  const outcome = await finished;
  if (outcome.error) throw outcome.error;
  if (!stopping && outcome.code !== 0) throw new Error('穿透已停止。请检查网络后重试。');
} catch (error) {
  if (!stopping) {
    console.error(error.cause?.code === 'ECONNREFUSED' ? '请先运行“启动拼豆.cmd”，再启动穿透。' : error.message);
    process.exitCode = 1;
  }
} finally {
  if (child && !childFinished) { stop(); await finished; }
  await publishing;
  if (downloadedFile) await unlink(downloadedFile).catch(error => {
    if (error.code !== 'ENOENT') console.error('下载临时文件清理失败：', error.message);
  });
  if (lock) {
    try {
      const owned = await lock.stat({bigint:true}), current = await stat(lockFile, {bigint:true});
      // Do not remove another instance's replacement lock or its PID record.
      if (owned.dev === current.dev && owned.ino === current.ino) {
        // An interrupted write can leave an empty/partial PID. While this lock
        // is still ours, any PID write begun by this run must be cleaned up.
        if (recordedPid) await unlink(pidFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await unlink(lockFile);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('穿透锁清理失败，请确认退出后运行“停止服务.cmd”：', error.message);
    } finally { await lock.close(); }
  }
  for (const signal of ['SIGINT','SIGTERM','exit']) process.removeListener(signal, stop);
}
