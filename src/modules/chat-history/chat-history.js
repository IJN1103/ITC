import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getDatabase, ref, get, query, orderByKey, endBefore, limitToLast } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCOpAaGDNbfFy7pETmKA6Y2wUf2oj1wQRY',
  authDomain: 'project-itc-2d34d.firebaseapp.com',
  databaseURL: 'https://project-itc-2d34d-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'project-itc-2d34d',
  storageBucket: 'project-itc-2d34d.firebasestorage.app',
  messagingSenderId: '89572142319',
  appId: '1:89572142319:web:fbeb6c7bb8bf279dd0bf1a'
};

const params = new URLSearchParams(location.search);
const roomCode = String(params.get('room') || '').trim();
const initialType = ['global', 'casual', 'dm'].includes(params.get('type')) ? params.get('type') : 'global';
const PAGE_SIZE = 100;
const SCAN_SIZE = 320;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const listEl = document.getElementById('history-list');
const loadBtn = document.getElementById('load-older');
const statusEl = document.getElementById('history-status');
const countEl = document.getElementById('history-count');
const emptyEl = document.getElementById('history-empty');
const loadingEl = document.getElementById('history-loading');
const errorEl = document.getElementById('history-error');
const titleEl = document.getElementById('history-title');
const tabButtons = [...document.querySelectorAll('[data-history-tab]')];

let currentUser = null;
let activeType = initialType;
let switching = false;
const participantProfiles = new Map();
const states = {
  global: { cursorKey: '', exhausted: false, loading: false, entries: [], keys: new Set() },
  casual: { cursorKey: '', exhausted: false, loading: false, entries: [], keys: new Set() },
  dm: { cursorKey: '', exhausted: true, loading: false, entries: [], keys: new Set() }
};

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
function fmtText(value) {
  let s = esc(value);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*(.+?)\*/g, '<i>$1</i>');
  return s.replace(/\n/g, '<br>');
}
function messageTime(record) {
  const value = Number(record?.time || record?.timestamp || 0);
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(date);
}
function visibleGlobal(record) {
  const channel = record?.dmChannelKey;
  if (!(channel == null || channel === '' || channel === 'global')) return false;
  if (record?.type !== 'whisper') return true;
  const uid = String(currentUser?.uid || '');
  return String(record?.uid || '') === uid || String(record?.whisperTo || '') === uid;
}
function resolveAvatar(record) {
  const direct = String(record?.speakAsAvatar || record?.avatar || '').trim();
  if (direct) return direct;
  const uid = String(record?.uid || '').trim();
  return uid ? String(participantProfiles.get(uid)?.avatar || '').trim() : '';
}
function createMessage(record, key) {
  const article = document.createElement('article');
  article.className = `history-message type-${String(record?.type || 'normal').replace(/[^a-z0-9_-]/gi, '')}`;
  article.dataset.key = key;
  const profile = participantProfiles.get(String(record?.uid || '')) || {};
  const name = record?.name || profile.name || '이름 없음';
  const type = record?.type || 'normal';
  let tag = '';
  if (type === 'whisper') {
    tag = String(record?.uid || '') === String(currentUser?.uid || '')
      ? `→ ${esc(record?.whisperToName || '?')}에게 귓말`
      : '→ 나에게 귓말';
  }
  const avatar = resolveAvatar(record);
  const avatarHtml = avatar
    ? `<img class="history-avatar" src="${esc(avatar)}" alt="">`
    : `<div class="history-avatar fallback">${esc(name.slice(0,1).toUpperCase() || '?')}</div>`;
  const isImage = type === 'image' || type === 'speak-as-image';
  const body = isImage
    ? `<img class="history-image" src="${esc(record?.text || '')}" alt="채팅 이미지" loading="lazy">`
    : `<div class="history-text">${fmtText(record?.text || '')}</div>`;
  article.innerHTML = `${avatarHtml}<div class="history-body"><div class="history-meta"><strong style="${record?.nameColor ? `color:${esc(record.nameColor)}` : ''}">${esc(name)}</strong>${tag ? `<span class="history-tag">${tag}</span>` : ''}<time>${esc(messageTime(record))}</time></div>${body}</div>`;
  return article;
}
function setError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || '';
}
function currentState() { return states[activeType]; }
function labelFor(type) {
  if (type === 'casual') return '잡담 기록';
  if (type === 'dm') return 'DM 기록';
  return '일반 채팅 기록';
}
function updateUi() {
  const state = currentState();
  const dmPending = activeType === 'dm';
  countEl.textContent = `${state.entries.length}개 표시`;
  emptyEl.hidden = dmPending || state.entries.length > 0 || state.loading;
  loadingEl.hidden = !state.loading;
  loadBtn.hidden = dmPending;
  loadBtn.disabled = state.loading || state.exhausted;
  loadBtn.textContent = state.exhausted ? '가장 오래된 기록입니다' : (state.loading ? '불러오는 중…' : '이전 기록 100개 불러오기');
  statusEl.textContent = labelFor(activeType);
  tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.historyTab === activeType));
}
function renderActive() {
  listEl.innerHTML = '';
  const state = currentState();
  if (activeType === 'dm') {
    const placeholder = document.createElement('div');
    placeholder.className = 'history-dm-placeholder';
    placeholder.innerHTML = '<strong>DM 기록</strong><br><span>접근 가능한 DM 방 목록과 기록은 다음 단계에서 연결됩니다.</span>';
    listEl.appendChild(placeholder);
    updateUi();
    return;
  }
  const fragment = document.createDocumentFragment();
  state.entries.forEach(([key, record]) => fragment.appendChild(createMessage(record, key)));
  listEl.appendChild(fragment);
  updateUi();
}
async function verifyAccess(user) {
  if (!roomCode) throw new Error('방 코드가 없습니다.');
  const [playerSnap, metaSnap] = await Promise.all([
    get(ref(db, `rooms/${roomCode}/players/${user.uid}`)),
    get(ref(db, `rooms/${roomCode}/meta`))
  ]);
  const ownerId = String(metaSnap.val()?.ownerId || '');
  if (!playerSnap.exists() && ownerId !== user.uid) throw new Error('이 세션 방의 채팅 기록을 볼 권한이 없습니다.');
}
async function loadParticipantProfiles() {
  const [playersSnap, avatarsSnap] = await Promise.all([
    get(ref(db, `rooms/${roomCode}/players`)),
    get(ref(db, `rooms/${roomCode}/avatars`)).catch(() => null)
  ]);
  const players = playersSnap.val() || {};
  const avatars = avatarsSnap?.val?.() || {};
  Object.entries(players).forEach(([uid, player]) => {
    const p = player || {};
    const roomAvatar = avatars?.[uid];
    const avatar = String(p.avatarUrl || p.avatar || roomAvatar?.avatarUrl || roomAvatar?.avatar || roomAvatar || '').trim();
    participantProfiles.set(String(uid), { name: String(p.name || ''), avatar });
  });
}
async function fetchCasualPage(state) {
  const base = ref(db, `rooms/${roomCode}/casual`);
  const q = state.cursorKey ? query(base, orderByKey(), endBefore(state.cursorKey), limitToLast(PAGE_SIZE)) : query(base, orderByKey(), limitToLast(PAGE_SIZE));
  const snap = await get(q);
  const entries = Object.entries(snap.val() || {});
  if (entries.length) state.cursorKey = entries[0][0];
  state.exhausted = entries.length < PAGE_SIZE;
  return entries.map(([key, value]) => [key, value || {}]);
}
async function fetchGlobalPage(state) {
  const base = ref(db, `rooms/${roomCode}/chat`);
  const collected = [];
  let scanCursor = state.cursorKey;
  let reachedEnd = false;
  for (let attempt = 0; attempt < 12 && collected.length < PAGE_SIZE && !reachedEnd; attempt += 1) {
    const q = scanCursor ? query(base, orderByKey(), endBefore(scanCursor), limitToLast(SCAN_SIZE)) : query(base, orderByKey(), limitToLast(SCAN_SIZE));
    const snap = await get(q);
    const entries = Object.entries(snap.val() || {});
    if (!entries.length) { reachedEnd = true; break; }
    scanCursor = entries[0][0];
    for (let i = entries.length - 1; i >= 0 && collected.length < PAGE_SIZE; i -= 1) {
      const [key, value] = entries[i];
      const record = value || {};
      if (visibleGlobal(record)) collected.push([key, record]);
    }
    if (entries.length < SCAN_SIZE) reachedEnd = true;
  }
  state.cursorKey = scanCursor || state.cursorKey;
  state.exhausted = reachedEnd;
  return collected.reverse();
}
async function loadPage(initial = false) {
  const state = currentState();
  if (activeType === 'dm' || state.loading || state.exhausted) return;
  state.loading = true;
  setError('');
  updateUi();
  const anchor = !initial ? listEl.firstElementChild : null;
  const anchorTop = anchor?.getBoundingClientRect().top || 0;
  try {
    const entries = activeType === 'casual' ? await fetchCasualPage(state) : await fetchGlobalPage(state);
    const fresh = entries.filter(([key]) => !state.keys.has(key));
    fresh.forEach(([key]) => state.keys.add(key));
    state.entries = initial ? fresh : [...fresh, ...state.entries];
    renderActive();
    if (!initial && anchor) {
      const same = listEl.querySelector(`[data-key="${CSS.escape(anchor.dataset.key || '')}"]`);
      if (same) window.scrollBy(0, same.getBoundingClientRect().top - anchorTop);
    }
  } catch (err) {
    console.error('[chat-history] load failed', err);
    setError(err?.message || '기록을 불러오지 못했습니다.');
  } finally {
    state.loading = false;
    updateUi();
  }
}
async function switchType(nextType) {
  if (!['global', 'casual', 'dm'].includes(nextType) || switching) return;
  switching = true;
  activeType = nextType;
  const nextParams = new URLSearchParams(location.search);
  nextParams.set('type', nextType);
  history.replaceState(null, '', `${location.pathname}?${nextParams.toString()}`);
  setError('');
  renderActive();
  const state = currentState();
  if (nextType !== 'dm' && !state.entries.length && !state.loading) await loadPage(true);
  switching = false;
}

loadBtn.addEventListener('click', () => loadPage(false));
tabButtons.forEach(btn => btn.addEventListener('click', () => switchType(btn.dataset.historyTab)));
window.addEventListener('scroll', () => {
  const state = currentState();
  if (activeType === 'dm' || state.loading || state.exhausted) return;
  if (window.scrollY <= 48) loadPage(false);
}, { passive: true });

try {
  const channel = new BroadcastChannel('itc_theme_sync');
  channel.onmessage = (event) => {
    const theme = event?.data?.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  };
} catch (e) {}

function applyAvatarShape(value) {
  const shape = value === 'circle' ? 'circle' : 'rounded';
  document.documentElement.setAttribute('data-avatar-shape', shape);
}
applyAvatarShape(localStorage.getItem('itc_avatar_shape'));
window.addEventListener('storage', (event) => {
  if (event.key === 'itc_avatar_shape') applyAvatarShape(event.newValue);
});

titleEl.textContent = '전체 기록';
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    statusEl.textContent = '로그인 필요';
    setError('로그인 상태를 확인할 수 없습니다. 메인 사이트에 로그인한 뒤 다시 열어 주세요.');
    return;
  }
  currentUser = user;
  try {
    await verifyAccess(user);
    await loadParticipantProfiles();
    statusEl.textContent = '기록 불러오는 중';
    renderActive();
    if (activeType !== 'dm') await loadPage(true);
  } catch (err) {
    statusEl.textContent = '접근 불가';
    setError(err?.message || '기록 접근 권한을 확인하지 못했습니다.');
  }
});
