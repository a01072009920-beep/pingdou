const GROUPS = ['A','B','C','D','E','F','G','H','M','P','T','R','Y','Q','ZG'];
const CODE = /^([A-Z]+)([1-9]\d{0,3})$/;

export function colorCodeCompare(a,b) {
  const parse = code => {
    const match = typeof code==='string' && CODE.exec(code);
    if (!match || !GROUPS.includes(match[1])) throw new TypeError('无效的 MARD 色号');
    return [GROUPS.indexOf(match[1]),Number(match[2])];
  };
  const left=parse(a), right=parse(b);
  return left[0]-right[0] || left[1]-right[1];
}

export function patternStats(cells) {
  if (!Array.isArray(cells) || cells.length>256*256) throw new TypeError('图案格子必须为最多 65536 项的数组');
  const counts = new Map();
  let total=0;
  for (const code of cells) {
    if (code===null) continue;
    colorCodeCompare(code,code);
    counts.set(code,(counts.get(code)||0)+1);
    total++;
  }
  return {total,colors:counts.size,items:[...counts].sort(([a],[b])=>colorCodeCompare(a,b)).map(([code,count])=>({code,count}))};
}

// FNV-1a is only a deterministic mismatch checksum; never use as authentication.
export function paletteFingerprint(palette) {
  if (!Array.isArray(palette) || palette.length>1024) throw new TypeError('无效色表');
  let hash=0x811c9dc5;
  for (const color of palette) {
    if (color?.legacy) continue;
    colorCodeCompare(color?.code,color?.code);
    if (typeof color.hex!=='string' || !/^#[a-f\d]{6}$/i.test(color.hex)) throw new TypeError('无效色表颜色');
    const text=`${color.code}:${color.hex.toUpperCase()}\n`;
    for (let i=0;i<text.length;i++) hash=Math.imul(hash^text.charCodeAt(i),0x01000193)>>>0;
  }
  return `mard-fnv1a-${hash.toString(16).padStart(8,'0')}`;
}
