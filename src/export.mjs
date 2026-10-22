import { Worker } from 'node:worker_threads';

export class ExportManager {
  #worker = null;
  render(board) {
    if (this.#worker) return Promise.reject(Object.assign(new Error('正在生成图片，请稍后重试'), { code: 'export_busy' }));
    const worker = new Worker(new URL('./png-worker.mjs', import.meta.url), { workerData: board });
    this.#worker = worker;
    return new Promise((resolve, reject) => {
      let png, error;
      worker.once('message', bytes => { png = Buffer.from(bytes); });
      worker.once('error', cause => { error = cause; });
      worker.once('exit', code => {
        this.#worker = null;
        if (error || code !== 0 || !png) reject(error || new Error('图片生成未完成，请重试'));
        else resolve(png);
      });
    });
  }
  async close() { if (this.#worker) await this.#worker.terminate(); }
}
