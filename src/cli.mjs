import { createApp } from './server.mjs';
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';

const port = Number(process.env.PORT || 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT 必须是 1 到 65535 之间的整数'); process.exit(1);
}
try {
  const app = await createApp({ port, onError: error => console.error('服务提示：', error.message) });
  await app.start();
  const pidFile = new URL('../data/server.pid', import.meta.url);
  await writeFile(pidFile, String(process.pid));
  const url = `http://127.0.0.1:${app.address().port}/#${app.room.key}`;
  console.log(`\n拼豆小屋已启动\n本机打开：${url}\n邀请手机或朋友：先启动内网穿透，再打开公网地址并粘贴同一个邀请密钥。\n按 Ctrl+C 关闭服务。\n`);
  if (process.argv.includes('--open')) {
    if (process.platform === 'win32') {
      spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Start-Process '${url}'`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); await unlink(pidFile).catch(()=>{}); process.exit(0); });
} catch (error) {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被使用。若拼豆服务已在运行，请打开原来的页面。` : error.message);
  process.exit(1);
}
