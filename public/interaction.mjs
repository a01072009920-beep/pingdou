export function lineCells(start, end, width) {
  if (start === null || end === null) return [];
  let x = start % width, y = Math.floor(start / width);
  const tx = end % width, ty = Math.floor(end / width), dx = Math.abs(tx-x), dy = -Math.abs(ty-y);
  const sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
  let error = dx + dy;
  const result = [];
  while (true) {
    result.push(y * width + x);
    if (x === tx && y === ty) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
  return result;
}
export function stepCell(index, key, width, height) {
  const directions = { w:[0,-1], a:[-1,0], s:[0,1], d:[1,0] };
  if (!directions[key] || index === null) return null;
  const [dx,dy] = directions[key], x = index % width + dx, y = Math.floor(index / width) + dy;
  return x >= 0 && x < width && y >= 0 && y < height ? y*width+x : null;
}
export class TapGesture {
  points = new Map();
  suppressed = false;
  moved = false;
  down(id, x, y, index) {
    if (this.points.size === 0) { this.suppressed = false; this.moved = false; }
    this.points.set(id, { x, y, index });
    if (this.points.size > 1) this.suppressed = true;
  }
  move(id, x, y) {
    const point = this.points.get(id);
    if (point && Math.hypot(x - point.x, y - point.y) > 8) this.moved = true;
  }
  up(id, x, y, index) {
    this.move(id, x, y);
    const point = this.points.get(id);
    const result = point && this.points.size === 1 && !this.suppressed && !this.moved
      && point.index !== null && point.index === index ? index : null;
    this.points.delete(id);
    if (this.points.size === 0) { this.suppressed = false; this.moved = false; }
    return result;
  }
  cancel(id) {
    if (id === undefined) this.points.clear();
    else this.points.delete(id);
    this.suppressed = true;
    this.moved = false;
  }
}
