import { contrastText } from './color-science.mjs';

function sheetStats(cells,palette) {
  const counts=new Map(),order=new Map(palette.map((color,index)=>[color.code,index]));
  for(const code of cells)if(code!==null)counts.set(code,(counts.get(code)||0)+1);
  return {total:[...counts.values()].reduce((sum,count)=>sum+count,0),colors:counts.size,
    items:[...counts].map(([code,count])=>({code,count})).sort((a,b)=>order.get(a.code)-order.get(b.code))};
}

export const SHEET_CELL_SIZE=32;
export function sheetTiles(width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width>256||height>256) throw new Error('图纸行列应为 8–256。');
  const tiles=[];
  for(let y=0;y<height;y+=64) for(let x=0;x<width;x+=64) tiles.push({index:tiles.length,x,y,width:Math.min(64,width-x),height:Math.min(64,height-y)});
  return tiles;
}

export function sheetSnapshot(pattern,palette,name='拼豆图纸') {
  sheetTiles(pattern.width,pattern.height);
  if(!Array.isArray(pattern.cells)||pattern.cells.length!==pattern.width*pattern.height) throw new Error('图纸格数与行列不符。');
  const colors=palette.map(color=>Object.freeze({code:color.code,hex:color.hex,legacy:Boolean(color.legacy)}));
  const valid=new Set(colors.map(color=>color.code));
  if(pattern.cells.some(code=>code!==null && (typeof code!=='string'||!valid.has(code)))) throw new Error('图纸包含未知色号，请等待画布同步完成。');
  const cells=Object.freeze(pattern.cells.slice());
  return Object.freeze({width:pattern.width,height:pattern.height,cells,palette:Object.freeze(colors),name:String(name||'拼豆图纸').slice(0,80),stats:Object.freeze(sheetStats(cells,colors))});
}

export function fitCodeFont(code,cellSize=SHEET_CELL_SIZE) {
  return Math.min(11,(cellSize-4)/Math.max(1,String(code).length*.64));
}

export function sheetTileModel(snapshot,tile) {
  const palette=new Map(snapshot.palette.map(color=>[color.code,color]));const cells=[];
  for(let y=tile.y;y<tile.y+tile.height;y++)for(let x=tile.x;x<tile.x+tile.width;x++){
    const code=snapshot.cells[y*snapshot.width+x];cells.push({x,y,code,hex:code===null?null:palette.get(code).hex});
  }
  return {...tile,cellSize:SHEET_CELL_SIZE,cells,stats:sheetStats(cells.map(cell=>cell.code),snapshot.palette),rowLabels:Array.from({length:tile.height},(_,i)=>tile.y+i+1),columnLabels:Array.from({length:tile.width},(_,i)=>tile.x+i+1)};
}

const waitPaint=()=>new Promise(resolve=>(globalThis.requestAnimationFrame||setTimeout)(resolve));
function codeLines(code) {
  if(code.length<=6)return [code];
  const lines=[];for(let offset=0;offset<code.length;offset+=6)lines.push(code.slice(offset,offset+6));return lines;
}

export async function renderSheetTile(snapshot,tile) {
  const model=sheetTileModel(snapshot,tile);
  const left=54,top=118,right=24,bottom=30,legendColumns=Math.max(1,Math.min(6,Math.floor((tile.width*32+left+right)/175)));
  const legendRows=Math.ceil(model.stats.items.length/legendColumns);
  const width=Math.max(440,left+tile.width*32+right),legendTop=top+tile.height*32+42;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=legendTop+Math.max(1,legendRows)*29+bottom;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法生成图纸，请换用新版浏览器。');
  ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillStyle='#24394B';ctx.font='bold 20px sans-serif';ctx.fillText(snapshot.name,24,28,width-48);
  ctx.font='12px sans-serif';ctx.fillText(`MARD 291 色（含旧色兼容） · 整图 ${snapshot.width} 列 × ${snapshot.height} 行`,24,54,width-48);
  ctx.fillText(`第 ${tile.index+1} 块 · 列 ${tile.x+1}–${tile.x+tile.width} · 行 ${tile.y+1}–${tile.y+tile.height} · 每格 32px`,24,74,width-48);
  ctx.fillText(`本块 ${model.stats.total} 颗 / ${model.stats.colors} 色；整图合计 ${snapshot.stats.total} 颗 / ${snapshot.stats.colors} 色`,24,94,width-48);
  ctx.textAlign='center';ctx.font='10px sans-serif';ctx.fillStyle='#536B82';
  model.columnLabels.forEach((label,index)=>ctx.fillText(String(label),left+(index+.5)*32,top-12));
  model.rowLabels.forEach((label,index)=>ctx.fillText(String(label),left-18,top+(index+.5)*32));
  for(let y=0;y<tile.height;y++) {
    for(let x=0;x<tile.width;x++) {
      const cell=model.cells[y*tile.width+x],px=left+x*32,py=top+y*32;
      ctx.fillStyle=cell.hex||'#F3F6FA';ctx.fillRect(px,py,32,32);
      if(cell.code===null) {ctx.fillStyle='#B3C2D0';ctx.font='11px sans-serif';ctx.fillText('·',px+16,py+16);}
      else {
        const lines=codeLines(cell.code);const font=Math.min(11,26/(lines.length*1.05),fitCodeFont(lines.reduce((longest,line)=>line.length>longest.length?line:longest,'')));
        ctx.fillStyle=contrastText(cell.hex);ctx.font=`600 ${font}px sans-serif`;
        lines.forEach((line,index)=>ctx.fillText(line,px+16,py+16+(index-(lines.length-1)/2)*font*1.05,28));
      }
    }
    if(y%12===11)await waitPaint();
  }
  ctx.strokeStyle='#778B9D';ctx.lineWidth=.6;ctx.beginPath();
  for(let x=0;x<=tile.width;x++){ctx.moveTo(left+x*32,top);ctx.lineTo(left+x*32,top+tile.height*32);}
  for(let y=0;y<=tile.height;y++){ctx.moveTo(left,top+y*32);ctx.lineTo(left+tile.width*32,top+y*32);}ctx.stroke();
  const palette=new Map(snapshot.palette.map(color=>[color.code,color])),allCounts=new Map(snapshot.stats.items.map(item=>[item.code,item.count]));ctx.textAlign='left';ctx.fillStyle='#536B82';ctx.font='12px sans-serif';ctx.fillText('材料：本块 / 整图颗数（空格不计入白豆）',24,legendTop-17);
  model.stats.items.forEach((item,index)=>{
    const col=index%legendColumns,row=Math.floor(index/legendColumns),x=24+col*((width-48)/legendColumns),y=legendTop+row*29;
    ctx.fillStyle=palette.get(item.code).hex;ctx.fillRect(x,y,18,18);ctx.strokeStyle='#9AABBB';ctx.strokeRect(x,y,18,18);ctx.fillStyle='#24394B';ctx.font='11px sans-serif';ctx.fillText(`${item.code} · ${item.count} / 共${allCounts.get(item.code)}颗`,x+25,y+9,(width-48)/legendColumns-29);
  });
  if(!model.stats.total){ctx.fillStyle='#71869A';ctx.fillText('本块为空，没有所需材料。',24,legendTop+10);}
  return canvas;
}

export function openSheetExport({pattern,palette,name,notify=()=>{}}) {
  let snapshot;
  try {snapshot=sheetSnapshot(pattern,palette,name);}catch(error){notify(error.message);return null;}
  const dialog=document.createElement('dialog');dialog.className='converter-dialog sheet-export-dialog';dialog.setAttribute('aria-label','带色号图纸');
  const heading=document.createElement('h2');heading.textContent='带色号图纸';
  const note=document.createElement('p');note.className='converter-note';note.textContent=`${snapshot.width} × ${snapshot.height} 格 · 当前共 ${snapshot.stats.total} 颗、${snapshot.stats.colors} 色。每块最多 64 × 64 格，每格固定 32px。点击一块才生成并下载，导出期间的画布修改不会改变本次图纸。`;
  const list=document.createElement('div');list.className='sheet-tile-list';const urls=new Set();
  for(const tile of sheetTiles(snapshot.width,snapshot.height)) {
    const row=document.createElement('div');row.className='sheet-tile-row';
    const label=document.createElement('span');label.textContent=`第 ${tile.index+1} 块 · 列 ${tile.x+1}–${tile.x+tile.width}，行 ${tile.y+1}–${tile.y+tile.height}`;
    const download=document.createElement('button');download.type='button';download.className='button button-quiet';download.textContent='生成并下载';
    let prepared=null,generating=false;
    download.addEventListener('click',async()=>{
      if(generating)return;generating=true;download.disabled=true;download.textContent='正在生成…';let canvas;
      try {
        if(!prepared) {
          canvas=await renderSheetTile(snapshot,tile);
          const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('图纸生成失败，请重试。')),'image/png'));
          if(!dialog.open)return;
          prepared=URL.createObjectURL(blob);urls.add(prepared);
        }
        const anchor=document.createElement('a');anchor.href=prepared;anchor.download=`${snapshot.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}-色号图纸-${tile.index+1}-列${tile.x+1}-${tile.x+tile.width}-行${tile.y+1}-${tile.y+tile.height}.png`;document.body.append(anchor);anchor.click();anchor.remove();download.textContent='再次下载';
      }catch(error){notify(error.message);download.textContent='重试生成';}
      finally {if(canvas)canvas.width=canvas.height=1;generating=false;download.disabled=false;}
    });row.append(label,download);list.append(row);
  }
  const close=document.createElement('button');close.type='button';close.className='button button-primary';close.textContent='返回画板';close.addEventListener('click',()=>dialog.close());
  dialog.append(heading,note,list,close);dialog.addEventListener('close',()=>{for(const url of urls)URL.revokeObjectURL(url);dialog.remove();});document.body.append(dialog);dialog.showModal();return dialog;
}
