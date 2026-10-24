import { hexToRgb, rgbToLab, deltaE2000, srgbToLinear, linearToSrgb } from './color-science.mjs';
import { colorCodeCompare, patternStats, paletteFingerprint } from './pattern-data.mjs';

const LINEAR = Float64Array.from({length:256},(_,i)=>srgbToLinear(i));
const MAX_PIXELS=16_000_000;
const finite = (value,min,max,label) => {
  if (!Number.isFinite(value) || value<min || value>max) throw new TypeError(`${label}超出范围`);
  return value;
};
const integer = (value,min,max,label) => {
  finite(value,min,max,label);
  if (!Number.isInteger(value)) throw new TypeError(`${label}必须为整数`);
  return value;
};

function validate(image,options,palette) {
  if (!image || !options || typeof options!=='object') throw new TypeError('缺少图片或转换参数');
  integer(image.width,1,MAX_PIXELS,'原图宽度');
  integer(image.height,1,MAX_PIXELS,'原图高度');
  if (image.width*image.height>MAX_PIXELS) throw new TypeError('原图不能超过 1600 万像素');
  if (!(image.data instanceof Uint8ClampedArray || image.data instanceof Uint8Array)
    || image.data.length!==image.width*image.height*4) throw new TypeError('图片必须包含完整 RGBA 字节数据');
  if (!Array.isArray(palette) || !palette.length || palette.length>1024) throw new TypeError('无效色表');
  const colors=[];
  const byCode=new Map();
  for (const color of palette) {
    if (color?.legacy) continue;
    colorCodeCompare(color?.code,color?.code);
    if (byCode.has(color.code)) throw new TypeError('色表包含重复色号');
    const rgb=hexToRgb(color.hex);
    const entry={code:color.code,lab:rgbToLab(rgb),index:colors.length};
    colors.push(entry);
    byCode.set(entry.code,entry);
  }
  if (!colors.length || colors.length>291) throw new TypeError('候选 MARD 色表必须包含 1–291 色');
  const codeList = (codes,label) => {
    if (!Array.isArray(codes) || codes.length>291 || codes.some(code=>!byCode.has(code))) throw new TypeError(`${label}含无效色号`);
    return [...new Set(codes)];
  };
  const settings={
    width:integer(options.width,8,256,'画布列数'),height:integer(options.height,8,256,'画布行数'),
    mode:options.mode??'smooth', coverage:finite(options.coverage??.5,.1,.9,'可见覆盖率'),
    matte:options.matte??'#FFFFFF', maxColors:integer(options.maxColors??0,0,291,'颜色上限'),
    lockedCodes:codeList(options.lockedCodes??[],'锁定颜色'),
    candidateCodes:options.candidateCodes==null ? null : codeList(options.candidateCodes,'限定颜色'),
    crop:null,contourStrength:finite(options.contourStrength??.5,0,1,'轮廓保护强度'),
  };
  if (!['nearest','smooth','cartoon'].includes(settings.mode)) throw new TypeError('未知转换模式');
  const matte=hexToRgb(settings.matte).map(srgbToLinear);
  settings.matte=settings.matte.toUpperCase();
  if (options.crop!=null) {
    const crop=options.crop;
    if (!crop || typeof crop!=='object') throw new TypeError('无效裁剪矩形');
    const x=finite(crop.x,0,image.width,'裁剪横坐标'),y=finite(crop.y,0,image.height,'裁剪纵坐标');
    const width=finite(crop.width,Number.EPSILON,image.width,'裁剪宽度');
    const height=finite(crop.height,Number.EPSILON,image.height,'裁剪高度');
    if (x+width>image.width || y+height>image.height) throw new TypeError('裁剪不能超出图片');
    settings.crop={x,y,width,height};
  }
  const candidates=settings.candidateCodes===null ? colors : colors.filter(color=>settings.candidateCodes.includes(color.code));
  if (!candidates.length) throw new TypeError('限定颜色不能为空');
  if (settings.lockedCodes.some(code=>!candidates.some(color=>color.code===code))) throw new TypeError('锁定颜色必须包含在限定颜色中');
  if (settings.maxColors && settings.lockedCodes.length>settings.maxColors) throw new TypeError('颜色上限不能少于锁定颜色数量');
  return {settings,candidates,matte};
}

function sampler(image,settings,matte) {
  const crop=settings.crop??{x:0,y:0,width:image.width,height:image.height};
  const scale=Math.min(settings.width/crop.width,settings.height/crop.height);
  const left=(settings.width-crop.width*scale)/2, top=(settings.height-crop.height*scale)/2;
  const {data,width,height}=image;
  const luminance = index => (.2126*LINEAR[data[index]]+.7152*LINEAR[data[index+1]]+.0722*LINEAR[data[index+2]])*(data[index+3]/255);
  const edgeAt = (x,y,index) => {
    const current=luminance(index);
    let contrast=0;
    if (x>0) contrast=Math.max(contrast,Math.abs(current-luminance(index-4)));
    if (x+1<width) contrast=Math.max(contrast,Math.abs(current-luminance(index+4)));
    if (y>0) contrast=Math.max(contrast,Math.abs(current-luminance(index-width*4)));
    if (y+1<height) contrast=Math.max(contrast,Math.abs(current-luminance(index+width*4)));
    return contrast;
  };
  const composite = (rgb,alpha) => rgb.map((channel,i)=>linearToSrgb(channel*alpha+matte[i]*(1-alpha)));
  return (col,row) => {
    if (settings.mode==='nearest') {
      const x=(col+.5-left)/scale+crop.x, y=(row+.5-top)/scale+crop.y;
      if (x<crop.x || x>=crop.x+crop.width || y<crop.y || y>=crop.y+crop.height) return null;
      const px=Math.floor(x), py=Math.floor(y), index=(py*width+px)*4, alpha=data[index+3]/255;
      if (!alpha || alpha<settings.coverage) return null;
      return {rgb:composite([LINEAR[data[index]],LINEAR[data[index+1]],LINEAR[data[index+2]]],alpha),edge:edgeAt(px,py,index)};
    }
    const x0=Math.max(crop.x,(col-left)/scale+crop.x),y0=Math.max(crop.y,(row-top)/scale+crop.y);
    const x1=Math.min(crop.x+crop.width,(col+1-left)/scale+crop.x),y1=Math.min(crop.y+crop.height,(row+1-top)/scale+crop.y);
    if (x1<=x0 || y1<=y0) return null;
    let alphaArea=0,r=0,g=0,b=0,edgeSum=0;
    const buckets=settings.mode==='cartoon' ? new Map() : null;
    for (let y=Math.floor(y0);y<Math.ceil(y1);y++) {
      const dy=Math.min(y+1,y1)-Math.max(y,y0);
      for (let x=Math.floor(x0);x<Math.ceil(x1);x++) {
        const index=(y*width+x)*4;
        const area=(Math.min(x+1,x1)-Math.max(x,x0))*dy;
        const visible=area*data[index+3]/255;
        if (!visible) continue;
        const red=LINEAR[data[index]],green=LINEAR[data[index+1]],blue=LINEAR[data[index+2]];
        const edge=edgeAt(x,y,index);
        alphaArea+=visible; r+=red*visible; g+=green*visible; b+=blue*visible; edgeSum+=edge*visible;
        if (buckets) {
          // Coarse buckets only group nearby colors. Actual four-neighbor luminance
          // gradients weight their votes; dark boundary pixels get bounded priority.
          const key=(data[index]>>3)*1024+(data[index+1]>>3)*32+(data[index+2]>>3);
          const luma=.2126*red+.7152*green+.0722*blue;
          const weight=visible*(1+12*settings.contourStrength*edge*(1-.75*luma));
          const bucket=buckets.get(key)??{weight:0,r:0,g:0,b:0};
          bucket.weight+=weight; bucket.r+=red*weight; bucket.g+=green*weight; bucket.b+=blue*weight;
          buckets.set(key,bucket);
        }
      }
    }
    const alpha=Math.min(1,alphaArea*scale*scale);
    if (!alphaArea || alpha+1e-12<settings.coverage) return null;
    let rgb=[r/alphaArea,g/alphaArea,b/alphaArea];
    if (buckets) {
      let winner;
      for (const bucket of buckets.values()) if (!winner || bucket.weight>winner.weight) winner=bucket;
      rgb=[winner.r/winner.weight,winner.g/winner.weight,winner.b/winner.weight];
    }
    return {rgb:composite(rgb,alpha),edge:edgeSum/alphaArea};
  };
}

function nearest(lab,colors) {
  let best=colors[0],distance=Infinity;
  for (const color of colors) {
    const difference=deltaE2000(lab,color.lab);
    // Only a strict improvement wins; duplicate hex and exact ties keep palette order.
    if (difference<distance) {best=color;distance=difference;}
  }
  return best;
}

function reduceColors(records,candidates,settings,progress) {
  const count=settings.maxColors;
  if (!count) return candidates;
  const weights=new Map();
  for (const record of records.values()) weights.set(record.color.code,(weights.get(record.color.code)||0)+record.count*(1+record.edge));
  const used=candidates.filter(color=>weights.has(color.code));
  if (used.length+settings.lockedCodes.filter(code=>!weights.has(code)).length<=count) return candidates.filter(color=>weights.has(color.code)||settings.lockedCodes.includes(color.code));
  // Weighted facility-location greedy selection over actual used palette colors.
  // Frequency and squared perceptual merge error both contribute; boundary samples
  // get additional weight. All cells are subsequently rematched to the chosen set.
  const pool=candidates.filter(color=>weights.has(color.code)||settings.lockedCodes.includes(color.code));
  const costs=pool.map(color=>Float64Array.from(used,target=>deltaE2000(color.lab,target.lab)**2));
  const selected=new Set();
  const best=new Float64Array(used.length).fill(Infinity);
  const add = index => {
    selected.add(index);
    for (let j=0;j<best.length;j++) best[j]=Math.min(best[j],costs[index][j]);
  };
  for (let i=0;i<pool.length;i++) if (settings.lockedCodes.includes(pool[i].code)) add(i);
  while (selected.size<count && selected.size<pool.length) {
    let winner=-1,least=Infinity;
    for (let i=0;i<pool.length;i++) {
      if (selected.has(i)) continue;
      let cost=0;
      for (let j=0;j<used.length;j++) cost+=Math.min(best[j],costs[i][j])*weights.get(used[j].code);
      if (cost<least) {least=cost;winner=i;}
    }
    add(winner);
    progress(.8+.1*selected.size/count);
  }
  // A forward greedy center can become redundant once later colors are chosen.
  // Refine by bounded best swaps, preserving every locked color. In particular,
  // a red-dominated image must not spend two slots on red and lose yellow.
  const objective=chosen=>{
    let total=0;for(let j=0;j<used.length;j++){
      let least=Infinity;for(const index of chosen)least=Math.min(least,costs[index][j]);
      total+=least*weights.get(used[j].code);
    }return total;
  };
  for(let pass=0;pass<8;pass++){
    let bestCost=objective(selected),remove=-1,insert=-1;
    for(const current of [...selected].sort((a,b)=>a-b)){
      if(settings.lockedCodes.includes(pool[current].code))continue;
      const others=new Float64Array(used.length).fill(Infinity);
      for(const index of selected)if(index!==current)for(let j=0;j<used.length;j++)others[j]=Math.min(others[j],costs[index][j]);
      for(let candidate=0;candidate<pool.length;candidate++){
        if(selected.has(candidate))continue;let cost=0;
        for(let j=0;j<used.length;j++)cost+=Math.min(others[j],costs[candidate][j])*weights.get(used[j].code);
        if(cost<bestCost-1e-9){bestCost=cost;remove=current;insert=candidate;}
      }
    }
    if(remove<0)break;selected.delete(remove);selected.add(insert);
  }
  return pool.filter((_,i)=>selected.has(i));
}

// cache is private working data for this same source image; the UI runner binds
// it to the original image object and never persists it or sends it to a server.
export function convertImage(image,options,palette,progress=()=>{},cache=null) {
  const {settings,candidates,matte}=validate(image,options,palette);
  if (typeof progress!=='function') throw new TypeError('进度回调必须是函数');
  progress(0);
  const sample=sampler(image,settings,matte);
  const key=JSON.stringify({sourceWidth:image.width,sourceHeight:image.height,...settings,maxColors:undefined,lockedCodes:undefined,candidateCodes:undefined});
  const fingerprint=paletteFingerprint(palette),candidateKey=candidates.map(color=>color.code).join(',');
  const validRgb=rgb=>rgb===null || (Array.isArray(rgb)&&rgb.length===3&&rgb.every(n=>Number.isFinite(n)&&n>=0&&n<=255));
  const reusedSamples=Boolean(cache?.key===key && Array.isArray(cache.sampled) && cache.sampled.length===settings.width*settings.height
    && cache.sampled.every(validRgb) && Array.isArray(cache.edges) && cache.edges.length===cache.sampled.length && cache.edges.every(n=>Number.isFinite(n)&&n>=0&&n<=1));
  const candidateMap=new Map(candidates.map(color=>[color.code,color]));
  const reusedMatches=Boolean(reusedSamples && cache.fingerprint===fingerprint && cache.candidateKey===candidateKey && Array.isArray(cache.matched)
    && cache.matched.length===cache.sampled.length && cache.matched.every((code,index)=>cache.sampled[index]===null?code===null:candidateMap.has(code)));
  const sampled=new Array(settings.width*settings.height).fill(null);
  const edges=new Array(sampled.length).fill(0);
  const cellRecords=new Array(sampled.length).fill(null);
  const records=new Map();
  // Separate sample and palette caches: repeated solid colors need one Lab conversion
  // and one nearest-color scan, regardless of how many cells contain that color.
  for (let y=0;y<settings.height;y++) {
    for (let x=0;x<settings.width;x++) {
      const index=y*settings.width+x;
      const result=reusedSamples?(cache.sampled[index]===null?null:{rgb:cache.sampled[index],edge:cache.edges[index]}):sample(x,y);
      if (!result) continue;
      sampled[index]=result.rgb;
      edges[index]=result.edge;
      const key=result.rgb.map(channel=>channel.toFixed(5)).join(',');
      let record=records.get(key);
      if (!record) {
        const lab=rgbToLab(result.rgb);
        record={lab,color:reusedMatches?candidateMap.get(cache.matched[index]):nearest(lab,candidates),count:0,edge:0};
        records.set(key,record);
      }
      record.count++;record.edge+=result.edge;
      cellRecords[index]=record;
    }
    progress(.8*(y+1)/settings.height);
  }
  const matched=cellRecords.map(record=>record?.color.code??null);
  for (const record of records.values()) record.edge/=record.count;
  const subset=reduceColors(records,candidates,settings,progress);
  if (subset.length!==candidates.length) for (const record of records.values()) record.color=nearest(record.lab,subset);
  progress(.95);
  const cells=cellRecords.map(record=>record?.color.code??null);
  const stats=patternStats(cells);
  progress(1);
  return {width:settings.width,height:settings.height,cells,settings,stats,sampled,reusedSamples,reusedMatches,
    cache:{key,fingerprint,candidateKey,sampled,edges,matched}};
}
