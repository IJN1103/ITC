const St = {
  roomCode: '', system: 'coc7', myName: '', myId: '',
  tokens: {}, playlist: [], currentTrack: -1, isPlaying: false,
  tool: 'select', character: {}, recentRooms: [],
  selectedCharId: null,
  isGM: false,
  descMode: false,
  whisperTo: null,
  whisperToName: null,
  whisperToJournal: null,
  myNameColor: '',
  players: {},
  avatarShape: localStorage.getItem('itc_avatar_shape') || 'rounded',
};

/* 권한 체크 헬퍼 */
var _allJournals = [];
function requireGM(action) {
  if (!St.isGM) {
    showToast('GM만 사용할 수 있는 기능이에요.');
    return false;
  }
  return true;
}

function setAvatarShape(shape) {
  St.avatarShape = shape;
  localStorage.setItem('itc_avatar_shape', shape);
  updateShapeBtns();

  const r = shape === 'circle' ? '50%' : '6px';

  document.querySelectorAll('.msg-avatar').forEach(el => {
    el.classList.remove('shape-circle', 'shape-rounded');
    el.classList.add(shape === 'circle' ? 'shape-circle' : 'shape-rounded');
  });
  document.querySelectorAll('.msg-avatar-inner').forEach(el => {
    el.style.borderRadius = r;
  });
  document.querySelectorAll('.msg-avatar img').forEach(el => {
    el.style.borderRadius = r;
  });

  showToast(shape === 'circle' ? '원형으로 변경됐어요' : '둥근 네모로 변경됐어요');
}

function updateShapeBtns() {
  const shape = St.avatarShape;
  const btnR = document.getElementById('shape-btn-rounded');
  const btnC = document.getElementById('shape-btn-circle');
  if (!btnR || !btnC) return;
  const on  = 'border-color:var(--accent);background:var(--a-dim);color:var(--accent)';
  const off = 'border-color:var(--border);background:var(--s2);color:var(--dim)';
  [btnR, btnC].forEach((btn, i) => {
    const isActive = (i === 0 && shape === 'rounded') || (i === 1 && shape === 'circle');
    btn.style.borderColor  = isActive ? 'var(--accent)' : 'var(--border)';
    btn.style.background   = isActive ? 'var(--a-dim)'  : 'var(--s2)';
    btn.style.color        = isActive ? 'var(--accent)' : 'var(--dim)';
  });
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
      background:var(--s3);border:1px solid var(--border2);border-radius:var(--r);
      padding:9px 18px;font-size:13px;color:var(--dim);z-index:999;
      animation:fadeUp .2s ease;pointer-events:none;white-space:nowrap`;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 2200);
}

const SYS_LABELS = { coc7:'CoC 7판', dx3:'더블크로스 3rd', shinobigami:'시노비가미', insane:'인세인' };



function switchRightTab(tab) {
  _activeRightTab = tab;
  document.querySelectorAll('.rtab').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.right-pane').forEach(p => p.classList.remove('on'));
  document.getElementById('rtab-' + tab).classList.add('on');
  document.getElementById('rpane-' + tab).classList.add('on');
  const shared = document.getElementById('shared-input-area');
  if (shared) shared.style.display = (tab === 'journal') ? 'none' : '';
  const saWrap = document.getElementById('speak-as-wrap');
  const casualBar = document.getElementById('casual-nick-bar');
  const colorWrap = document.getElementById('sa-color-wrap');
  const descBtn = document.getElementById('desc-toggle-btn');
  const whisperWrap = document.getElementById('whisper-wrap');
  if (tab === 'casual') {
    if (saWrap) saWrap.style.display = 'none';
    if (casualBar) { casualBar.style.display = 'flex'; refreshCasualNickDisplay(); }
    if (colorWrap) colorWrap.style.display = 'none';
    if (descBtn) descBtn.style.display = 'none';
    if (whisperWrap) whisperWrap.style.display = 'none';
  } else {
    if (saWrap) saWrap.style.display = '';
    if (casualBar) casualBar.style.display = 'none';
    if (colorWrap) colorWrap.style.display = '';
    if (descBtn) descBtn.style.display = hasPerm('sendDesc') ? '' : 'none';
    if (whisperWrap) whisperWrap.style.display = '';
  }
  if (typeof refreshChatActionButtons === 'function') refreshChatActionButtons();
  if (tab === 'journal') renderJournalList();
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function addMsgActions(div, uid, msgKey, channel, text, type) {
  if (!msgKey) return;
  if (type === 'system' || type === 'sys') return;
  const isMine = uid === St.myId;
  const isGM = St.isGM;
  if (!isMine && !isGM) return;
  div.dataset.msgKey = msgKey;
  div.dataset.channel = channel;
  div.dataset.msgText = text;
  const wrap = document.createElement('div');
  wrap.className = 'msg-actions';
  const canEdit = type !== 'dice' && type !== 'image' && type !== 'speak-as-image';
  if (canEdit && isMine) {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-act-btn';
    editBtn.textContent = '수정';
    editBtn.onclick = (e) => { e.stopPropagation(); editMsg(div); };
    wrap.appendChild(editBtn);
  }
  const delBtn = document.createElement('button');
  delBtn.className = 'msg-act-btn danger';
  delBtn.textContent = '삭제';
  delBtn.onclick = (e) => { e.stopPropagation(); deleteMsg(div); };
  wrap.appendChild(delBtn);
  div.appendChild(wrap);
}

function editMsg(div) {
  const key = div.dataset.msgKey;
  const channel = div.dataset.channel || 'chat';
  const oldText = div.dataset.msgText || '';
  const textEl = div.querySelector('.msg-text');
  if (!textEl || textEl.contentEditable === 'true') return;

  textEl.textContent = oldText;
  textEl.contentEditable = 'true';
  textEl.classList.add('editing');
  textEl.focus();

  const range = document.createRange();
  range.selectNodeContents(textEl);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finishEdit() {
    textEl.contentEditable = 'false';
    textEl.classList.remove('editing');
    const newText = textEl.textContent.trim();
    if (!newText) { textEl.innerHTML = fmtText(oldText); showToast('빈 메시지는 입력할 수 없어요.'); return; }
    if (newText === oldText) { textEl.innerHTML = fmtText(oldText); return; }
    div.dataset.msgText = newText;
    textEl.innerHTML = fmtText(newText);
    if (window._FB?.CONFIGURED) {
      const { db, ref, update } = window._FB;
      update(ref(db, `rooms/${St.roomCode}/${channel}/${key}`), { text: newText, edited: true });
    }
  }

  textEl.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(); }
    if (e.key === 'Escape') { textEl.innerHTML = fmtText(oldText); textEl.contentEditable = 'false'; textEl.classList.remove('editing'); }
  };
  textEl.onblur = () => finishEdit();
}

function deleteMsg(div) {
  const key = div.dataset.msgKey;
  const channel = div.dataset.channel || 'chat';
  if (!confirm('이 메시지를 삭제할까요?')) return;
  if (window._FB?.CONFIGURED) {
    const { db, ref, remove } = window._FB;
    remove(ref(db, `rooms/${St.roomCode}/${channel}/${key}`));
  }
}

function fmtText(str) {
  let s = esc(str);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<i>$1</i>');
  s = s.replace(/\*(.+?)\*/g, '<b>$1</b>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.innerWidth < 700) {
    const brand = document.querySelector('.auth-brand');
    if (brand) brand.style.display = 'none';
  }
  initAuthScreen();
});

window.addEventListener('load', () => {
  try {
    if (typeof refreshChatActionButtons === 'function') refreshChatActionButtons();
  } catch (e) {}
});
