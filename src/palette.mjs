import source from './mard-palette.json' with { type: 'json' };

// Source and local reference-color adjustments: ../vendor/makebead/README.md
const groups = ['A','B','C','D','E','F','G','H','M','P','T','R','Y','Q','ZG'];
const overrides = { B7:'#3EAE7C', D5:'#B34EC6', H1:'#FFFFFF', H4:'#868686' };
export const PALETTE = Object.freeze(source
  .map(color => ({ ...color, hex: overrides[color.code] || color.hex }))
  .sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group)
    || Number(a.code.slice(a.group.length)) - Number(b.code.slice(b.group.length)))
  .map(Object.freeze));

export const LEGACY_PALETTE = Object.freeze([
  ['雪白', '#FFFFFF'], ['奶油', '#FFF1BD'], ['柠檬', '#FFE16A'], ['橘子', '#F7A34B'],
  ['珊瑚', '#F27969'], ['草莓', '#E94E62'], ['玫红', '#C93775'], ['樱粉', '#F6B7CE'],
  ['浅紫', '#C5B2EA'], ['葡萄', '#8A6BC1'], ['海蓝', '#4168BA'], ['晴空', '#6CA6DE'],
  ['冰蓝', '#B6DCE9'], ['薄荷', '#A8D8C0'], ['青草', '#66AA75'], ['森林', '#367866'],
  ['青柠', '#B8CB69'], ['沙色', '#DDC394'], ['焦糖', '#B98760'], ['可可', '#79564A'],
  ['雾灰', '#CCD3D9'], ['岩灰', '#8C99A8'], ['深蓝', '#344C68'], ['墨黑', '#252D39'],
].map(([name, hex]) => Object.freeze({ name, hex })));

export const COMPATIBLE_PALETTE = Object.freeze([...PALETTE,
  ...LEGACY_PALETTE.map(color => Object.freeze({...color, legacy:true}))]);

export function matchesPalette(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((color, i) => color && ['name','hex','code','group','legacy']
      .every(field => color[field] === expected[i][field]));
}

export function upgradeLegacyBoard(board) {
  if (!matchesPalette(board.palette, LEGACY_PALETTE)) return board;
  return { ...board, palette:COMPATIBLE_PALETTE.map(color => ({...color})),
    cells:board.cells.map(cell => ({...cell, color:cell.color === null ? null : PALETTE.length + cell.color})) };
}
