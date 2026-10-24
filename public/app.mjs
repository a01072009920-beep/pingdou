import { TapGesture, lineCells, stepCell } from './interaction.mjs';
import { beginSync, acceptSnapshot, canExport } from './sync-state.mjs';
import { COLOR_GROUPS, paletteEntries } from './palette.mjs';
import { createRoomUI } from './rooms.mjs';
import { initWorkspace } from './workspace.mjs';
import { createConverter } from './converter-ui.mjs';
import { createColorBox } from './color-box.mjs';
import { openSheetExport } from './pattern-sheet.mjs';
import { hasGuide, guideCode, guidePattern } from './pattern-guide.mjs';
import { contrastText } from './color-science.mjs';

const $ = id => document.getElementById(id);
const canvas = $('board'), container = $('canvas-container'), ctx = canvas.getContext('2d');
const state = { board: null, ready: false, tool: 'place', color: null, socket: null, online: 0,
  pending: new Map(), grid: true, hover: null, keyboardCell: null, exporting: false, roomId:null, reference:null };
const view = { width: 0, height: 0, zoom: .5, x: 0, y: 0, fit: true };
const cols = () => state.board?.width ?? state.board?.size ?? 64;
const rows = () => state.board?.height ?? state.board?.size ?? 64;
const gesture = new TapGesture(), pointers = new Map();
let key = '', reconnectTimer, retry = 0, toastTimer, frame, downloadUrl;
let converterUI=null, colorBoxUI=null;

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3800);
}
function connection(label, ready = false) {
  $('connection-text').textContent = label;
  $('connection-dot').classList.toggle('online', ready);
  $('offline-veil').hidden = ready;
  $('offline-label').textContent = label === '正在重连' ? '连接中断，正在重新连接…' : '正在连接拼豆小屋…';
  controls();
}
function clearPending() {
  for (const pending of state.pending.values()) clearTimeout(pending.timer);
  state.pending.clear();
}
function controls() {
  const importing=converterUI?.isBusy() === true;
  $('export-button').disabled = !canExport(state) || paintQueue.size > 0 || importing;
  $('sheet-export').disabled = !canExport(state) || paintQueue.size > 0 || importing;
  $('image-convert').disabled = !state.ready || importing;
  $('invite-button').disabled = !state.ready;
  $('room-button').disabled = !canSwitchRoom();
  for (const id of ['canvas-new','canvas-expand','canvas-clear','canvas-select']) $(id).disabled = !state.ready || state.pending.size > 0 || paintQueue.size > 0 || importing;
  const status = $('save-status');
  status.textContent = !state.ready ? '尚未连接' : state.pending.size || paintQueue.size ? '正在保存…' : '已保存';
  status.classList.toggle('saved', state.ready && !state.pending.size && !paintQueue.size);
}
function refreshBoardInfo() {
  if (!state.board) return;
  document.querySelector('.size-label').textContent = `${cols()} × ${rows()}`;
  $('cell-capacity').textContent = (cols()*rows()).toLocaleString();
  canvas.setAttribute('aria-rowcount', rows()); canvas.setAttribute('aria-colcount', cols());
  const count = state.board.cells.reduce((n, cell) => n + (cell.color !== null ? 1 : 0), 0);
  $('bead-count').textContent = count.toLocaleString('en-US');
  $('empty-hint').hidden = count > 0 || !state.ready || hasGuide(state.reference);
  $('board-version').textContent = hasGuide(state.reference) ? `待拼图纸 · 已放 ${count.toLocaleString()} 颗` : `作品 ${String(state.board.revision).padStart(4, '0')}`;
  coordinates(state.keyboardCell ?? state.hover);
  $('presence-text').textContent = state.online > 1 ? `${state.online} 人在一起拼豆` : '一个人，也可以开始';
  colorBoxUI?.update({roomId:state.roomId,canvasId:state.canvasId,palette:state.board.palette,cells:state.board.cells,reference:state.reference});
  connection(state.online > 1 ? `${state.online} 人在线` : '已连接', state.ready);
  controls(); scheduleDraw();
}
function finishRequest(id) {
  const pending = state.pending.get(id);
  if (pending) { clearTimeout(pending.timer); state.pending.delete(id); }
}
function requestSync() {
  if (state.socket?.readyState !== WebSocket.OPEN) return;
  beginSync(state); controls();
  state.socket.send(JSON.stringify({ type: 'sync' }));
}
function connect() {
  clearTimeout(reconnectTimer); clearPending();
  const previous = state.socket;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  state.socket = ws; state.ready = false;
  if (previous) previous.close();
  connection(retry ? '正在重连' : '连接中');
  let denied = false;
  ws.addEventListener('open', () => { if (state.socket === ws) ws.send(JSON.stringify({ type: 'auth', key })); });
  ws.addEventListener('message', event => {
    if (state.socket !== ws) return;
    let message;
    try { message = JSON.parse(event.data); } catch { requestSync(); return; }
    if (message.type === 'snapshot') {
      const changed = state.canvasId !== message.canvasId || state.epoch !== message.epoch;
      if (changed) { stopStroke(); clearPending(); state.hover=null; state.keyboardCell=null; }
      finishRequest(message.requestId);
      acceptSnapshot(state, message); retry = 0;
      roomUI.update(message.room);
      state.roomId=message.room?.id ?? state.roomId;
      state.reference=message.reference ?? null;
      state.canvasId=message.canvasId; state.epoch=message.epoch;
      $('canvas-select').replaceChildren(...message.canvases.map(c => { const o=document.createElement('option'); o.value=c.id; o.textContent=`${c.name} (${c.width}×${c.height})`; return o; }));
      $('canvas-select').value=state.canvasId;
      if (changed) fitBoard();
      buildPalette(); refreshBoardInfo(); return;
    }
    if (message.type === 'presence') { state.online = message.online; refreshBoardInfo(); return; }
    if (message.type === 'patch') {
      finishRequest(message.requestId);
      if (message.canvasId !== state.canvasId || message.epoch !== state.epoch) return;
      if (!state.board || !state.ready) return;
      if (message.revision > state.board.revision + 1) { requestSync(); return; }
      if (message.revision === state.board.revision + 1) {
        state.board.cells[message.index] = message.cell; state.board.revision = message.revision;
      }
      refreshBoardInfo(); return;
    }
    if (message.type === 'rejected' || message.type === 'unchanged') {
      finishRequest(message.requestId);
      if (state.board && message.revision > state.board.revision) requestSync();
      if (message.type === 'rejected') {
        if (message.code === 'stale_canvas') { stopStroke(); requestSync(); }
        const reasons = { stale_canvas: '画布已变化，已停止操作并同步最新画布', occupied: '先擦除这颗豆，再放入新颜色', stale: '这个格子刚刚变化了，请重新点击',
          save_failed: '电脑上的保存失败，这次修改未生效。请检查存储空间后重试', busy: '操作正在保存，请稍后再点', invalid: '这次操作无效，请重新选择格子' };
        toast(reasons[message.code] || '操作未完成，请重试');
      }
      controls(); scheduleDraw(); return;
    }
    if (message.type === 'error') {
      if (message.code === 'unauthorized') {
        denied = true; key = ''; state.ready = false; stopStroke(); clearPending();
        roomUI.unauthorized('房间凭据已失效，请输入邀请码重新加入');
      } else { toast(message.message || '连接需要恢复，请稍候'); requestSync(); }
      controls();
    }
  });
  ws.addEventListener('close', () => {
    if (state.socket !== ws) return;
    state.ready = false; stopStroke(); clearPending(); $('empty-hint').hidden = true;
    connection(denied ? '请选择房间' : '正在重连'); scheduleDraw();
    if (!denied) reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
  });
  ws.addEventListener('error', () => {});
}

function buildPalette() {
  if (!state.board) return;
  if (state.color === null || !state.board.palette[state.color] || state.board.palette[state.color].legacy) {
    state.color = state.board.palette.findIndex(color => color.code === 'F4');
  }
  $('palette').replaceChildren();
  const entries = paletteEntries(state.board.palette, $('palette-group').value, $('palette-search').value);
  entries.forEach(({color, index}) => {
    const button = document.createElement('button');
    button.className = 'color-button'; button.type = 'button';
    button.dataset.index = index;
    button.style.setProperty('--color', color.hex);
    button.title = `${color.code} · ${color.name} · ${color.hex}`; button.setAttribute('aria-label', `${color.code}，${color.name}，${color.hex}`);
    button.setAttribute('aria-pressed', 'false');
    const bead = document.createElement('span'); bead.className = 'palette-bead'; bead.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'color-code'; label.textContent = color.code;
    button.append(bead, label); button.addEventListener('click', () => { state.color = index; setTool('place'); });
    $('palette').append(button);
  });
  $('palette-count').textContent = `${entries.length} / 291 色 · 按色号排列`;
  $('palette-empty').hidden = entries.length > 0;
  setTool(state.tool);
}
for (const [group, name] of COLOR_GROUPS) {
  const option = document.createElement('option'); option.value = group;
  option.textContent = name.startsWith(group) ? name : `${group} · ${name}`;
  $('palette-group').append(option);
}
$('palette-group').addEventListener('change', () => { buildPalette(); document.querySelector('.palette-scroll').scrollTop = 0; });
$('palette-search').addEventListener('input', () => { buildPalette(); document.querySelector('.palette-scroll').scrollTop = 0; });
function setTool(tool) {
  stopStroke(false); state.tool = tool;
  for (const name of ['place', 'erase', 'move']) {
    $(`${name}-tool`).classList.toggle('selected', name === tool);
    $(`${name}-tool`).setAttribute('aria-pressed', String(name === tool));
  }
  if (state.board) {
    const color = state.board.palette[state.color];
    $('color-name').textContent = color.code; $('color-hex').textContent = color.hex;
    $('current-bead').style.borderColor = color.hex;
    [...$('palette').children].forEach(button => {
      button.classList.toggle('selected', Number(button.dataset.index) === state.color);
      button.setAttribute('aria-pressed', String(Number(button.dataset.index) === state.color));
    });
  }
  scheduleDraw();
}

function operate(index, quiet = false, action = state.tool, color = state.color) {
  if (converterUI?.isBusy()) return;
  if (action === 'move' || index === null || !state.board?.cells[index]) return;
  if (!state.ready || !state.board) { toast('连接恢复后再继续拼豆'); return; }
  if ([...state.pending.values()].some(p => p.index === index)) return;
  const cell = state.board.cells[index];
  if (action === 'place' && cell.color !== null) { if (!quiet) toast('先擦除这颗豆，再放入新颜色'); return; }
  if (action === 'erase' && cell.color === null) return;
  const requestId = crypto.randomUUID();
  const timer = setTimeout(() => {
    if (!state.pending.has(requestId)) return;
    toast('同步较慢，正在重新连接并检查保存结果');
    state.socket?.close();
  }, 10000);
  state.pending.set(requestId, { index, timer });
  state.socket.send(JSON.stringify({ type: 'op', requestId, canvasId:state.canvasId, epoch:state.epoch, action, index,
    color, expectedRevision: cell.revision }));
  controls(); scheduleDraw();
}

function scheduleDraw() { if (!frame) frame = requestAnimationFrame(() => { frame = null; draw(); }); }
function point(event) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
function hit(x, y) {
  const step = 16 * view.zoom;
  const col = Math.floor((x - view.x) / step), row = Math.floor((y - view.y) / step);
  return col >= 0 && row >= 0 && col < cols() && row < rows() ? row * cols() + col : null;
}
function coordinates(index) {
  const target=guideCode(state.reference,index,cols());
  $('coordinate-label').textContent = index === null ? (hasGuide(state.reference)?'照图放豆 · 放大看色号':'每一个小格，都有可能')
    : `第 ${Math.floor(index / cols()) + 1} 行 · 第 ${index % cols() + 1} 列${target?` · 图纸 ${target}`:''}`;
}
function fitBoard() {
  // Leave room for the left/top rulers, without wasting the same space on every edge.
  const availableWidth = view.width - 32 - 12, availableHeight = view.height - 24 - 12;
  if (availableWidth <= 0 || availableHeight <= 0) return;
  view.zoom = Math.min(availableWidth / (cols()*16), availableHeight / (rows()*16), 4);
  view.x = 32 + (availableWidth - cols()*16 * view.zoom) / 2;
  view.y = 24 + (availableHeight - rows()*16 * view.zoom) / 2;
  view.fit = true; scheduleDraw();
}
function zoomAt(x, y, factor) {
  const next = Math.max(.01, Math.min(4, view.zoom * factor)), ratio = next / view.zoom;
  view.x = x - (x - view.x) * ratio; view.y = y - (y - view.y) * ratio;
  view.zoom = next; view.fit = false; scheduleDraw();
}
function resize() {
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(rect.width * dpr), pixelHeight = Math.round(rect.height * dpr);
  if (view.width === rect.width && view.height === rect.height
      && canvas.width === pixelWidth && canvas.height === pixelHeight) return;
  if (!view.fit) {
    view.x += (rect.width - view.width) / 2;
    view.y += (rect.height - view.height) / 2;
  }
  view.width = rect.width; view.height = rect.height;
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  if (view.fit) fitBoard(); else scheduleDraw();
}
function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
function draw() {
  const dpr = Math.min(devicePixelRatio || 1, 2), step = view.zoom * 16, side = step * cols(), tall = step * rows();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, view.width, view.height);
  ctx.save(); ctx.shadowColor = '#49627b16'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#fafcff'; ctx.fillRect(view.x, view.y, side, tall); ctx.restore();
  ctx.strokeStyle = '#cad7e4'; ctx.lineWidth = 1; ctx.strokeRect(view.x-.5, view.y-.5, side+1, tall+1);
  const x0 = Math.max(0, Math.floor(-view.x / step)), x1 = Math.min(cols(), Math.ceil((view.width - view.x) / step));
  const y0 = Math.max(0, Math.floor(-view.y / step)), y1 = Math.min(rows(), Math.ceil((view.height - view.y) / step));
  if(hasGuide(state.reference)) {
    const colors=new Map(state.board.palette.map(color=>[color.code,{hex:color.hex,ink:contrastText(color.hex)}]));
    ctx.textAlign='center';ctx.textBaseline='middle';
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++) {
      const index=y*cols()+x,code=guideCode(state.reference,index,cols()),color=colors.get(code);
      if(!color || state.board.cells[index].color!==null)continue;
      const left=view.x+x*step,top=view.y+y*step;
      ctx.fillStyle=color.hex;ctx.fillRect(left,top,step,step);
      const font=Math.min(12,step*.4,(step-3)/Math.max(1,code.length*.62));
      if(font>=6){ctx.fillStyle=color.ink;ctx.font=`600 ${font}px sans-serif`;ctx.fillText(code,left+step/2,top+step/2,step-3);}
    }
  }
  if (state.grid && step >= 6) {
    ctx.lineWidth = .6;
    for (let x=x0; x<=x1; x++) { ctx.strokeStyle = x%8===0 ? '#cbd9e366' : '#dce5ec60'; ctx.beginPath(); ctx.moveTo(view.x+x*step, Math.max(0,view.y)); ctx.lineTo(view.x+x*step, Math.min(view.height,view.y+tall)); ctx.stroke(); }
    for (let y=y0; y<=y1; y++) { ctx.strokeStyle = y%8===0 ? '#cbd9e366' : '#dce5ec60'; ctx.beginPath(); ctx.moveTo(Math.max(0,view.x), view.y+y*step); ctx.lineTo(Math.min(view.width,view.x+side), view.y+y*step); ctx.stroke(); }
  }
  for (let y=y0; y<y1; y++) for (let x=x0; x<x1; x++) {
    const index = y*cols()+x, cell = state.board?.cells[index], cx = view.x+(x+.5)*step, cy=view.y+(y+.5)*step;
    if (cell?.color !== null && cell?.color !== undefined) {
      circle(cx, cy, step*.405, state.board.palette[cell.color].hex);
      if (state.board.palette[cell.color].hex.toUpperCase() === '#FFFFFF') { ctx.strokeStyle = '#d6e0e9'; ctx.lineWidth=.7; ctx.stroke(); }
      circle(cx, cy, step*.128, '#fafcff');
    } else if (step >= 5 && !guideCode(state.reference,index,cols())) circle(cx,cy, Math.max(.65, step*.075), '#d7e1e9');
  }
  ctx.font='10px sans-serif'; ctx.fillStyle='#516a82'; ctx.textAlign='center'; ctx.textBaseline='middle';
  const every=Math.max(1,Math.ceil(28/step));
  for(let x=x0;x<x1;x++) if(x%every===0) ctx.fillText(String(x+1),view.x+(x+.5)*step,Math.max(10,view.y-12));
  for(let y=y0;y<y1;y++) if(y%every===0) ctx.fillText(String(y+1),Math.max(13,view.x-19),view.y+(y+.5)*step);
  const highlighted = state.keyboardCell ?? state.hover;
  if (highlighted !== null) {
    const x=view.x+(highlighted%cols())*step, y=view.y+Math.floor(highlighted/cols())*step;
    ctx.fillStyle = state.tool === 'erase' ? '#f2796920' : '#3668c915'; ctx.fillRect(x,y,step,step);
    ctx.strokeStyle = state.tool === 'erase' ? '#d37b74' : '#5d83c5'; ctx.lineWidth=1.3; ctx.strokeRect(x+.5,y+.5,step-1,step-1);
  }
  ctx.strokeStyle='#7696c8'; ctx.lineWidth=1.5; ctx.setLineDash([3,2]);
  for (const { index } of state.pending.values()) if(Number.isInteger(index)) ctx.strokeRect(view.x+(index%cols())*step+1,view.y+Math.floor(index/cols())*step+1,step-2,step-2);
  ctx.setLineDash([]); $('zoom-value').textContent = `${Math.round(view.zoom * 100)}%`;
}

let mouseHeld=false, directionKey=null, repeatTimer=null, strokeIndex=null, touchLast=null, strokeUsed=false;
const paintQueue=new Map();
function stopStroke(clearQueued = true) {
  mouseHeld=false; directionKey=null; strokeIndex=null; touchLast=null; strokeUsed=false;
  clearInterval(repeatTimer); repeatTimer=null; if (clearQueued) paintQueue.clear();
  pointers.clear(); gesture.cancel(); canvas.classList.remove('panning');
  controls();
}
function enqueue(index) {
  if(index!==null && state.ready && state.tool!=='move' && !converterUI?.isBusy()) {
    paintQueue.set(`${state.tool}:${state.color}:${index}`, {index, action:state.tool, color:state.color});
    controls();
  }
}
setInterval(()=>{
  if(!state.ready || document.hidden) {paintQueue.clear();return;}
  if(state.pending.size>=8) return;
  const next=paintQueue.entries().next();
  if(!next.done) {
    const [key,op]=next.value;
    if ([...state.pending.values()].some(p=>p.index===op.index)) return;
    paintQueue.delete(key); operate(op.index,true,op.action,op.color); controls();
  }
},50);
function advanceStroke() {
  if(!mouseHeld || !directionKey || strokeIndex===null || state.tool!=='place' || converterUI?.isBusy() || document.querySelector('dialog[open]')) return;
  if(state.pending.size>=8 || paintQueue.size>2) return;
  const next=stepCell(strokeIndex,directionKey,cols(),rows());
  if(next===null) return;
  strokeIndex=next; state.keyboardCell=next; enqueue(next); coordinates(next); scheduleDraw();
}
canvas.addEventListener('pointerdown', event => {
  if (converterUI?.isBusy() || document.querySelector('dialog[open]')) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const p=point(event), index=hit(p.x,p.y);
  pointers.set(event.pointerId,p); gesture.down(event.pointerId,p.x,p.y,index);
  state.keyboardCell=null; strokeUsed=false;
  if(event.pointerType==='mouse') {mouseHeld=true;strokeIndex=index;}
  else {touchLast=index;if(pointers.size>1) {touchLast=null;paintQueue.clear();}}
  canvas.setPointerCapture(event.pointerId); canvas.focus({preventScroll:true});
});
canvas.addEventListener('pointermove', event => {
  const p=point(event), previous=pointers.get(event.pointerId), index=hit(p.x,p.y);
  state.hover=index; coordinates(index); gesture.move(event.pointerId,p.x,p.y);
  if(previous) {
    const old=[...pointers.values()]; pointers.set(event.pointerId,p);const now=[...pointers.values()];
    if(now.length>=2 && old.length>=2) {
      const dist=a=>Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);
      const center=a=>({x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2});
      const before=center(old), after=center(now), oldDistance=dist(old);
      if(oldDistance>0) zoomAt(before.x,before.y,dist(now)/oldDistance);
      view.x+=after.x-before.x;view.y+=after.y-before.y;touchLast=null;
    } else if(!gesture.suppressed && event.pointerType!=='mouse' && state.tool!=='move') {
      if(gesture.moved) {for(const cell of lineCells(touchLast ?? index,index,cols())) enqueue(cell);strokeUsed=true;}
      touchLast=index;
    } else if(!directionKey && !strokeUsed && (gesture.moved || gesture.suppressed)) {
      view.x+=p.x-previous.x;view.y+=p.y-previous.y;view.fit=false;canvas.classList.add('panning');
    }
  }
  scheduleDraw();
});
canvas.addEventListener('pointerup', event => {
  const p=point(event), index=gesture.up(event.pointerId,p.x,p.y,hit(p.x,p.y));
  pointers.delete(event.pointerId);canvas.classList.remove('panning');
  if(event.pointerType==='mouse') {mouseHeld=false;directionKey=null;clearInterval(repeatTimer);repeatTimer=null;paintQueue.clear();controls();}
  else touchLast=null;
  if(index!==null && !strokeUsed) operate(index);
  controls();
});
canvas.addEventListener('pointercancel',()=>stopStroke());
canvas.addEventListener('lostpointercapture',event=>{if(pointers.has(event.pointerId)) stopStroke();});
window.addEventListener('blur',stopStroke);
document.addEventListener('visibilitychange',()=>{if(document.hidden) stopStroke();});
document.addEventListener('keydown',event=>{
  const key=event.key.toLowerCase();
  if(!mouseHeld || state.tool!=='place' || !['w','a','s','d'].includes(key) || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  if(directionKey===key) return;
  directionKey=key;strokeUsed=true;enqueue(strokeIndex);advanceStroke();
  clearInterval(repeatTimer);repeatTimer=setInterval(advanceStroke,100);
});
document.addEventListener('keyup',event=>{
  if(event.key.toLowerCase()===directionKey) {directionKey=null;clearInterval(repeatTimer);repeatTimer=null;paintQueue.clear();controls();}
});
canvas.addEventListener('pointerleave', () => { state.hover=null; coordinates(null); scheduleDraw(); });
canvas.addEventListener('wheel', event => { event.preventDefault(); const p=point(event); zoomAt(p.x,p.y,Math.exp(-event.deltaY*.0015)); }, {passive:false});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('keydown', event => {
  if (converterUI?.isBusy() || document.querySelector('dialog[open]')) return;
  const direction={ArrowLeft:'a',ArrowRight:'d',ArrowUp:'w',ArrowDown:'s'}[event.key];
  const offset=direction;
  if (offset !== undefined) {
    event.preventDefault(); state.keyboardCell=stepCell(state.keyboardCell ?? state.hover ?? 0,direction,cols(),rows()) ?? state.keyboardCell ?? state.hover ?? 0;
    const x=view.x+(state.keyboardCell%cols()+.5)*16*view.zoom, y=view.y+(Math.floor(state.keyboardCell/cols())+.5)*16*view.zoom;
    if (x<20 || x>view.width-20) view.x+=view.width/2-x;
    if (y<20 || y>view.height-20) view.y+=view.height/2-y;
    coordinates(state.keyboardCell); canvas.setAttribute('aria-label', `${$('coordinate-label').textContent}，回车${state.tool==='place'?'放豆':'擦除'}`); scheduleDraw();
  } else if (event.key==='Enter' || event.key===' ') { event.preventDefault(); operate(state.keyboardCell ?? state.hover ?? 0); }
});
document.addEventListener('keydown', event => {
  if (['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName) || document.querySelector('dialog[open]')) return;
  if (event.key.toLowerCase()==='p') setTool('place');
  if (event.key.toLowerCase()==='e') setTool('erase');
});
$('place-tool').addEventListener('click',()=>setTool('place'));
$('erase-tool').addEventListener('click',()=>setTool('erase'));
$('move-tool').addEventListener('click',()=>setTool('move'));
$('zoom-in').addEventListener('click',()=>zoomAt(view.width/2,view.height/2,1.3));
$('zoom-out').addEventListener('click',()=>zoomAt(view.width/2,view.height/2,1/1.3));
$('zoom-fit').addEventListener('click',fitBoard);
$('grid-toggle').addEventListener('click',()=>{state.grid=!state.grid;$('grid-toggle').textContent=`网格 ${state.grid?'开':'关'}`;$('grid-toggle').setAttribute('aria-pressed',String(state.grid));scheduleDraw();});

let canvasAction='new', canvasContext=null;
function sendCanvas(action,values={},context=state) {
  if(!state.ready || state.pending.size || paintQueue.size || converterUI?.isBusy()) {toast('请等待当前修改保存后再操作');return;}
  stopStroke();
  const requestId=crypto.randomUUID();
  const timer=setTimeout(()=>state.socket?.close(),10000);
  state.pending.set(requestId,{timer});controls();
  state.socket.send(JSON.stringify({type:'canvas',requestId,action,canvasId:context.canvasId,epoch:context.epoch,expectedRevision:context.revision ?? state.board.revision,...values}));
}
function openCanvasDialog(action) {
  if(!state.ready || converterUI?.isBusy())return;
  $('more-dialog').close();
  stopStroke();canvasAction=action;
  canvasContext={canvasId:state.canvasId,epoch:state.epoch,revision:state.board.revision};
  $('canvas-dialog-title').textContent={new:'新建画布',expand:'扩展当前画布',clear:'清空当前画布'}[action];
  $('canvas-dialog-note').textContent={new:'当前作品会保存到“我的画布”。新画布会同步打开给房间里的所有人。',expand:'向右、向下扩展，原有豆豆位置不变。行列范围为 8–256。',clear:'将清除当前画布的全部豆豆。清盘前自动保存备份，可从画布列表重新打开。'}[action];
  $('canvas-fields').hidden=action==='clear';
  $('canvas-name').disabled=action!=='new';
  $('canvas-width').disabled=$('canvas-height').disabled=action==='clear';
  $('canvas-width').min=action==='expand'?cols():8; $('canvas-height').min=action==='expand'?rows():8;
  $('canvas-width').value=action==='expand'?Math.min(256,cols()+16):64;
  $('canvas-height').value=action==='expand'?Math.min(256,rows()+16):64;
  $('canvas-dialog').showModal();
}
for(const action of ['new','expand','clear']) $('canvas-'+action).addEventListener('click',()=>openCanvasDialog(action));
$('canvas-cancel').addEventListener('click',()=>$('canvas-dialog').close());
$('canvas-form').addEventListener('submit',event=>{
  event.preventDefault();
  sendCanvas(canvasAction,{name:$('canvas-name').value,width:Number($('canvas-width').value),height:Number($('canvas-height').value)},canvasContext);
  $('canvas-dialog').close();
});
$('canvas-select').addEventListener('change',event=>{const targetId=event.target.value;event.target.value=state.canvasId;sendCanvas('switch',{targetId});});

$('download-close').addEventListener('click',()=>$('download-dialog').close());
$('export-button').addEventListener('click',async()=>{
  if (!state.ready || state.pending.size || paintQueue.size || state.exporting || converterUI?.isBusy()) return;
  $('more-dialog').close();
  state.exporting=true; controls(); const label=$('export-button').querySelector('span'); label.textContent='生成中…';
  try {
    const response=await fetch('/api/export',{method:'POST',headers:{Authorization:`Bearer ${key}`}});
    if (!response.ok) throw new Error(await response.text());
    const blob=await response.blob();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl=URL.createObjectURL(blob);
    const link=$('download-again'); link.href=downloadUrl;
    link.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'bead-room-4096x4096.png';
    link.click(); $('download-dialog').showModal();
  } catch(error) { toast(error.message || '导出失败，作品已经保存，可以重试'); }
  finally { state.exporting=false; label.textContent='导出 4K'; controls(); }
});

function canSwitchRoom() {
  return !state.pending.size && !paintQueue.size && !state.exporting && !pointers.size && !converterUI?.isBusy();
}
function activateRoom(session) {
  if (!canSwitchRoom()) {toast('请等待当前修改保存或导出完成，再切换房间');return false;}
  stopStroke(); clearPending(); clearTimeout(reconnectTimer);
  converterUI?.roomChanged();
  key=session.key; retry=0; state.board=null; state.canvasId=null; state.epoch=null;
  state.roomId=session.room.id;state.reference=null;
  colorBoxUI?.update({roomId:state.roomId,canvasId:null,palette:[],cells:[],reference:null});
  state.hover=null; state.keyboardCell=null; state.online=0; state.ready=false;
  $('canvas-select').replaceChildren(); $('room-name').textContent=session.room.name;
  $('empty-hint').hidden=true; $('bead-count').textContent='0'; $('board-version').textContent='';
  $('coordinate-label').textContent='请选择格子';
  if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}
  $('download-again').removeAttribute('href'); $('download-dialog').close();
  connect(); scheduleDraw(); return true;
}
const roomUI=createRoomUI({onEnter:activateRoom,canSwitch:canSwitchRoom,notify:toast});
colorBoxUI=createColorBox({root:$('color-box-panel'),notify:toast,onSelect:index=>{
  if (!state.ready || converterUI?.isBusy()) return;
  state.color=index;setTool('place');
}});
converterUI=createConverter({
  getContext:()=>({roomId:state.roomId,key,canvasId:state.canvasId,epoch:state.epoch,board:state.board,ready:state.ready,
    canImport:state.ready && !state.pending.size && !paintQueue.size && !state.exporting && !pointers.size}),
  getManualCodes:()=>colorBoxUI.getManualCodes(),notify:toast,onBusyChange:controls,
  onImported:({canvasId,manualCodes,roomId})=>{
    if (state.roomId !== roomId) return;
    colorBoxUI.setManualCodes(roomId,canvasId,manualCodes);
    requestSync();
  },
});
$('image-convert').addEventListener('click',()=>{
  if(!state.ready || pointers.size || converterUI.isBusy())return;
  stopStroke(false);$('more-dialog').close();converterUI.open();
});
$('sheet-export').addEventListener('click',()=>{
  if(!canExport(state) || paintQueue.size || converterUI.isBusy())return;
  $('more-dialog').close();
  const palette=state.board.palette.map((color,index)=>({...color,code:color.code || `旧${index+1}`}));
  const pattern=guidePattern(state.board,state.reference);
  const name=$('canvas-select').selectedOptions?.[0]?.textContent || '我的拼豆图纸';
  openSheetExport({pattern,palette,name,notify:toast});
});
initWorkspace({beforeLayout:()=>{
  if(pointers.size){toast('请先结束当前手势，再调整布局');return false;}
  return true;
}});
$('more-button').addEventListener('click',()=>{if(pointers.size)return;$('more-dialog').showModal();});
$('more-close').addEventListener('click',()=>$('more-dialog').close());
document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();fitBoard();});
document.addEventListener('visibilitychange',()=>{
  if (!document.hidden && key) {
    if (state.socket?.readyState===WebSocket.OPEN) requestSync();
    else if (state.socket?.readyState!==WebSocket.CONNECTING) {retry=0;connect();}
  }
});
new ResizeObserver(resize).observe(container);
window.addEventListener('resize', resize);
const initialSession=roomUI.restore();
if (initialSession) activateRoom(initialSession); else {connection('请选择房间');roomUI.open();}
resize();
