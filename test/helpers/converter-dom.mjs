import { createConverter } from '../../public/converter-ui.mjs';
import { convertImage } from '../../public/convert-core.mjs';

// Browser-only decoding, drawing and worker transport are replaced at their
// boundary. Converter event handlers and the conversion itself remain real.
export async function converterDOM(t) {
  const nodes=[],workers=[],imports=[];
  class Element {
    constructor(tag) {
      this.tagName=tag;this.children=[];this.handlers={};this.open=false;this.disabled=false;
      this.style={setProperty(){}};this.classList={toggle(){},add(){}};nodes.push(this);
    }
    set value(value){this.storedValue=String(value);}
    get value(){return this.storedValue??(this.tagName==='select'?this.children[0]?.value:'')??'';}
    setAttribute(){}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);}
    async emit(type,values={}) {
      const event={button:0,pointerId:1,preventDefault(){},...values};
      for(const handler of this.handlers[type]||[])await handler(event);
    }
    showModal(){this.open=true;}
    close(){this.open=false;void this.emit('close');}
    focus(){}
    scrollIntoView(){}
    setPointerCapture(){}
    getBoundingClientRect(){return {left:0,top:0,width:380,height:380};}
    getContext(){return {drawImage(){},putImageData(){},getImageData(){return {data:new Uint8ClampedArray(8*8*4).fill(255)};}};}
  }
  const globals={
    document:{createElement:tag=>new Element(tag),body:new Element('body')},
    window:{addEventListener(){}},matchMedia:()=>({matches:false}),
    requestAnimationFrame:()=>0,cancelAnimationFrame(){},
    ResizeObserver:class {observe(){}},
    ImageData:class {constructor(data,width,height){Object.assign(this,{data,width,height});}},
    createImageBitmap:async()=>({width:8,height:8,close(){}}),
    Worker:class {
      constructor(){workers.push(this);}
      postMessage(input){this.input=structuredClone(input);}
      terminate(){this.stopped=true;}
    },
    fetch:async(url,options)=>{imports.push({url,options});throw new Error('unexpected test import');},
  };
  const descriptors=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  t.after(()=>{for(const [key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const palette=[{code:'A1',hex:'#FFFFFF',name:'White'}];
  const converter=createConverter({getContext:()=>({roomId:'test-room',key:'unused-test-key',canvasId:'old',epoch:0,
    ready:true,canImport:true,board:{width:8,height:8,palette}}),onImported(){}});
  const byId=id=>nodes.find(node=>node.id===id);
  const byText=text=>nodes.find(node=>node.textContent===text);
  converter.open();
  // An actual 8x8 white RGBA PNG; pixels returned by the Canvas boundary agree.
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAD0lEQVR4nGP4TwAwjAwFAIS1/wF0QtmAAAAAAElFTkSuQmCC','base64');
  byId('convert-file').files=[{size:bytes.length,name:'white.png',arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}];
  await byId('convert-file').emit('change');
  const complete=async()=>{
    await byText('生成预览').emit('click');const worker=workers.at(-1);
    const result=convertImage(worker.input.image,worker.input.settings,worker.input.palette);
    worker.onmessage({data:{id:worker.input.id,type:'result',result}});return result;
  };
  await complete();
  return {byId,byText,imports,complete,surface:nodes.find(node=>node.className==='converter-surface')};
}
