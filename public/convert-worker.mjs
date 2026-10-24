import { convertImage } from './convert-core.mjs';

self.onmessage = ({data}) => {
  const {id,image,settings,palette,cache}=data??{};
  try {
    const result=convertImage(image,settings,palette,progress=>self.postMessage({id,type:'progress',progress}),cache);
    self.postMessage({id,type:'result',result});
  } catch (error) {
    self.postMessage({id,type:'error',message:error instanceof Error ? error.message : '图片转换失败'});
  }
};
