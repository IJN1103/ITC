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
const historyType = params.get('type') === 'casual' ? 'casual' : 'global';
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
const errorEl = document.getElementById('history-error');
const titleEl = document.getElementById('history-title');
let currentUser = null;
let cursorKey = '';
let exhausted = false;
let loading = false;
let totalRendered = 0;

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
function createMessage(record, key) {
  const article = document.createElement('article');
  article.className = `history-message type-${esc(record?.type || 'normal')}`;
  article.dataset.key = key;
  const name = record?.name || '이름 없음';
  const type = record?.type || 'normal';
  let tag = '';
  if (type === 'whisper') {
    tag = String(record?.uid || '') === String(currentUser?.uid || '')
      ? `→ ${esc(record?.whisperToName || '?')}에게 귓말`
      : '→ 나에게 귓말';
  }
  const avatar = String(record?.speakAsAvatar || '').trim();
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
function updateUi() {
  countEl.textContent = `${totalRendered}개 표시`;
  emptyEl.hidden = totalRendered > 0 || loading;
  loadBtn.disabled = loading || exhausted;
  loadBtn.textContent = exhausted ? '가장 오래된 기록입니다' : (loading ? '불러오는 중…' : '이전 기록 100개 불러오기');
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
async function fetchCasualPage() {
  const base = ref(db, `rooms/${roomCode}/casual`);
  const q = cursorKey ? query(base, orderByKey(), endBefore(cursorKey), limitToLast(PAGE_SIZE)) : query(base, orderByKey(), limitToLast(PAGE_SIZE));
  const snap = await get(q);
  const entries = Object.entries(snap.val() || {});
  if (entries.length) cursorKey = entries[0][0];
  exhausted = entries.length < PAGE_SIZE;
  return entries.map(([key, value]) => [key, value || {}]);
}
async function fetchGlobalPage() {
  const base = ref(db, `rooms/${roomCode}/chat`);
  const collected = [];
  let scanCursor = cursorKey;
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
  cursorKey = scanCursor || cursorKey;
  exhausted = reachedEnd;
  return collected.reverse();
}
async function loadPage(initial = false) {
  if (loading || exhausted) return;
  loading = true; setError(''); updateUi();
  try {
    const entries = historyType === 'casual' ? await fetchCasualPage() : await fetchGlobalPage();
    const fragment = document.createDocumentFragment();
    entries.forEach(([key, record]) => fragment.appendChild(createMessage(record, key)));
    if (initial) listEl.appendChild(fragment); else listEl.prepend(fragment);
    totalRendered += entries.length;
    statusEl.textContent = historyType === 'casual' ? '잡담 기록' : '일반 채팅 기록';
  } catch (err) {
    console.error('[chat-history] load failed', err);
    setError(err?.message || '기록을 불러오지 못했습니다.');
  } finally {
    loading = false; updateUi();
  }
}

loadBtn.addEventListener('click', () => loadPage(false));
titleEl.textContent = historyType === 'casual' ? '전체 잡담 기록' : '전체 일반 채팅 기록';
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    statusEl.textContent = '로그인 필요';
    setError('로그인 상태를 확인할 수 없습니다. 메인 사이트에 로그인한 뒤 다시 열어 주세요.');
    return;
  }
  currentUser = user;
  try {
    await verifyAccess(user);
    statusEl.textContent = '기록 불러오는 중';
    await loadPage(true);
  } catch (err) {
    statusEl.textContent = '접근 불가';
    setError(err?.message || '기록 접근 권한을 확인하지 못했습니다.');
  }
});
