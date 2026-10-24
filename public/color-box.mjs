import { colorCodeCompare } from './pattern-data.mjs';
import { paletteEntries, COLOR_GROUPS } from './palette.mjs';

export function normalizeManualCodes(codes, palette) {
  const valid=new Set(palette.filter(color=>!color.legacy).map(color=>color.code));
  return [...new Set((Array.isArray(codes)?codes:[]).filter(code=>typeof code==='string' && valid.has(code)))].sort(colorCodeCompare);
}

export function createManualColorStore({storage,onUnavailable=()=>{}}={}) {
  const memory=new Map(); let warned=false;
  const warn=()=>{if(!warned){warned=true;onUnavailable();}};
  if(storage===undefined) { try { storage=globalThis.localStorage; } catch {warn();} }
  const keyFor=(roomId,canvasId)=>`pingdou:manual-colors:v1:${encodeURIComponent(roomId)}:${encodeURIComponent(canvasId)}`;
  return {
    get(roomId,canvasId,palette) {
      if(!roomId || !canvasId) return [];
      const key=keyFor(roomId,canvasId);
      if(!memory.has(key)) {
        let value=[];
        try { const raw=storage?.getItem(key); if(raw) { value=JSON.parse(raw); if(!Array.isArray(value)) throw new Error('invalid storage'); } }
        catch {warn();}
        memory.set(key,normalizeManualCodes(value,palette));
      }
      return normalizeManualCodes(memory.get(key),palette);
    },
    set(roomId,canvasId,codes,palette) {
      const value=normalizeManualCodes(codes,palette);
      if(!roomId || !canvasId) return value;
      const key=keyFor(roomId,canvasId); memory.set(key,value);
      try { if(!storage) warn(); else storage.setItem(key,JSON.stringify(value)); } catch {warn();}
      return value.slice();
    },
  };
}

export function mergeColorBox({palette,cells=[],reference=null,manualCodes=[]}) {
  const manual=new Set(normalizeManualCodes(manualCodes,palette));
  const counts=new Map();
  for(const cell of cells) {
    const code=typeof cell==='string'?cell:palette[cell?.color]?.code;
    if(code) counts.set(code,(counts.get(code)||0)+1);
  }
  const referenceCounts=new Map();
  for(const item of reference?.items || []) {
    if(typeof item.code==='string' && Number.isSafeInteger(item.count) && item.count>=0) referenceCounts.set(item.code,item.count);
  }
  return palette.map((color,index)=>({code:color.code,color,index,manual:manual.has(color.code),referenceCount:referenceCounts.get(color.code)??null,currentCount:counts.get(color.code)||0}))
    .filter(entry=>entry.manual || entry.referenceCount!==null).sort((a,b)=>colorCodeCompare(a.code,b.code));
}

const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const button=(text,className='button button-quiet')=>{const node=el('button',className,text);node.type='button';return node;};

export function openColorPicker({palette,selectedCodes=[],onApply,title='添加我的颜色',onClose=()=>{}}) {
  const selected=new Set(normalizeManualCodes(selectedCodes,palette));
  const dialog=el('dialog','converter-dialog color-picker-dialog');
  const heading=el('h2',null,title); dialog.setAttribute('aria-label',title);
  const note=el('p','converter-note','多选加入个人颜色盒。收藏不会限制转换；移除收藏不会擦除格子。');
  const filters=el('div','color-picker-filters');
  const search=el('input'); search.type='search';search.placeholder='搜索色号、颜色或 HEX';search.setAttribute('aria-label','搜索完整 MARD 色盘');
  const group=el('select'); group.setAttribute('aria-label','颜色分组');
  for(const [value,label] of [['','全部颜色'],...COLOR_GROUPS]) {const option=el('option',null,label);option.value=value;group.append(option);}
  filters.append(group,search);
  const count=el('p','converter-note'); const grid=el('div','color-picker-grid');
  const actions=el('div','converter-actions'); const cancel=button('取消');const apply=button('加入颜色盒','button button-primary');
  actions.append(cancel,apply);dialog.append(heading,note,filters,count,grid,actions);document.body.append(dialog);
  let closed=false;
  const destroy=()=>{if(closed)return;closed=true;dialog.remove();onClose();};
  const render=()=>{
    grid.replaceChildren(); const entries=paletteEntries(palette,group.value,search.value);
    for(const {color} of entries) {
      const item=button('','color-picker-color');item.setAttribute('aria-pressed',String(selected.has(color.code)));
      item.setAttribute('aria-label',`${color.code}，${color.name || color.hex}`);
      const bead=el('span','palette-bead');bead.style.setProperty('--color',color.hex);const code=el('strong',null,color.code);const marker=el('span','color-picker-check','✓');marker.setAttribute('aria-hidden','true');
      item.append(bead,code,marker);item.addEventListener('click',()=>{if(selected.has(color.code))selected.delete(color.code);else selected.add(color.code);item.setAttribute('aria-pressed',String(selected.has(color.code)));count.textContent=`已选 ${selected.size} 色 · 当前显示 ${entries.length} 色`;});grid.append(item);
    }
    count.textContent=`已选 ${selected.size} 色 · 当前显示 ${entries.length} 色`;
    if(!entries.length) grid.append(el('p','converter-note','没有匹配的色号。'));
  };
  search.addEventListener('input',render);group.addEventListener('change',render);
  cancel.addEventListener('click',()=>dialog.close());apply.addEventListener('click',()=>{onApply(normalizeManualCodes([...selected],palette));dialog.close();});
  dialog.addEventListener('close',destroy);render();dialog.showModal();return {close:()=>dialog.close(),isOpen:()=>dialog.open};
}

export function createColorBox({root,onSelect,notify=()=>{}}) {
  if(!root) throw new Error('颜色盒缺少容器。');
  const store=createManualColorStore({onUnavailable:()=>notify('本地存储不可用，个人颜色仅在本次页面中保留。')});
  let context={roomId:null,canvasId:null,palette:[],cells:[],reference:null},manual=[],picker=null;
  root.classList.add('color-box-panel');
  const details=el('details','color-box-details');
  try { details.open=localStorage.getItem('pingdou:color-box-expanded') === 'true'; } catch {details.open=false;}
  const summary=el('summary','color-box-summary');summary.append(el('strong',null,'我的颜色盒'));const total=el('span');summary.append(total);
  const body=el('div','color-box-body');const add=button('＋ 添加我的颜色','button button-quiet color-box-add');const note=el('p','color-box-note');const cards=el('div','color-box-cards');body.append(add,note,cards);details.append(summary,body);root.replaceChildren(details);
  details.addEventListener('toggle',()=>{try{localStorage.setItem('pingdou:color-box-expanded',String(details.open));}catch{}});
  const render=()=>{
    const entries=mergeColorBox({...context,manualCodes:manual});cards.replaceChildren();
    total.textContent=`${entries.length} 色`;add.disabled=!context.roomId || !context.canvasId;
    note.textContent=context.reference?`图纸用色与个人收藏合并显示；“图纸需”是目标用量，“已放”只统计实际豆子。`:'还没有图片参考，可先添加自己的常用颜色。';
    entries.forEach((entry,position)=>{
      const card=el('div','color-box-card');const select=button('','color-box-select');select.title=`${entry.code} · 图纸需 ${entry.referenceCount??'—'} 颗 · 已放 ${entry.currentCount} 颗`;
      select.setAttribute('aria-label',`选择 ${entry.code}，已放 ${entry.currentCount} 颗`);
      const bead=el('span','palette-bead');bead.style.setProperty('--color',entry.color.hex);const content=el('span','color-box-card-label');content.append(el('strong',null,`${position+1}. ${entry.code}`),el('small',null,entry.referenceCount===null?`个人 · 已放 ${entry.currentCount} 颗`:`图纸需 ${entry.referenceCount} 颗 · 已放 ${entry.currentCount} 颗${entry.manual?' · 个人':''}`));
      select.append(bead,content);select.addEventListener('click',()=>onSelect(entry.index));card.append(select);
      if(entry.manual) {const remove=button('×','color-box-remove');remove.setAttribute('aria-label',`从个人收藏移除 ${entry.code}`);remove.title='只移除个人收藏，不修改原图用色或格子';remove.addEventListener('click',()=>{manual=store.set(context.roomId,context.canvasId,manual.filter(code=>code!==entry.code),context.palette);render();});card.append(remove);}
      cards.append(card);
    });
  };
  add.addEventListener('click',()=>{
    const {roomId,canvasId,palette}=context;
    picker=openColorPicker({palette,selectedCodes:manual,onApply:codes=>{if(context.roomId!==roomId || context.canvasId!==canvasId)return;manual=store.set(roomId,canvasId,codes,palette);render();},onClose:()=>{picker=null;}});
  });
  render();
  return {
    update(next) {
      const changed=next.roomId!==context.roomId || next.canvasId!==context.canvasId;
      if(changed)picker?.close();context={...next,palette:next.palette||[],cells:next.cells||[],reference:next.reference||null};
      manual=store.get(context.roomId,context.canvasId,context.palette);render();
    },
    getManualCodes:()=>manual.slice(),
    setManualCodes(roomId,canvasId,codes) {
      // The imported callback may arrive before the new snapshot. The current
      // room palette still validates its codes without changing the old box.
      const saved=store.set(roomId,canvasId,codes,context.palette);
      if(context.roomId===roomId && context.canvasId===canvasId){manual=saved;render();}
    },
    isModalOpen:()=>Boolean(picker?.isOpen()),
  };
}
