// sRGB / D65 and CIEDE2000, independently implemented from their equations.
// Numerical reference: Sharma, Wu & Dalal (2005), DOI 10.1002/col.20070.
const RAD = Math.PI / 180;
const POW25 = 25 ** 7;

export function hexToRgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) throw new TypeError('颜色必须为 #RRGGBB');
  return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
}

export function srgbToLinear(value) {
  const channel = value / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}

export function linearToSrgb(value) {
  const channel = Math.min(1,Math.max(0,value));
  return 255 * (channel <= .0031308 ? 12.92 * channel : 1.055 * channel ** (1/2.4) - .055);
}

export function rgbToLab(rgb) {
  const values = Array.isArray(rgb) || ArrayBuffer.isView(rgb) ? Array.from(rgb) : [rgb?.r,rgb?.g,rgb?.b];
  if (values.length !== 3 || values.some(v=>!Number.isFinite(v) || v<0 || v>255)) throw new TypeError('RGB 分量必须在 0–255 之间');
  const [r,g,b] = values.map(srgbToLinear);
  const f = value => value > (6/29)**3 ? Math.cbrt(value) : value / (3*(6/29)**2) + 4/29;
  const x = f((.4124564*r + .3575761*g + .1804375*b) / .95047);
  const y = f(.2126729*r + .7151522*g + .0721750*b);
  const z = f((.0193339*r + .1191920*g + .9503041*b) / 1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}

export function deltaE2000(lab1,lab2) {
  if (![lab1,lab2].every(lab=>lab?.length===3 && Array.from(lab).every(Number.isFinite))) throw new TypeError('Lab 分量必须为有限数值');
  const [l1,a1,b1] = lab1, [l2,a2,b2] = lab2;
  const c1 = Math.hypot(a1,b1), c2 = Math.hypot(a2,b2);
  const cMean7 = ((c1+c2)/2)**7;
  const g = .5*(1-Math.sqrt(cMean7/(cMean7+POW25)));
  const ap1 = (1+g)*a1, ap2 = (1+g)*a2;
  const cp1 = Math.hypot(ap1,b1), cp2 = Math.hypot(ap2,b2);
  const hue = (a,b) => (Math.atan2(b,a)/RAD + 360)%360;
  const h1 = cp1===0 ? 0 : hue(ap1,b1), h2 = cp2===0 ? 0 : hue(ap2,b2);
  const dl = l2-l1, dc = cp2-cp1;
  let dh = h2-h1;
  if (cp1*cp2===0) dh=0;
  else if (dh>180) dh-=360;
  else if (dh< -180) dh+=360;
  const dH = 2*Math.sqrt(cp1*cp2)*Math.sin(dh*RAD/2);
  const lm = (l1+l2)/2, cm = (cp1+cp2)/2;
  let hm = h1+h2;
  if (cp1*cp2!==0) {
    if (Math.abs(h1-h2)<=180) hm/=2;
    else hm=(hm+(hm<360 ? 360 : -360))/2;
  }
  const t = 1-.17*Math.cos((hm-30)*RAD)+.24*Math.cos(2*hm*RAD)
    + .32*Math.cos((3*hm+6)*RAD)-.20*Math.cos((4*hm-63)*RAD);
  const sl = 1+.015*(lm-50)**2/Math.sqrt(20+(lm-50)**2);
  const sc = 1+.045*cm, sh = 1+.015*cm*t;
  const rc = 2*Math.sqrt(cm**7/(cm**7+POW25));
  const rt = -rc*Math.sin(60*Math.exp(-(((hm-275)/25)**2))*RAD);
  const x=dl/sl, y=dc/sc, z=dH/sh;
  return Math.sqrt(Math.max(0,x*x+y*y+z*z+rt*y*z));
}

export function contrastText(hex) {
  const [r,g,b] = hexToRgb(hex).map(srgbToLinear);
  const luminance = .2126*r+.7152*g+.0722*b;
  return (luminance+.05)/.05 >= 1.05/(luminance+.05) ? '#000000' : '#FFFFFF';
}
