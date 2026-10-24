import { createHash, randomUUID } from 'node:crypto';
import { createBoard, validDimension } from './board.mjs';
import { PALETTE } from './palette.mjs';
import { paletteFingerprint, patternStats, colorCodeCompare } from '../public/pattern-data.mjs';

const MAX_BODY = 1024 * 1024;
const MAX_PENDING = 4;
const codes = new Map(PALETTE.map((color,index)=>[color.code,index]));
const payloadKeys = ['requestId','name','width','height','cells','paletteFingerprint','canvasId','epoch','settings'];
const settingsKeys = ['width','height','mode','coverage','matte','maxColors','lockedCodes','candidateCodes','crop','contourStrength'];
const referenceKeys = ['schema','requestId','payloadHash','paletteFingerprint','settings','items','total','colors'];
const guideReferenceKeys = [...referenceKeys,'width','height','cells'];
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const whitelist = (value,keys) => object(value) && Object.keys(value).every(key=>keys.includes(key));
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 80 && !/[\u0000-\u001F]/.test(value);
const fingerprint = value => typeof value === 'string' && value.length > 0 && value.length <= 32768;
const finiteRange = (value,min,max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const fail = (status,code,message) => Object.assign(new Error(message),{status,code});
const invalid = () => fail(400,'invalid','图纸参数无效，请检查尺寸、色号与转换设置');

function colorList(value,nullable=false) {
  if(nullable && value===null)return null;
  if(!Array.isArray(value) || value.length>PALETTE.length || value.some(code=>!codes.has(code))
    || new Set(value).size!==value.length)throw invalid();
  return [...value];
}

// Normalize only known, bounded scalar/array fields; never retain arbitrary client objects.
export function normalizeImportSettings(input,width,height) {
  if(!whitelist(input,settingsKeys))throw invalid();
  const values={width,height,mode:'smooth',coverage:.5,matte:'#FFFFFF',maxColors:0,
    lockedCodes:[],candidateCodes:null,crop:null,contourStrength:.5,...input};
  if(values.width!==width || values.height!==height || !validDimension(width) || !validDimension(height)
    || !['nearest','smooth','cartoon'].includes(values.mode) || !finiteRange(values.coverage,.1,.9)
    || typeof values.matte!=='string' || !/^#[a-fA-F0-9]{6}$/.test(values.matte)
    || !Number.isInteger(values.maxColors) || values.maxColors<0 || values.maxColors>PALETTE.length
    || !finiteRange(values.contourStrength,0,1))throw invalid();
  const lockedCodes=colorList(values.lockedCodes),candidateCodes=colorList(values.candidateCodes,true);
  if((values.maxColors && lockedCodes.length>values.maxColors) || candidateCodes?.length===0
    || (candidateCodes && lockedCodes.some(code=>!candidateCodes.includes(code))))throw invalid();
  let crop=null;
  if(values.crop!==null){
    if(!whitelist(values.crop,['x','y','width','height']) || Object.keys(values.crop).length!==4
      || !finiteRange(values.crop.x,0,16000000) || !finiteRange(values.crop.y,0,16000000)
      || !finiteRange(values.crop.width,Number.MIN_VALUE,16000000)
      || !finiteRange(values.crop.height,Number.MIN_VALUE,16000000))throw invalid();
    const {x,y,width:cropWidth,height:cropHeight}=values.crop;
    crop={x,y,width:cropWidth,height:cropHeight};
  }
  return {width,height,mode:values.mode,coverage:values.coverage,matte:values.matte.toUpperCase(),
    maxColors:values.maxColors,lockedCodes,candidateCodes,crop,contourStrength:values.contourStrength};
}

export function validImportReference(reference,canvasWidth,canvasHeight) {
  const keys=reference?.schema===2?guideReferenceKeys:referenceKeys;
  if(!whitelist(reference,keys) || Object.keys(reference).length!==keys.length
    || ![1,2].includes(reference.schema) || !identifier(reference.requestId) || !/^[a-f0-9]{64}$/.test(reference.payloadHash)
    || !fingerprint(reference.paletteFingerprint) || !Number.isInteger(reference.total) || reference.total<0
    || reference.total>65536 || !Number.isInteger(reference.colors) || reference.colors<0
    || reference.colors>PALETTE.length || !Array.isArray(reference.items) || reference.items.length!==reference.colors)return false;
  try {normalizeImportSettings(reference.settings,reference.schema===2?reference.width:reference.settings?.width,
    reference.schema===2?reference.height:reference.settings?.height);}catch{return false;}
  let total=0,previous;
  for(const item of reference.items){
    if(!whitelist(item,['code','count']) || Object.keys(item).length!==2 || !codes.has(item.code)
      || !Number.isInteger(item.count) || item.count<1 || item.count>65536
      || (previous!==undefined && colorCodeCompare(previous,item.code)>=0))return false;
    total+=item.count;previous=item.code;
  }
  if(total!==reference.total)return false;
  // Schema 1 is historical filled artwork; retain its exact format and do not infer a guide.
  if(reference.schema===1)return true;
  if(!validDimension(reference.width) || !validDimension(reference.height)
    || (canvasWidth!==undefined && reference.width>canvasWidth)
    || (canvasHeight!==undefined && reference.height>canvasHeight)
    || !Array.isArray(reference.cells) || reference.cells.length!==reference.width*reference.height
    || reference.cells.some(code=>code!==null && !codes.has(code)))return false;
  const stats=patternStats(reference.cells);
  return stats.total===reference.total && stats.colors===reference.colors
    && stats.items.every((item,index)=>item.code===reference.items[index].code && item.count===reference.items[index].count);
}

function validatePayload(input,room) {
  if(!whitelist(input,payloadKeys) || Object.keys(input).length!==payloadKeys.length
    || !identifier(input.requestId) || !identifier(input.canvasId) || !Number.isSafeInteger(input.epoch) || input.epoch<0
    || typeof input.name!=='string' || !input.name.trim() || input.name.length>60
    || !validDimension(input.width) || !validDimension(input.height) || !Array.isArray(input.cells)
    || input.cells.length!==input.width*input.height || input.cells.some(code=>code!==null && !codes.has(code))
    || !fingerprint(input.paletteFingerprint))throw invalid();
  if(input.paletteFingerprint!==paletteFingerprint(room.board.palette))throw fail(409,'palette_changed','色表已变化，请刷新后重新转换');
  return {requestId:input.requestId,name:input.name.trim(),width:input.width,height:input.height,
    cells:[...input.cells],paletteFingerprint:input.paletteFingerprint,canvasId:input.canvasId,epoch:input.epoch,
    settings:normalizeImportSettings(input.settings,input.width,input.height)};
}

function importedCanvas(room,payload) {
  const {requestId,...content}=payload;
  const payloadHash=createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const previous=room.canvases.find(canvas=>canvas.reference?.requestId===requestId);
  if(previous){
    if(previous.reference.payloadHash!==payloadHash)throw fail(409,'request_conflict','同一个导入编号对应不同图纸，请重新提交');
    return {ok:true,canvasId:previous.id,duplicate:true};
  }
  if(room.activeId!==payload.canvasId || room.canvasEpoch!==payload.epoch)throw fail(409,'stale_canvas','房间画布已变化，请重新核对后导入');
  if(!Number.isSafeInteger(room.canvasEpoch+1))throw fail(409,'revision_limit','画布版本已达到上限');
  const board=createBoard(payload.width,payload.height);
  const canvas={id:randomUUID(),name:payload.name,createdAt:new Date().toISOString(),board,
    reference:{schema:2,requestId,payloadHash,paletteFingerprint:payload.paletteFingerprint,
      width:payload.width,height:payload.height,cells:[...payload.cells],
      settings:payload.settings,...patternStats(payload.cells)}};
  const canvases=room.canvases.map(value=>value.id===room.activeId?{...value,board:room.board}:value);
  return {ok:true,canvasId:canvas.id,duplicate:false,
    room:{...room,board,activeId:canvas.id,canvasEpoch:room.canvasEpoch+1,canvases:[...canvases,canvas]}};
}

function readJSON(req,signal) {
  return new Promise((resolve,reject)=>{
    let size=0,chunks=[],settled=false;
    const finish=(error,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);chunks=[];
      req.off('data',data);req.off('end',end);req.off('error',interrupted);req.off('aborted',interrupted);
      signal.removeEventListener('abort',aborted);
      if(error){req.resume();reject(error);}else resolve(value);
    };
    const data=chunk=>{size+=chunk.length;if(size>MAX_BODY){finish(fail(413,'too_large','图纸超过 1 MiB，请缩小图案'));return;}chunks.push(chunk);};
    const end=()=>{try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));finish(null,value);}catch{finish(invalid());}};
    const interrupted=()=>finish(fail(400,'interrupted','请求中断，请重试'));
    const aborted=()=>finish(fail(503,'closing','服务正在关闭，请稍后重试'));
    const timer=setTimeout(()=>finish(fail(408,'timeout','读取图纸超时，请重试')),5000);timer.unref();
    req.on('data',data);req.on('end',end);req.on('error',interrupted);req.on('aborted',interrupted);
    signal.addEventListener('abort',aborted,{once:true});
    if(signal.aborted)aborted();
    else if(req.headers['content-length']!==undefined && (!/^\d+$/.test(req.headers['content-length'])
      || Number(req.headers['content-length'])>MAX_BODY))finish(fail(413,'too_large','图纸超过 1 MiB，请缩小图案'));
  });
}

export function createImportAPI({rooms,save,broadcast,isClosing,sameOrigin,onError}) {
  const readers=new Set(),active=new Set(),pending=new Map();
  async function process(req,res){
    let entry,reserved=false;
    try {
      if(isClosing())throw fail(503,'closing','服务正在关闭，请稍后重试');
      if(req.method!=='POST')throw fail(405,'method','请使用图纸导入入口');
      if(!sameOrigin(req))throw fail(403,'origin','请从当前网站提交操作');
      const authorization=req.headers.authorization;
      entry=typeof authorization==='string' && authorization.startsWith('Bearer ')?rooms.byKey(authorization.slice(7)):null;
      if(!entry)throw fail(401,'unauthorized','需要有效房间凭据');
      if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw fail(415,'content_type','提交格式无效');
      if((pending.get(entry)||0)>=MAX_PENDING || entry.queued>=256)throw fail(429,'busy','这个房间正在导入，请稍后重试');
      pending.set(entry,(pending.get(entry)||0)+1);
      reserved=true;
      const controller=new AbortController();readers.add(controller);
      let input;
      try {input=await readJSON(req,controller.signal);}finally{readers.delete(controller);}
      if(isClosing())throw fail(503,'closing','服务正在关闭，请稍后重试');
      const payload=validatePayload(input,entry.room);
      entry.queued++;
      const transaction=entry.queue.then(async()=>{
        const changed=importedCanvas(entry.room,payload);
        if(changed.duplicate)return changed;
        try {await save(entry.dataDir,changed.room);}catch(cause){onError(cause);throw fail(500,'save_failed','图纸保存失败，请检查电脑存储空间后重试');}
        Object.assign(entry.room,changed.room);
        // A failed/disconnected subscriber cannot undo an already durable import.
        try {broadcast(entry,payload.requestId);}catch(error){onError(error);}
        return {ok:true,canvasId:changed.canvasId,duplicate:false};
      });
      entry.queue=transaction.catch(()=>{}).finally(()=>{entry.queued--;});
      const result=await transaction;
      if(!res.destroyed){res.writeHead(200);res.end(JSON.stringify(result));}
    }catch(error){
      if(!error.status)onError(error);
      if(!res.destroyed){
        if(!req.complete)res.setHeader('Connection','close');
        res.writeHead(error.status||500);res.end(JSON.stringify({code:error.code||'internal',message:error.status?error.message:'图纸导入失败，请重试'}));
      }
    }finally{
      if(reserved){const count=pending.get(entry)-1;if(count)pending.set(entry,count);else pending.delete(entry);}
    }
  }
  return {
    handle(req,res,path){
      if(path!=='/api/import')return false;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      const task=process(req,res);active.add(task);task.finally(()=>active.delete(task));
      return task.then(()=>true);
    },
    close(){for(const controller of readers)controller.abort();},
    async idle(){await Promise.all([...active]);},
  };
}
