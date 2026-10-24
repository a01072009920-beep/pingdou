import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { rgbToLab, deltaE2000, contrastText } from '../public/color-science.mjs';
import { paletteFingerprint, colorCodeCompare, patternStats } from '../public/pattern-data.mjs';
import { convertImage } from '../public/convert-core.mjs';
import { PALETTE, COMPATIBLE_PALETTE } from '../src/palette.mjs';

const palette = [
  { code:'H1', hex:'#FFFFFF' }, { code:'H2', hex:'#000000' },
  { code:'F1', hex:'#FF0000' }, { code:'C1', hex:'#0000FF' },
  { code:'H3', hex:'#BCBCBC' }, { code:'H4', hex:'#808080' },
  { code:'E1', hex:'#FFBCBC' }, { code:'D1', hex:'#BC00BB' },
];
const settings = {width:8, height:8, mode:'nearest'};
function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) data.set(pixel(x,y), (y*width+x)*4);
  return {width,height,data};
}
const solid = (rgba=[255,255,255,255]) => image(8,8,()=>rgba);
const nearly = (actual,want,tolerance=0.0001) => assert.ok(Math.abs(actual-want)<tolerance, `${actual} != ${want}`);

test('three-color reduction retains the three broad source hues instead of two redundant red shades',()=>{
  const flower=image(96,96,(x,y)=>{
    if((x-48)**2+(y-48)**2<105)return [244,215,56,255];
    for(const [px,py]of [[30,48],[65,48],[48,29],[48,66]])if((x-px)**2+(y-py)**2<170)return [252,40,60,255];
    if(x>44&&x<52&&y>65&&y<91)return [62,174,124,255];
    if((x-31)**2/196+(y-79)**2/49<1)return [62,174,124,255];
    return [255,255,255,0];
  });
  const result=convertImage(flower,{width:80,height:80,mode:'cartoon',maxColors:3},PALETTE);
  assert.deepEqual(result.stats.items.map(item=>item.code),['A5','B7','F4']);
  assert.equal(result.stats.total,1808);
});

test('sampling and full-palette matches can be reused for color-limit edits without changing output',()=>{
  const original=image(16,16,(x,y)=>[x*16,y*16,100,255]);
  const first=convertImage(original,{width:16,height:16,mode:'smooth'},PALETTE);
  assert.ok(first.cache,'completed conversion carries its reusable sampling and nearest-match cache');
  const settings={width:16,height:16,mode:'smooth',maxColors:3};
  const warm=convertImage(original,settings,PALETTE,()=>{},first.cache);
  const cold=convertImage(original,settings,PALETTE);
  assert.deepEqual(warm.cells,cold.cells);
  assert.equal(warm.reusedSamples,true);
  assert.equal(warm.reusedMatches,true);
  const changed=convertImage(original,{...settings,mode:'nearest'},PALETTE,()=>{},first.cache);
  assert.equal(changed.reusedSamples,false);
});

test('sRGB D65 Lab and WCAG text contrast distinguish white, black and saturated red', () => {
  rgbToLab([255,255,255]).forEach((v,i)=>nearly(v,[100,0,0][i],0.02));
  rgbToLab([255,0,0]).forEach((v,i)=>nearly(v,[53.2408,80.0925,67.2032][i],0.02));
  assert.deepEqual(rgbToLab([0,0,0]),[0,0,0]);
  assert.equal(contrastText('#FFFFFF'),'#000000');
  assert.equal(contrastText('#000000'),'#FFFFFF');
  assert.equal(contrastText('#FF0000'),'#000000');
  assert.throws(()=>rgbToLab([256,0,0]));
  assert.throws(()=>contrastText('white'));
});

// Published numerical reference data, not implementation code:
// G. Sharma, W. Wu, E. N. Dalal (2005), supplementary Table 1.
// https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt
const sharma = [
  [50,2.6772,-79.7751,50,0,-82.7485,2.0425],
  [50,3.1571,-77.2803,50,0,-82.7485,2.8615],
  [50,2.8361,-74.0200,50,0,-82.7485,3.4412],
  [50,-1.3802,-84.2814,50,0,-82.7485,1],
  [50,-1.1848,-84.8006,50,0,-82.7485,1],
  [50,-.9009,-85.5211,50,0,-82.7485,1],
  [50,0,0,50,-1,2,2.3669], [50,-1,2,50,0,0,2.3669],
  [50,2.49,-.001,50,-2.49,.0009,7.1792],
  [50,2.49,-.001,50,-2.49,.001,7.1792],
  [50,2.49,-.001,50,-2.49,.0011,7.2195],
  [50,2.49,-.001,50,-2.49,.0012,7.2195],
  [50,-.001,2.49,50,.0009,-2.49,4.8045],
  [50,-.001,2.49,50,.001,-2.49,4.8045],
  [50,-.001,2.49,50,.0011,-2.49,4.7461],
  [50,2.5,0,50,0,-2.5,4.3065],
  [50,2.5,0,73,25,-18,27.1492],
  [50,2.5,0,61,-5,29,22.8977],
  [50,2.5,0,56,-27,-3,31.903],
  [50,2.5,0,58,24,15,19.4535],
  [50,2.5,0,50,3.1736,.5854,1],
  [50,2.5,0,50,3.2972,0,1],
  [50,2.5,0,50,1.8634,.5757,1],
  [50,2.5,0,50,3.2592,.335,1],
  [60.2574,-34.0099,36.2677,60.4626,-34.1751,39.4387,1.2644],
  [63.0109,-31.0961,-5.8663,62.8187,-29.7946,-4.0864,1.263],
  [61.2901,3.7196,-5.3901,61.4292,2.248,-4.962,1.8731],
  [35.0831,-44.1164,3.7933,35.0232,-40.0716,1.5901,1.8645],
  [22.7233,20.0904,-46.694,23.0331,14.973,-42.5619,2.0373],
  [36.4612,47.858,18.3852,36.2715,50.5065,21.2231,1.4146],
  [90.8027,-2.0831,1.441,91.1528,-1.6435,.0447,1.4441],
  [90.9257,-.5406,-.9208,88.6381,-.8985,-.7239,1.5381],
  [6.7747,-.2908,-2.4247,5.8714,-.0985,-2.2286,.6377],
  [2.0776,.0795,-1.135,.9033,-.0636,-.5514,.9082],
];
test('CIEDE2000 matches all 34 Sharma pairs including hue discontinuities in either direction',()=> {
  for (const row of sharma) {
    nearly(deltaE2000(row.slice(0,3),row.slice(3,6)),row[6]);
    nearly(deltaE2000(row.slice(3,6),row.slice(0,3)),row[6]);
  }
  assert.equal(deltaE2000([23,8,-11],[23,8,-11]),0);
  assert.throws(()=>deltaE2000([NaN,0,0],[0,0,0]));
});

test('pattern stats count nonempty cells and use established MARD group / numerical order',()=> {
  assert.deepEqual(patternStats(['ZG2','R2','P11','P2','H1',null,'A10','A2','R2']),{
    total:8,colors:7,items:[{code:'A2',count:1},{code:'A10',count:1},{code:'H1',count:1},
      {code:'P2',count:1},{code:'P11',count:1},{code:'R2',count:2},{code:'ZG2',count:1}],
  });
  assert.deepEqual(['Q1','Y1','R1','T1','P1'].sort(colorCodeCompare),['P1','T1','R1','Y1','Q1']);
  assert.throws(()=>patternStats(['A1',undefined]));
});

test('fingerprint ignores legacy, normalizes hex and detects order or adjusted colors',()=> {
  assert.equal(paletteFingerprint(PALETTE),paletteFingerprint(COMPATIBLE_PALETTE));
  assert.equal(paletteFingerprint(palette),paletteFingerprint(palette.map(c=>({...c,hex:c.hex.toLowerCase()}))));
  assert.notEqual(paletteFingerprint(palette),paletteFingerprint([...palette].reverse()));
  assert.notEqual(paletteFingerprint(palette),paletteFingerprint(palette.map((c,i)=>i?c:{...c,hex:'#FFFFFE'})));
});

test('all exact nonlegacy MARD hexes rematch, ties follow authoritative palette order',()=> {
  for (const color of PALETTE) {
    const rgba = color.hex.slice(1).match(/../g).map(v=>parseInt(v,16));
    const expected = PALETTE.find(c=>c.hex===color.hex).code;
    assert.equal(convertImage(solid([...rgba,255]),settings,COMPATIBLE_PALETTE).cells[0],expected);
  }
});

test('transparent pixels stay empty, opaque white remains a bean, source RGBA is immutable',()=> {
  const input = image(8,8,(x)=>x<4?[255,0,0,0]:[255,255,255,255]);
  const before = input.data.slice();
  for (const mode of ['nearest','smooth','cartoon']) {
    const result=convertImage(input,{...settings,mode},palette);
    assert.equal(result.cells[0],null);
    assert.equal(result.cells[4],'H1');
    assert.equal(result.stats.total,32);
  }
  assert.deepEqual(input.data,before);
});

test('fit preserves aspect ratio and centers horizontal and vertical blank padding',()=> {
  for (const [w,h] of [[2,1],[1,2]]) {
    const result=convertImage(image(w,h,()=>[255,0,0,255]),settings,palette);
    assert.equal(result.stats.total,32);
    assert.equal(result.cells[0],null);
    assert.equal(result.cells[2*8+2],'F1');
    assert.equal(result.cells[7*8+7],null);
  }
});

test('nearest alpha threshold and linear-light matte compositing use actual visible alpha',()=> {
  assert.equal(convertImage(solid([255,0,0,127]),settings,palette).stats.total,0);
  assert.equal(convertImage(solid([255,0,0,128]),{...settings,matte:'#0000FF'},palette).cells[0],'D1');
  assert.equal(convertImage(solid([255,0,0,25]),{...settings,coverage:.1},palette).stats.total,0);
});

test('smooth uses linear-light area and alpha weighting instead of encoded RGB or invisible RGB',()=> {
  const checker=image(16,16,x=>x%2?[0,0,0,255]:[255,255,255,255]);
  assert.equal(convertImage(checker,{...settings,mode:'smooth'},palette).cells[0],'H3');
  const transparent=image(16,16,x=>x%2?[0,0,255,0]:[255,0,0,255]);
  assert.equal(convertImage(transparent,{...settings,mode:'smooth'},palette).cells[0],'E1');
  assert.equal(convertImage(transparent,{...settings,mode:'smooth',coverage:.6},palette).stats.total,0);
});

test('smooth integrates fractional pixel areas rather than rounded sample windows',()=> {
  const input=image(12,12,x=>x===0?[255,255,255,255]:[0,0,0,255]);
  const custom=[{code:'H1',hex:'#D5D5D5'},{code:'H2',hex:'#BCBCBC'}];
  assert.equal(convertImage(input,{...settings,mode:'smooth'},custom).cells[0],'H1');
});

test('cartoon uses a region dominant color and adjustable dark-contour protection',()=> {
  const input=image(24,24,x=>x%3===1?[0,0,0,255]:[255,255,255,255]);
  assert.equal(convertImage(input,{...settings,mode:'nearest'},palette).cells[0],'H2');
  assert.equal(convertImage(input,{...settings,mode:'cartoon',contourStrength:0},palette).cells[0],'H1');
  assert.equal(convertImage(input,{...settings,mode:'cartoon',contourStrength:1},palette).cells[0],'H2');
  assert.notEqual(convertImage(input,{...settings,mode:'smooth'},palette).cells[0],'H2');
});

test('crop selects decoded image coordinates and remains a centered proportional fit',()=> {
  const input=image(16,8,x=>x<8?[255,0,0,255]:[0,0,255,255]);
  const result=convertImage(input,{...settings,crop:{x:8,y:0,width:8,height:8}},palette);
  assert.equal(result.stats.total,64);
  assert.deepEqual(new Set(result.cells),new Set(['C1']));
});

test('reduction rematches every bean, honors locks and candidates, and is deterministic',()=> {
  const input=image(8,8,(x)=>x<4?[255,0,0,255]:[0,0,255,255]);
  const reduced=convertImage(input,{...settings,maxColors:1},palette);
  assert.equal(reduced.stats.colors,1);
  assert.equal(reduced.stats.total,64);
  assert.deepEqual(reduced,convertImage(input,{...settings,maxColors:1},palette));
  assert.deepEqual(new Set(convertImage(input,{...settings,maxColors:1,lockedCodes:['C1']},palette).cells),new Set(['C1']));
  assert.deepEqual(new Set(convertImage(input,{...settings,candidateCodes:['H2']},palette).cells),new Set(['H2']));
  assert.throws(()=>convertImage(input,{...settings,maxColors:1,lockedCodes:['C1','F1']},palette));
  assert.throws(()=>convertImage(input,{...settings,candidateCodes:['F1'],lockedCodes:['C1']},palette));
  assert.throws(()=>convertImage(input,{...settings,candidateCodes:[]},palette));
  assert.throws(()=>convertImage(input,{...settings,lockedCodes:['NO1']},palette));
});

test('reduction considers color merge error as well as frequency',()=> {
  const input=image(8,8,(x,y)=>y===0?[0,0,255,255]:x<4?[255,0,0,255]:[254,1,0,255]);
  const close=[{code:'F1',hex:'#FF0000'},{code:'F2',hex:'#FE0100'},{code:'C1',hex:'#0000FF'}];
  const result=convertImage(input,{...settings,maxColors:2},close);
  assert.ok(result.cells.includes('C1'),'rare distant blue must beat a second virtually identical red');
  assert.equal(result.stats.colors,2);
  assert.equal(result.stats.total,64);
});

test('independent bounds reject malformed grids, inputs, settings and palette',()=> {
  for (const invalid of [{width:7},{height:257},{width:8.1},{mode:'unknown'},{coverage:0},{coverage:.91},
    {matte:'red'},{maxColors:-1},{maxColors:292},{contourStrength:1.1},
    {crop:{x:-1,y:0,width:8,height:8}},{crop:{x:0,y:0,width:9,height:8}}]) {
    assert.throws(()=>convertImage(solid(),{...settings,...invalid},palette),JSON.stringify(invalid));
  }
  assert.throws(()=>convertImage({width:4001,height:4000,data:[]},settings,palette));
  assert.throws(()=>convertImage({width:8,height:8,data:new Uint8ClampedArray(4)},settings,palette));
  assert.throws(()=>convertImage(solid(),settings,[{code:'H1',hex:'#FFFFFF',legacy:true}]));
  assert.throws(()=>convertImage(solid(),settings,[...palette,palette[0]]));
  assert.throws(()=>convertImage(solid(),settings,[{code:'H1',hex:'white'}]));
  assert.equal(convertImage(solid(),{...settings,width:256,height:256},palette).cells.length,65536);
});

test('conversion reports monotonic bounded progress and returns immutable parameter snapshot',()=> {
  const events=[];
  const inputSettings={...settings,lockedCodes:[],candidateCodes:['H1']};
  const result=convertImage(solid(),inputSettings,palette,p=>events.push(p));
  assert.equal(events[0],0);
  assert.equal(events.at(-1),1);
  assert.ok(events.every((v,i)=>v>=0 && v<=1 && (!i || v>=events[i-1])));
  inputSettings.candidateCodes.push('H2');
  assert.deepEqual(result.settings.candidateCodes,['H1']);
});

test('actual worker routes progress, result and validation errors with matching task ids',async()=> {
  const workerUrl=new URL('../public/convert-worker.mjs',import.meta.url).href;
  const source=`import {parentPort} from 'node:worker_threads';
    globalThis.self={postMessage:value=>parentPort.postMessage(value)};
    await import(${JSON.stringify(workerUrl)});
    parentPort.on('message',data=>self.onmessage({data}));`;
  const worker=new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`));
  try {
    const messages=[];
    const done=new Promise((resolve,reject)=>{
      worker.on('error',reject);
      worker.on('message',message=>{messages.push(message);if(message.type==='result')resolve(message);});
    });
    worker.postMessage({id:'one',image:solid(),settings,palette});
    const {result}=await done;
    assert.equal(result.stats.total,64);
    assert.ok(messages.some(m=>m.type==='progress'));
    assert.ok(messages.every(m=>m.id==='one'));
    const error=new Promise(resolve=>worker.once('message',resolve));
    worker.postMessage({id:'bad',image:solid(),settings:{width:1,height:8},palette});
    const failure=await error;
    assert.equal(failure.id,'bad');
    assert.equal(failure.type,'error');
    assert.equal(typeof failure.message,'string');
  } finally {await worker.terminate();}
});
