const sessionName = 'bead-room-session-v1';
const keyPattern = /^[a-f0-9]{48}$/;
const normalizedCode = value => value.trim().toUpperCase();

export function createRoomUI({onEnter, canSwitch, notify}) {
  const $ = id => document.getElementById(id);
  let current = null, busy = false;
  function remember() {
    try {
      if (current) sessionStorage.setItem(sessionName, JSON.stringify(current));
      else sessionStorage.removeItem(sessionName);
    } catch { /* Private browsing can disable storage; this session still works. */ }
  }
  function mode(create) {
    $('join-form').hidden = create; $('room-create-form').hidden = !create;
    $('room-join-tab').setAttribute('aria-selected', String(!create));
    $('room-create-tab').setAttribute('aria-selected', String(create));
  }
  function loading(value) {
    busy = value;
    for (const id of ['room-join-submit','room-create-submit','room-dialog-close','room-join-tab','room-create-tab','invite-code-submit']) $(id).disabled = value;
  }
  async function request(path, body, key) {
    const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json', ...(key ? {Authorization:`Bearer ${key}`} : {})}, body:JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '房间操作失败，请重试');
    if (!keyPattern.test(result.key) || !result.room?.id || typeof result.room.name !== 'string') throw new Error('房间返回信息无效，请刷新后重试');
    return result;
  }
  function permit() {
    if (canSwitch()) return true;
    notify('请等待当前修改保存或导出完成，再切换房间'); return false;
  }
  async function submit(event, create) {
    event.preventDefault();
    if (busy || !permit()) return;
    const error = $(create ? 'room-create-error' : 'join-error'); error.textContent = '';
    const code = normalizedCode($(create ? 'room-create-code' : 'room-input').value);
    loading(true);
    try {
      const result = await request(create ? '/api/rooms' : '/api/rooms/join', create ? {name:$('room-create-name').value.trim(), code} : {code});
      if (!permit()) return;
      current = {...result, code}; remember();
      $('join-dialog').close(); $('room-dialog-close').hidden = false;
      history.replaceState(null, '', location.pathname || '/');
      onEnter(current);
    } catch (cause) { error.textContent = cause.message || '连接失败，请检查网络后重试'; }
    finally { loading(false); }
  }
  function open() {
    if (busy || !permit()) return;
    $('join-error').textContent = ''; $('room-create-error').textContent = '';
    $('room-dialog-close').hidden = !current;
    mode(false);
    if (!$('join-dialog').open) $('join-dialog').showModal();
  }
  function renderInvite() {
    if (!current) return;
    $('invite-copy-text').value = ''; $('invite-copy-text').classList.add('copy-fallback');
    const known = !!current.code;
    $('invite-url').value = `${location.origin}/`;
    $('invite-code-value').value = current.code || '尚未显示';
    $('invite-code-display').hidden = !known;
    $('invite-code-form').hidden = known;
    $('copy-code').disabled = !known; $('copy-link').disabled = !known;
    $('invite-code-label').textContent = current.room?.hasInvite ? '输入此房间的邀请码，验证后显示' : '为原有房间设置邀请码';
    $('invite-code-submit').textContent = current.room?.hasInvite ? '验证邀请码' : '保存邀请码';
    $('invite-note').textContent = ['localhost','127.0.0.1','[::1]'].includes(location.hostname)
      ? '这是本机地址。邀请手机或朋友时，请先启动穿透，在公网网站中打开此房间，再复制邀请说明。邀请码不随网址改变。'
      : '朋友打开网站后输入邀请码即可加入。电脑和穿透服务需保持运行；网址变化后邀请码仍然有效。';
  }
  function showInvite() {
    if (!current) return;
    renderInvite(); $('invite-error').textContent = '';
    if (!$('invite-dialog').open) $('invite-dialog').showModal();
  }
  async function copy(value, field, message) {
    try { await navigator.clipboard.writeText(value); notify(message); }
    catch {field.classList.remove('copy-fallback');field.focus();field.select();notify('请复制已选中的内容');}
  }
  $('room-join-tab').addEventListener('click', () => mode(false));
  $('room-create-tab').addEventListener('click', () => mode(true));
  $('join-form').addEventListener('submit', event => submit(event, false));
  $('room-create-form').addEventListener('submit', event => submit(event, true));
  $('room-button').addEventListener('click', open);
  $('room-dialog-close').addEventListener('click', () => {if (!busy && current) $('join-dialog').close();});
  $('join-dialog').addEventListener('cancel', event => {if (busy || !current) event.preventDefault();});
  $('room-generate-code').addEventListener('click', () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', bytes = crypto.getRandomValues(new Uint8Array(12));
    $('room-create-code').value = Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
  });
  $('invite-button').addEventListener('click', showInvite);
  $('invite-close').addEventListener('click', () => {if (!busy) $('invite-dialog').close();});
  $('invite-dialog').addEventListener('cancel', event => {if (busy) event.preventDefault();});
  $('copy-site').addEventListener('click', () => copy($('invite-url').value, $('invite-url'), '网站地址已复制'));
  $('copy-code').addEventListener('click', () => {if (current?.code) copy(current.code, $('invite-code-value'), '邀请码已复制');});
  $('copy-link').addEventListener('click', () => {
    if (!current?.code) return;
    const text = `一起来「${current.room.name}」拼豆\n网站：${location.origin}/\n邀请码：${current.code}\n打开网站，选择“加入房间”并输入邀请码。`;
    $('invite-copy-text').value = text;
    copy(text, $('invite-copy-text'), '网站地址和邀请码已复制，可以发给朋友');
  });
  $('invite-code-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!current || busy) return;
    const code = normalizedCode($('invite-code-input').value), session = current;
    $('invite-error').textContent = ''; loading(true);
    try {
      const result = await request(current.room?.hasInvite ? '/api/rooms/join' : '/api/rooms/invite', {code}, current.key);
      if (current !== session) return;
      if (result.key !== current.key) throw new Error('这个邀请码不是当前房间的邀请码');
      current = {...result, code}; remember(); renderInvite();
    } catch (error) {
      $('invite-error').textContent = error.message;
      if (error.message.includes('已经设置')) { current.room.hasInvite = true; remember(); renderInvite(); }
    } finally { loading(false); }
  });
  return {
    open, showInvite,
    restore() {
      try {
        const saved = JSON.parse(sessionStorage.getItem(sessionName));
        if (saved && keyPattern.test(saved.key) && saved.room && typeof saved.room.name === 'string') {
          current = {...saved, code:typeof saved.code === 'string' && /^[A-Z0-9_-]{8,32}$/.test(saved.code) ? saved.code : ''};
        }
      } catch {}
      const hash = location.hash.slice(1);
      if (keyPattern.test(hash) && current?.key !== hash) current = {key:hash, code:'', room:{id:'legacy', name:'原有房间', hasInvite:false}};
      if (current) {
        remember(); history.replaceState(null, '', location.pathname || '/');
      }
      return current;
    },
    update(room) {
      if (!current || !room) return;
      current.room = room; remember(); $('room-name').textContent = room.name;
      if ($('invite-dialog').open) renderInvite();
    },
    unauthorized(message) {
      current = null; remember(); open(); $('join-error').textContent = message;
    },
  };
}
