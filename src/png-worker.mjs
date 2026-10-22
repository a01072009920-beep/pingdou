import { parentPort, workerData as board } from 'node:worker_threads';
import { deflate, crc32 } from 'node:zlib';

const cols = board.width ?? board.size, rows = board.height ?? board.size;
const width = 4096, scale = width / Math.max(cols, rows), stride = width * 3 + 1;
const raw = Buffer.alloc(width * stride);
const colors = board.palette.map(({ hex }) => Buffer.from(hex.slice(1), 'hex'));
const white = Buffer.from([255, 255, 255]);
const left = (width - cols * scale) / 2, top = (width - rows * scale) / 2;
for (let py = 0; py < width; py++) {
  const row = Buffer.alloc(width * 3, 255);
  const y = Math.floor((py + .5 - top) / scale);
  if (y >= 0 && y < rows) for (let px = 0; px < width; px++) {
    const x = Math.floor((px + .5 - left) / scale);
    if (x < 0 || x >= cols) continue;
    const color = board.cells[y * cols + x].color;
    (color === null ? white : colors[color]).copy(row, px * 3);
  }
  row.copy(raw, py * stride + 1);
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4);
  out.writeUInt32BE(crc32(body), out.length - 4);
  return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(width, 4);
ihdr[8] = 8; ihdr[9] = 2;
deflate(raw, { level: 6 }, (error, compressed) => {
  if (error) throw error;
  const png = Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0)),
  ]);
  parentPort.postMessage(png);
});
