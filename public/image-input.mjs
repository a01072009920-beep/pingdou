export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;

export function detectImageType(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length >= 8 && [137,80,78,71,13,10,26,10].every((byte,i) => data[i] === byte)) return 'image/png';
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  return null;
}

export function validateImageFile(file, bytes) {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('图片为空，请重新选择。');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片超过 10 MiB，请缩小后再选择。');
  const type = detectImageType(bytes);
  if (!type) throw new Error('请选择有效的 PNG 或 JPEG 图片，修改后缀不能转换格式。');
  return type;
}

export function validateImageDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error('图片尺寸无效或文件已损坏。');
  if (width * height > MAX_IMAGE_PIXELS) throw new Error('原图超过 1600 万像素，请缩小后再选择。');
  return {width,height};
}

export function imageHeaderDimensions(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const type = detectImageType(data);
  const view = new DataView(data.buffer,data.byteOffset,data.byteLength);
  if (type === 'image/png') {
    if (data.length < 24 || String.fromCharCode(...data.subarray(12,16)) !== 'IHDR') throw new Error('PNG 文件头不完整或已损坏。');
    return validateImageDimensions(view.getUint32(16),view.getUint32(20));
  }
  if (type === 'image/jpeg') {
    let offset=2;
    while (offset < data.length) {
      if (data[offset++] !== 255) throw new Error('JPEG 文件已损坏。');
      while (data[offset] === 255) offset++;
      const marker=data[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset+2 > data.length) break;
      const length=view.getUint16(offset);
      if (length < 2 || offset+length > data.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 8) break;
        return validateImageDimensions(view.getUint16(offset+5),view.getUint16(offset+3));
      }
      offset+=length;
    }
    throw new Error('JPEG 文件头不完整或已损坏。');
  }
  throw new Error('请选择有效的 PNG 或 JPEG 图片。');
}

export function normalizeCrop(crop, width, height) {
  validateImageDimensions(width,height);
  if (crop === null || crop === undefined) return null;
  if (!['x','y','width','height'].every(key => Number.isFinite(crop[key]))) throw new Error('裁剪范围无效。');
  const x=Math.max(0,Math.min(width-1,Math.round(crop.x)));
  const y=Math.max(0,Math.min(height-1,Math.round(crop.y)));
  return {x,y,width:Math.max(1,Math.min(width-x,Math.round(crop.width))),height:Math.max(1,Math.min(height-y,Math.round(crop.height)))};
}

// Original bytes and the decoded sRGB pixels stay in this browser. A bad replacement
// throws before the caller swaps its last valid image or finished draft.
export async function readLocalImage(file) {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    validateImageFile(file || {size:0},new Uint8Array());
  }
  const bytes=new Uint8Array(await file.arrayBuffer());
  const type=validateImageFile(file,bytes);
  imageHeaderDimensions(bytes);
  const blob=new Blob([bytes],{type});
  let decoded, objectUrl;
  try {
    if (typeof createImageBitmap === 'function') decoded=await createImageBitmap(blob,{imageOrientation:'from-image',colorSpaceConversion:'default'});
    else {
      objectUrl=URL.createObjectURL(blob);
      decoded=await new Promise((resolve,reject) => {
        const image=new Image(); image.onload=()=>resolve(image); image.onerror=()=>reject(new Error('图片无法解码，请换一张完整的 PNG 或 JPEG。')); image.src=objectUrl;
      });
    }
    const {width,height}=validateImageDimensions(decoded.width || decoded.naturalWidth,decoded.height || decoded.naturalHeight);
    const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});
    if (!ctx) throw new Error('浏览器无法读取图片，请换用新版浏览器。');
    ctx.drawImage(decoded,0,0,width,height);
    const data=ctx.getImageData(0,0,width,height).data;
    canvas.width=canvas.height=1;
    return {width,height,data};
  } catch (error) {
    if (/1600|尺寸|浏览器/.test(error.message)) throw error;
    throw new Error('图片无法解码，请换一张完整的 PNG 或 JPEG。');
  } finally { decoded?.close?.(); if(objectUrl) URL.revokeObjectURL(objectUrl); }
}
