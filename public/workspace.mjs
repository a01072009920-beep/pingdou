export function initWorkspace({beforeLayout}) {
  const $ = id => document.getElementById(id);
  const narrow = matchMedia('(max-width:760px), (max-width:1000px) and (orientation:portrait)');
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem('bead-workspace-v1')) || {}; } catch {}
  if (!preferences || typeof preferences !== 'object') preferences = {};
  let explicit = typeof preferences.paletteOpen === 'boolean';
  let paletteOpen = explicit ? preferences.paletteOpen : false;
  let focus = preferences.focus === true;
  function render() {
    $('palette-panel').hidden = !paletteOpen;
    $('app-root').classList.toggle('palette-collapsed', !paletteOpen);
    $('app-root').classList.toggle('focus-mode', focus);
    $('palette-toggle').setAttribute('aria-expanded', String(paletteOpen));
    $('palette-toggle').setAttribute('aria-label', paletteOpen ? '收起色盘' : '展开色盘');
    $('focus-toggle').setAttribute('aria-pressed', String(focus));
    $('focus-toggle').textContent = focus ? '退出专注' : '专注';
  }
  function remember() {
    try {localStorage.setItem('bead-workspace-v1', JSON.stringify({...(explicit ? {paletteOpen} : {}), focus}));} catch {}
  }
  function palette(value) {
    if (!beforeLayout()) return;
    explicit = true; paletteOpen = value; render(); remember();
    if (!value) $('palette-toggle').focus({preventScroll:true});
  }
  $('palette-toggle').addEventListener('click', () => palette(!paletteOpen));
  $('palette-close').addEventListener('click', () => palette(false));
  $('focus-toggle').addEventListener('click', () => {
    if (!beforeLayout()) return;
    focus = !focus; render(); remember();
  });
  narrow.addEventListener('change', () => {if (!explicit && beforeLayout()) {paletteOpen = false; render();}});
  render();
}
