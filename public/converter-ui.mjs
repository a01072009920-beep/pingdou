import { readLocalImage, normalizeCrop } from './image-input.mjs';
import { paletteFingerprint, colorCodeCompare } from './pattern-data.mjs';
import { contrastText } from './color-science.mjs';
import { openColorPicker, normalizeManualCodes } from './color-box.mjs';
import { openSheetExport } from './pattern-sheet.mjs';

export function createConversionRunner({makeWorker=()=>new Worker(new URL('./convert-worker.mjs',import.meta.url),{type:'module'}),onResult,onProgress=()=>{},onError=()=>{}}) {
  let serial=0,worker=null,cachedImage=null,cache=null;
  const cancel=()=>{serial++;worker?.terminate();worker=null;};
  return {cancel,clear(){cancel();cachedImage=null;cache=null;},run(input){
    cancel();const id=serial;
    try {
      const current=makeWorker();worker=current;
      current.onmessage=({data})=>{
        if(serial!==id || data.id!==id)return;
        if(data.type==='progress')onProgress(data.progress);
        else if(data.type==='result'){worker=null;current.terminate();cachedImage=input.image;cache=data.result.cache || null;onResult(data.result);}
        else if(data.type==='error'){worker=null;current.terminate();onError(data.message);}
      };
      current.onerror=()=>{if(serial!==id)return;current.terminate();worker=null;onError('转换任务未完成，请重试或缩小原图。');};
      current.postMessage({...input,id,cache:cachedImage===input.image?cache:null});
    }catch(error){onError(error.message || '浏览器无法启动转换，请换用新版 Chrome / Edge。');}
  }};
}

export function createImportDraft(makeId=()=>crypto.randomUUID()) {
  let signature=null,payload=null;
  return {clear(){signature=null;payload=null;},current:()=>payload?JSON.parse(JSON.stringify(payload)):null,prepare(body){
    const next=JSON.stringify(body);
    if(next!==signature){signature=next;payload={...JSON.parse(next),requestId:makeId()};}
    return JSON.parse(JSON.stringify(payload));
  }};
}

const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const button=(text,cls='button button-quiet')=>{const node=el('button',cls,text);node.type='button';return node;};

export function createConverter({getContext,getManualCodes=()=>[],onImported,notify=()=>{},onBusyChange=()=>{}}) {
  const dialog=el('dialog','converter-dialog converter-workspace');dialog.setAttribute('aria-labelledby','converter-title');
  const header=el('header','converter-heading'),heading=el('div');heading.append(el('span','converter-eyebrow','豆在一起 · 本地图片工作台'));
  const title=el('h2',null,'图片转拼豆图纸');title.id='converter-title';heading.append(title);
  const closeButton=button('返回画板');header.append(heading,closeButton);
  const body=el('div','converter-layout'),controls=el('div','converter-settings'),preview=el('div','converter-preview');
  const input=(id,label,type='number',value='')=>{
    const field=el('label','converter-field');field.htmlFor=id;field.append(el('span',null,label));const node=el('input');node.id=id;node.type=type;node.value=value;field.append(node);controls.append(field);return node;
  };
  const file=input('convert-file','选择图片','file');file.accept='image/png,image/jpeg';
  controls.append(el('p','converter-note','PNG / JPEG · 最多 10 MiB、1600 万像素。图片只在此浏览器处理。'));
  const name=input('convert-name','画布名称','text','图片拼豆');name.maxLength=60;
  const width=input('convert-width','画布列数','number','64'),height=input('convert-height','画布行数','number','64');
  for(const node of [width,height]){node.min='8';node.max='256';node.step='1';}
  const modeLabel=el('label','converter-field');modeLabel.htmlFor='convert-mode';modeLabel.append(el('span',null,'转换方式'));
  const mode=el('select');mode.id='convert-mode';for(const [value,label] of [['smooth','平滑 · 照片与渐变'],['cartoon','卡通 · 主色与轮廓'],['nearest','像素画 · 最近邻']]){const option=el('option',null,label);option.value=value;mode.append(option);}modeLabel.append(mode);controls.append(modeLabel);
  const maxColors=input('convert-max-colors','颜色上限（0 为不限）','number','0');maxColors.min='0';maxColors.max='291';maxColors.step='1';
  const contour=input('convert-contour','轮廓保护（卡通模式）','range','0.5');contour.min='0';contour.max='1';contour.step='.1';contour.value='.5';
  const coverage=input('convert-coverage','图纸覆盖率（%）','number','50');coverage.min='10';coverage.max='90';coverage.step='5';
  const matte=input('convert-matte','半透明边缘底色','color','#ffffff');
  const cropDetails=el('details','converter-crop'),cropSummary=el('summary',null,'裁剪区域（也可在原图上框选）');cropDetails.append(cropSummary);
  const cropFields={};for(const [key,label] of [['x','起始 X'],['y','起始 Y'],['width','宽度'],['height','高度']]){
    const row=el('label','converter-field');row.append(el('span',null,label));const field=el('input');field.id=`crop-${key}`;field.type='number';field.step='1';field.min=['x','y'].includes(key)?'0':'1';row.append(field);cropFields[key]=field;cropDetails.append(row);
  }
  const resetCrop=button('恢复整图');cropDetails.append(resetCrop);controls.append(cropDetails);
  const onlyLabel=el('label','converter-check'),onlyBox=el('input');onlyBox.type='checkbox';onlyBox.id='convert-only-box';onlyLabel.append(onlyBox,el('span',null,'仅使用盒子中的颜色'));controls.append(onlyLabel);
  const choices=el('div','converter-actions'),manualButton=button('补充我的颜色'),lockButton=button('锁定颜色');choices.append(manualButton,lockButton);controls.append(choices);
  const selectionNote=el('p','converter-note');controls.append(selectionNote);
  const actions=el('div','converter-actions'),generate=button('生成预览','button button-primary'),cancel=button('取消转换');actions.append(generate,cancel);controls.append(actions);
  const tabs=el('div','converter-tabs'),tabButtons=new Map();let tab='original';
  for(const [key,label] of [['original','原图 / 裁剪'],['sampled','采样结果'],['beads','目标图纸']]){const b=button(label);b.setAttribute('aria-pressed',String(key===tab));b.addEventListener('click',()=>{tab=key;draw();});tabs.append(b);tabButtons.set(key,b);}
  const surface=el('div','converter-surface');const canvas=el('canvas');canvas.setAttribute('aria-label','图片转换预览，原图中可拖动框选，结果中拖动移动');surface.append(canvas);
  const zoomRow=el('label','converter-zoom');zoomRow.append(el('span',null,'预览缩放'));const zoom=el('input');zoom.type='range';zoom.min='100';zoom.max='1600';zoom.value='100';zoom.setAttribute('aria-label','转换预览缩放');zoomRow.append(zoom);
  const status=el('p','converter-status','选择图片，开始制作色号图纸。');status.setAttribute('role','status');
  const progress=el('progress');progress.max=1;progress.value=0;progress.hidden=true;
  const colors=el('div','converter-used-colors');colors.setAttribute('aria-label','转换所需颜色');
  const importNote=el('p','converter-note','导入为待拼图纸：画布显示目标颜色与色号，已放豆子从 0 颗开始，由你和伙伴一起拼；旧画布保留。');
  const importActions=el('div','converter-actions'),importButton=button('导入为待拼图纸','button button-primary'),sheetButton=button('导出本地图纸');importActions.append(importButton,sheetButton);
  preview.append(tabs,surface,zoomRow,status,progress,colors,importNote,importActions);body.append(controls,preview);dialog.append(header,body);document.body.append(dialog);

  let image=null,original=null,crop=null,palette=[],manualCodes=[],lockedCodes=[],lastResult=null,stale=true,running=false,reading=false,importing=false,boundRoom=null,uploadId=0;
  let pan={x:0,y:0},drag=null,frame=0,firstName='';const pointers=new Map(),draft=createImportDraft();
  const setStatus=(message,error=false)=>{status.textContent=message;status.classList.toggle('converter-error',error);};
  const busy=value=>{importing=value;onBusyChange();renderControls();};
  const cropValues=()=>{const r=crop || {x:0,y:0,width:image?.width || 1,height:image?.height || 1};for(const key of Object.keys(cropFields))cropFields[key].value=r[key];};
  function settings(){return {width:Number(width.value),height:Number(height.value),mode:mode.value,coverage:Number(coverage.value)/100,matte:matte.value.toUpperCase(),maxColors:Number(maxColors.value),
    lockedCodes:lockedCodes.slice(),candidateCodes:onlyBox.checked?[...new Set([...manualCodes,...(lastResult?.stats.items.map(item=>item.code)||[])])].sort(colorCodeCompare):null,crop,contourStrength:Number(contour.value)};}
  function renderControls(){
    generate.disabled=!image || reading || importing;cancel.disabled=!running;
    importButton.disabled=!lastResult || stale || running || reading || importing;
    sheetButton.disabled=!lastResult || stale || running || importing;
    closeButton.disabled=importing;file.disabled=importing;
    for(const node of [name,width,height,mode,maxColors,coverage,matte,contour,onlyBox,...Object.values(cropFields),manualButton,lockButton,resetCrop])node.disabled=importing;
    progress.hidden=!running;selectionNote.textContent=`个人补充 ${manualCodes.length} 色 · 锁定 ${lockedCodes.length} 色${onlyBox.checked?' · 已限制转换候选色':''}`;
    importButton.textContent=importing?'正在保存待拼图纸…':'导入为待拼图纸';
  }
  function colorList(){
    colors.replaceChildren();const map=new Map(palette.map(color=>[color.code,color])),counts=new Map(lastResult?.stats.items.map(item=>[item.code,item.count])||[]);
    const codes=[...new Set([...counts.keys(),...manualCodes])].sort(colorCodeCompare);
    for(const [index,code] of codes.entries()){
      const color=map.get(code);if(!color)continue;const card=button('','converter-used-color');card.style.setProperty('--color',color.hex);card.setAttribute('aria-pressed',String(lockedCodes.includes(code)));
      card.title='点击锁定或解除锁定此色（减少颜色时保留它）';card.append(el('span','palette-bead'),el('strong',null,`${index+1}. ${code}`),el('small',null,`${counts.get(code)||0} 颗${manualCodes.includes(code)?' · 个人':''}${lockedCodes.includes(code)?' · 锁定':''}`));
      card.addEventListener('click',()=>{if(importing)return;lockedCodes=lockedCodes.includes(code)?lockedCodes.filter(value=>value!==code):[...lockedCodes,code];invalidate();colorList();});colors.append(card);
    }
  }
  function invalidate(message='参数已变化，请重新生成预览。'){
    runner.cancel();running=false;stale=true;draft.clear();setStatus(message);renderControls();draw();
  }
  const runner=createConversionRunner({onProgress:value=>{progress.value=value;setStatus(`正在转换 ${Math.round(value*100)}%…`);},
    onResult:result=>{lastResult=result;stale=false;running=false;tab='beads';pan={x:0,y:0};zoom.value='100';colorList();setStatus(`${result.width} × ${result.height} 格 · 图纸需 ${result.stats.total.toLocaleString()} 颗 · ${result.stats.colors} 色${result.stats.total?'':' · 没有可见图纸内容，导入后为空白画布'}`);renderControls();draw();if(matchMedia('(max-width:760px), (max-width:1000px) and (orientation:portrait)').matches)preview.scrollIntoView({block:'start'});},
    onError:message=>{running=false;stale=true;setStatus(message,true);renderControls();}});
  function run(){
    if(!image || importing || reading)return;
    const current=getContext();if(current.roomId!==boundRoom){roomChanged();return;}
    const options=settings();if(onlyBox.checked&&!options.candidateCodes.length){setStatus('请先添加颜色，或取消“仅使用盒子中的颜色”。',true);return;}
    stale=true;draft.clear();running=true;progress.value=0;renderControls();runner.run({image,settings:options,palette});
  }
  generate.addEventListener('click',run);
  cancel.addEventListener('click',()=>invalidate('转换已取消，上次预览保留；可调整后重新生成。'));
  for(const node of [width,height,mode,maxColors,coverage,matte,contour,onlyBox])node.addEventListener('input',()=>{if(!importing)invalidate();});
  name.addEventListener('input',()=>draft.clear());
  for(const field of Object.values(cropFields)){
    field.addEventListener('input',()=>{if(!importing)invalidate();});
    field.addEventListener('change',()=>{
    if(!image)return;
    try {crop=normalizeCrop(Object.fromEntries(Object.entries(cropFields).map(([key,node])=>[key,Number(node.value)])),image.width,image.height);cropValues();invalidate();}catch(error){setStatus(error.message,true);}
    });
  }
  resetCrop.addEventListener('click',()=>{crop=null;cropValues();invalidate();tab='original';draw();});
  manualButton.addEventListener('click',()=>openColorPicker({palette,selectedCodes:manualCodes,title:'补充我的颜色',onApply:codes=>{manualCodes=codes;if(onlyBox.checked)invalidate();colorList();renderControls();}}));
  lockButton.addEventListener('click',()=>openColorPicker({palette,selectedCodes:lockedCodes,title:'锁定转换颜色',onApply:codes=>{lockedCodes=codes;invalidate();colorList();}}));
  sheetButton.addEventListener('click',()=>{if(lastResult&&!stale&&!running)openSheetExport({pattern:lastResult,palette,name:name.value,notify});});
  file.addEventListener('change',async()=>{
    const selected=file.files?.[0];if(!selected)return;const id=++uploadId;reading=true;renderControls();setStatus('正在读取原图…');
    try {
      const next=await readLocalImage(selected);if(id!==uploadId || !dialog.open)return;
      runner.clear();running=false;image=next;crop=null;lastResult=null;lockedCodes=[];stale=true;draft.clear();
      if(original)original.width=original.height=1;original=document.createElement('canvas');original.width=image.width;original.height=image.height;
      original.getContext('2d').putImageData(new ImageData(image.data,image.width,image.height),0,0);
      firstName=selected.name.replace(/\.[^.]+$/,'').slice(0,60)||'图片拼豆';name.value=firstName;cropValues();tab='original';pan={x:0,y:0};zoom.value='100';colorList();setStatus('原图已读取。可在原图上框选裁剪，再生成预览。');draw();
    }catch(error){if(id===uploadId)setStatus(error.message,true);}finally{if(id===uploadId){reading=false;renderControls();}}
  });
  importButton.addEventListener('click',async()=>{
    if(importing||!lastResult||stale||running)return;
    const context=getContext();if(context.roomId!==boundRoom){roomChanged();return;}
    if(!context.ready || !context.canImport){setStatus('请等待连接恢复与当前笔画保存完成，再导入。',true);return;}
    const title=name.value.trim();if(!title){name.focus();setStatus('请填写新画布名称。',true);return;}
    // An import may be durable even if its HTTP reply was lost. Retry the same
    // payload/context until the server resolves it, despite a newer WS snapshot.
    const payload=draft.current() || draft.prepare({name:title,width:lastResult.width,height:lastResult.height,cells:lastResult.cells,paletteFingerprint:paletteFingerprint(palette),canvasId:context.canvasId,epoch:context.epoch,settings:lastResult.settings});
    busy(true);setStatus('正在保存待拼图纸，成功后同房间的人会一起打开…');
    try {
      const response=await fetch('/api/import',{method:'POST',headers:{Authorization:`Bearer ${context.key}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json();
      if(!response.ok){if(response.status===409)draft.clear();throw new Error(result.message||'导入失败，请重试。');}
      if(boundRoom!==context.roomId || getContext().roomId!==context.roomId)return;
      onImported({canvasId:result.canvasId,manualCodes:manualCodes.slice(),roomId:context.roomId});draft.clear();
      setStatus(result.duplicate?'已核对先前导入，没有重复新建。':'待拼图纸已保存，开始放第一颗豆吧。');notify(result.duplicate?'已找到先前导入的图纸，没有重复新建。':'待拼图纸已打开，已放 0 颗；旧画布已保留。');dialog.close();
    }catch(error){setStatus(`${error.message || '导入结果尚未确认'} 可重试核对，草稿仍保留。`,true);}
    finally {busy(false);}
  });

  function draw(){
    if(frame)return;frame=requestAnimationFrame(()=>{frame=0;if(!dialog.open)return;for(const [key,b]of tabButtons)b.setAttribute('aria-pressed',String(tab===key));
      const rect=surface.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),dpr=Math.min(2,devicePixelRatio||1);
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
      if(!image){ctx.fillStyle='#7b8d9d';ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText('选择图片，开始制作',w/2,h/2);return;}
      if(tab==='original'){
        const scale=Math.min((w-24)/image.width,(h-24)/image.height),x=(w-image.width*scale)/2,y=(h-image.height*scale)/2;
        ctx.drawImage(original,x,y,image.width*scale,image.height*scale);
        if(crop){ctx.strokeStyle='#3668c9';ctx.lineWidth=2;ctx.strokeRect(x+crop.x*scale,y+crop.y*scale,crop.width*scale,crop.height*scale);}
        return;
      }
      if(!lastResult){ctx.fillStyle='#7b8d9d';ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText('点击“生成预览”查看转换结果',w/2,h/2);return;}
      const {width:cols,height:rows}=lastResult,step=Math.min((w-24)/cols,(h-24)/rows)*Number(zoom.value)/100;
      const left=(w-step*cols)/2+pan.x,top=(h-step*rows)/2+pan.y,map=new Map(palette.map(color=>[color.code,color.hex]));
      const x0=Math.max(0,Math.floor(-left/step)),x1=Math.min(cols,Math.ceil((w-left)/step)),y0=Math.max(0,Math.floor(-top/step)),y1=Math.min(rows,Math.ceil((h-top)/step));
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
        const i=y*cols+x,code=lastResult.cells[i],sample=lastResult.sampled?.[i];const color=tab==='sampled'?(sample?`rgb(${sample.map(Math.round).join(',')})`:null):code===null?null:map.get(code);
        ctx.fillStyle=color || ((x+y)%2?'#e9eff5':'#fafcff');ctx.fillRect(left+x*step,top+y*step,step+.1,step+.1);
        if(step>=24 && code!==null && tab==='beads'){ctx.fillStyle=contrastText(color);ctx.font=`600 ${Math.min(12,step*.3)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(code,left+(x+.5)*step,top+(y+.5)*step,step-3);}
      }
      if(step>=8){ctx.strokeStyle='#748da448';ctx.lineWidth=.5;ctx.beginPath();for(let x=x0;x<=x1;x++){ctx.moveTo(left+x*step,Math.max(top,0));ctx.lineTo(left+x*step,Math.min(h,top+rows*step));}for(let y=y0;y<=y1;y++){ctx.moveTo(Math.max(left,0),top+y*step);ctx.lineTo(Math.min(w,left+cols*step),top+y*step);}ctx.stroke();}
    });
  }
  const point=event=>{const r=surface.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};};
  function sourcePoint(p){const r=surface.getBoundingClientRect(),s=Math.min((r.width-24)/image.width,(r.height-24)/image.height);return {x:Math.max(0,Math.min(image.width,(p.x-(r.width-image.width*s)/2)/s)),y:Math.max(0,Math.min(image.height,(p.y-(r.height-image.height*s)/2)/s))};}
  surface.addEventListener('pointerdown',event=>{if(!image||importing||event.button!==0)return;event.preventDefault();const p=point(event);pointers.set(event.pointerId,p);surface.setPointerCapture(event.pointerId);drag=tab==='original'&&pointers.size===1?sourcePoint(p):null;});
  surface.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId)||!image)return;const p=point(event),old=[...pointers.values()];const previous=pointers.get(event.pointerId);pointers.set(event.pointerId,p);
    if(tab==='original'&&drag&&pointers.size===1){const to=sourcePoint(p);crop=normalizeCrop({x:Math.min(drag.x,to.x),y:Math.min(drag.y,to.y),width:Math.max(1,Math.abs(to.x-drag.x)),height:Math.max(1,Math.abs(to.y-drag.y))},image.width,image.height);cropValues();invalidate();}
    else if(tab!=='original'){
      if(pointers.size===2){const now=[...pointers.values()],distance=points=>Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);const d=distance(old);if(d>0)zoom.value=Math.max(100,Math.min(1600,Number(zoom.value)*distance(now)/d));pan.x+=(now[0].x+now[1].x-old[0].x-old[1].x)/2;pan.y+=(now[0].y+now[1].y-old[0].y-old[1].y)/2;}
      else {pan.x+=p.x-previous.x;pan.y+=p.y-previous.y;}draw();
    }
  });
  const end=event=>{if(!pointers.has(event.pointerId))return;pointers.delete(event.pointerId);if(tab==='original'||!pointers.size)drag=null;};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,end);
  zoom.addEventListener('input',()=>{pan={x:0,y:0};draw();});surface.addEventListener('wheel',event=>{if(tab==='original')return;event.preventDefault();zoom.value=Math.max(100,Math.min(1600,Number(zoom.value)*Math.exp(-event.deltaY*.002)));draw();},{passive:false});
  closeButton.addEventListener('click',()=>{if(!importing)dialog.close();});dialog.addEventListener('cancel',event=>{if(importing)event.preventDefault();});
  dialog.addEventListener('close',()=>{runner.cancel();running=false;reading=false;uploadId++;if(frame){cancelAnimationFrame(frame);frame=0;}renderControls();});
  window.addEventListener('beforeunload',event=>{if(importing || (image&&stale)){event.preventDefault();event.returnValue='';}});
  new ResizeObserver(draw).observe(surface);
  function roomChanged(){
    runner.clear();uploadId++;running=false;reading=false;image=null;lastResult=null;crop=null;manualCodes=[];lockedCodes=[];draft.clear();stale=true;
    if(original){original.width=original.height=1;original=null;}boundRoom=null;file.value='';if(dialog.open&&!importing)dialog.close();renderControls();
  }
  renderControls();
  return {open(){const context=getContext();if(!context.ready||!context.board){notify('请先连接房间。');return;}
    if(boundRoom!==context.roomId)roomChanged();boundRoom=context.roomId;palette=context.board.palette.filter(color=>!color.legacy).map(color=>({...color}));
    if(!image){width.value=context.board.width??context.board.size;height.value=context.board.height??context.board.size;manualCodes=normalizeManualCodes(getManualCodes(),palette);}
    if(!dialog.open)dialog.showModal();renderControls();colorList();draw();},close(){if(!importing)dialog.close();},roomChanged,isBusy:()=>importing};
}
