export const COLOR_GROUPS = [
  ['A','黄橙肤色'], ['B','绿色'], ['C','蓝青色'], ['D','紫色'], ['E','粉色'],
  ['F','红色'], ['G','棕大地色'], ['H','黑白灰'], ['M','莫兰迪'],
  ['P','P 扩展'], ['T','T 扩展'], ['R','R 扩展'], ['Y','Y 扩展'], ['Q','Q 扩展'], ['ZG','ZG 扩展'],
];

export function paletteEntries(palette, group = '', query = '') {
  const text = query.trim().toUpperCase().replace(/^([A-Z]+)0+(\d+)$/, '$1$2');
  const isCode = /^(?:[A-HMPQRTY]|ZG)\d+$/.test(text);
  return palette.map((color, index) => ({color, index})).filter(({color}) => !color.legacy
    && (!group || color.group === group)
    && (!text || (isCode ? color.code?.startsWith(text)
      : [color.code, color.hex, color.name].some(value => value?.toUpperCase().includes(text)))));
}
