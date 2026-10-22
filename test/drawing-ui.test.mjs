import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createBoard } from '../src/board.mjs';
import { TapGesture, lineCells, stepCell } from '../public/interaction.mjs';
import { beginSync, acceptSnapshot, canExport } from '../public/sync-state.mjs';
import { COLOR_GROUPS, paletteEntries } from '../public/palette.mjs';

// Exercise the actual event handlers with a small DOM boundary, no browser or user data.
const source=(await readFile(new URL('../public/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
function harness() {
  const nodes=new Map(), intervals=new Map(); let timer=0;
  function element() { return {value:'',hidden:false,open:false,children:[],handlers:{},textContent:'',tagName:'CANVAS',style:{setProperty(){}},
    classList:{toggle(){},add(){},remove(){}},setAttribute(){},focus(){},setPointerCapture(){},
    addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);},
    replaceChildren(...children){this.children=children;},append(child){this.children.push(child);},
    querySelector(){return element();},getBoundingClientRect(){return {left:0,top:0,width:600,height:600};},
    getContext(){return new Proxy({}, {get:()=>()=>{}});},showModal(){this.open=true;},close(){this.open=false;} }; }
  const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const document=Object.assign(element(),{hidden:false,getElementById:get,createElement:element,
    querySelector:selector=>selector==='dialog[open]'?null:get(selector)});
  const window=element(), sent=[];
  class Socket {static OPEN=1;static CONNECTING=0;readyState=1;addEventListener(){};send(text){sent.push(JSON.parse(text));}}
  const context=vm.createContext({document,window,location:{hostname:'localhost',protocol:'http:',host:'localhost',hash:'#'+'a'.repeat(48)},
    history:{replaceState(){}},WebSocket:Socket,ResizeObserver:class {observe(){}},devicePixelRatio:1,
    crypto:{randomUUID:()=>String(++timer)},requestAnimationFrame:()=>1,clearTimeout(){},setTimeout:()=>++timer,
    setInterval:(fn,ms)=>{const id=++timer;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),
    TapGesture,lineCells,stepCell,beginSync,acceptSnapshot,canExport,COLOR_GROUPS,paletteEntries});
  vm.runInContext(source,context);
  context.board=createBoard(16,16);
  vm.runInContext('state.board=board;state.ready=true;state.color=0;state.canvasId="test";state.epoch=0;view.zoom=1;view.x=0;view.y=0;',context);
  const emit=(node,name,values={})=>{for(const fn of node.handlers[name]??[])fn({pointerId:1,pointerType:'mouse',button:0,clientX:24,clientY:24,preventDefault(){},target:get('board'),...values});};
  return {get,document,window,emit,sent,context,tick:ms=>{for(const t of [...intervals.values()])if(t.ms===ms)t.fn();}};
}
test('mouse plus direction places from origin, stops on release and cannot wrap right edge',()=>{
  const h=harness(),c=h.get('board');
  h.emit(c,'pointerdown');h.emit(h.document,'keydown',{key:'d'});h.tick(50);h.tick(50);
  assert.deepEqual(h.sent.map(m=>m.index),[17,18]);
  h.tick(100);h.emit(c,'pointerup');h.tick(50);h.tick(100);h.tick(50);
  assert.equal(h.sent.length,2);
  h.emit(c,'pointerdown',{clientX:248});h.emit(h.document,'keydown',{key:'d'});h.tick(50);h.tick(100);h.tick(50);
  assert.equal(h.sent.at(-1).index,31);assert.equal(h.sent.length,3);
});
test('touch trace fills intermediate cells, pinch suppresses drawing, move tool only pans',()=>{
  const h=harness(),c=h.get('board');
  h.emit(c,'pointerdown',{pointerType:'touch'});
  h.emit(c,'pointermove',{pointerType:'touch',clientX:88});
  h.emit(c,'pointerup',{pointerType:'touch',clientX:88});
  for(let i=0;i<5;i++)h.tick(50);
  assert.deepEqual(h.sent.map(m=>m.index),[17,18,19,20,21]);
  h.emit(c,'pointerdown',{pointerType:'touch'});
  h.emit(c,'pointerdown',{pointerType:'touch',pointerId:2,clientX:120});
  h.emit(c,'pointermove',{pointerType:'touch',clientX:100});h.tick(50);
  assert.equal(h.sent.length,5);
  vm.runInContext('setTool("move")',h.context);
  h.emit(c,'pointerdown',{pointerType:'touch'});h.emit(c,'pointermove',{pointerType:'touch',clientX:88});h.tick(50);
  assert.equal(h.sent.length,5);
});
test('queued trace disables export and window blur discards unsent drawing',()=>{
  const h=harness(),c=h.get('board');
  h.emit(c,'pointerdown',{pointerType:'touch'});h.emit(c,'pointermove',{pointerType:'touch',clientX:88});
  assert.equal(h.get('export-button').disabled,true);
  assert.equal(h.get('canvas-new').disabled,true);
  h.emit(h.window,'blur');h.tick(50);assert.equal(h.sent.length,0);
  assert.equal(h.get('export-button').disabled,false);
});
test('changing color preserves the original color of a queued touch trace',()=>{
  const h=harness(),c=h.get('board');
  h.emit(c,'pointerdown',{pointerType:'touch'});h.emit(c,'pointermove',{pointerType:'touch',clientX:88});
  h.emit(c,'pointerup',{pointerType:'touch',clientX:88});
  vm.runInContext('state.color=5;setTool("place")',h.context);
  for(let i=0;i<5;i++)h.tick(50);
  assert.equal(h.sent.length,5);assert.ok(h.sent.every(op=>op.color===0));
});

test('fit reserves ruler space and contains square and rectangular boards',()=>{
  const h=harness();
  for(const [width,height,cols,rows] of [[319,334,80,80],[742,640,80,80],[560,350,80,80],[319,334,256,8],[319,334,8,256]]) {
    h.context.dim={width,height,cols,rows};
    const result=vm.runInContext(`state.board.width=dim.cols;state.board.height=dim.rows;
      view.width=dim.width;view.height=dim.height;fitBoard();
      ({x:view.x,y:view.y,right:view.x+dim.cols*16*view.zoom,bottom:view.y+dim.rows*16*view.zoom})`,h.context);
    assert.ok(result.x>=32-1e-8);assert.ok(result.y>=24-1e-8);
    assert.ok(result.right<=width-12+1e-8);assert.ok(result.bottom<=height-12+1e-8);
  }
});

test('resize does not reset an unchanged canvas and preserves the panned center',()=>{
  const h=harness();
  vm.runInContext(`let resets=0;let storedWidth=canvas.width,storedHeight=canvas.height;
    Object.defineProperty(canvas,'width',{get:()=>storedWidth,set:v=>{resets++;storedWidth=v;}});
    Object.defineProperty(canvas,'height',{get:()=>storedHeight,set:v=>{resets++;storedHeight=v;}});
    resize();resize();`,h.context);
  assert.equal(vm.runInContext('resets',h.context),0);
  h.get('canvas-container').getBoundingClientRect=()=>({left:0,top:0,width:400,height:800});
  const center=vm.runInContext(`view.fit=false;view.zoom=2;view.x=80;view.y=40;
    const before={x:(view.width/2-view.x)/view.zoom,y:(view.height/2-view.y)/view.zoom};
    resize();({before,after:{x:(view.width/2-view.x)/view.zoom,y:(view.height/2-view.y)/view.zoom}})`,h.context);
  assert.equal(center.before.x,center.after.x);assert.equal(center.before.y,center.after.y);
});
