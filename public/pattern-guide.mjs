// A guide describes the paper beneath the beans. It never supplies occupancy.
export function hasGuide(reference) {
  return reference?.schema===2 && Number.isInteger(reference.width) && Number.isInteger(reference.height)
    && reference.width>=8 && reference.width<=256 && reference.height>=8 && reference.height<=256
    && Array.isArray(reference.cells) && reference.cells.length===reference.width*reference.height;
}

export function guideCode(reference,index,boardWidth) {
  if(!hasGuide(reference) || !Number.isInteger(index) || index<0 || !Number.isInteger(boardWidth) || boardWidth<reference.width)return null;
  const x=index%boardWidth,y=Math.floor(index/boardWidth);
  return x<reference.width && y<reference.height ? reference.cells[y*reference.width+x] : null;
}

// Copy a stable export. Expanded space stays empty; no source coordinate shifts.
export function guidePattern(board,reference) {
  const width=board.width??board.size,height=board.height??board.size;
  const cells=hasGuide(reference)
    ? Array.from({length:width*height},(_,index)=>guideCode(reference,index,width))
    : board.cells.map(cell=>cell.color===null?null:(board.palette[cell.color].code||`旧${cell.color+1}`));
  return {width,height,cells};
}
