/**
 * ITC TRPG — Firebase 헬퍼
 * DB 경로 상수와 래퍼 함수를 한 곳에서 관리합니다.
 * 새 기능에서 Firebase를 쓸 때 window._FB 직접 구조분해 대신 이 헬퍼를 사용하세요.
 *
 * 사용 예:
 *   await dbUpdate(DB_PATHS.chat(rc), { text: '...' });
 *   const snap = await dbGet(DB_PATHS.mapState(rc));
 */

// ── DB 경로 상수 ──────────────────────────────────────────
window.DB_PATHS = Object.freeze({
  // 방 루트
  room:           (rc) => `rooms/${rc}`,
  meta:           (rc) => `rooms/${rc}/meta`,
  players:        (rc) => `rooms/${rc}/players`,
  player:         (rc, uid) => `rooms/${rc}/players/${uid}`,

  // 채팅
  chat:           (rc) => `rooms/${rc}/chat`,
  chatMsg:        (rc, key) => `rooms/${rc}/chat/${key}`,
  casual:         (rc) => `rooms/${rc}/casual`,
  dmChats:        (rc) => `rooms/${rc}/dmChats`,
  dmChannel:      (rc, ch) => `rooms/${rc}/dmChats/${ch}`,
  dmMessages:     (rc, ch) => `rooms/${rc}/dmChats/${ch}/messages`,
  dmMessageIndex: (rc) => `rooms/${rc}/dmMessageIndex`,
  typing:         (rc) => `rooms/${rc}/typing`,

  // 맵
  mapState:       (rc) => `rooms/${rc}/mapState`,
  mapLayerState:  (rc) => `rooms/${rc}/mapLayerState`,
  mapObjects:     (rc) => `rooms/${rc}/mapObjects`,
  mapScenes:      (rc) => `rooms/${rc}/mapScenes`,
  tokens:         (rc) => `rooms/${rc}/tokens`,
  token:          (rc, id) => `rooms/${rc}/tokens/${id}`,

  // BGM / 리소스
  bgm:            (rc) => `rooms/${rc}/bgm`,
  cutins:         (rc) => `rooms/${rc}/cutins`,
  cutin:          (rc, id) => `rooms/${rc}/cutins/${id}`,

  // 저널 / 핸드아웃
  journals:       (rc) => `rooms/${rc}/journals`,
  journal:        (rc, id) => `rooms/${rc}/journals/${id}`,
  handouts:       (rc) => `rooms/${rc}/handouts`,
  handout:        (rc, id) => `rooms/${rc}/handouts/${id}`,
  characters:     (rc) => `rooms/${rc}/characters`,
  character:      (rc, uid) => `rooms/${rc}/characters/${uid}`,

  // 기타
  avatars:        (rc) => `rooms/${rc}/avatars`,
  avatar:         (rc, uid) => `rooms/${rc}/avatars/${uid}`,
  lastRoll:       (rc) => `rooms/${rc}/lastRoll`,
});

// ── Firebase 상태 확인 ────────────────────────────────────
function _fbReady() {
  return !!(window._FB?.CONFIGURED && window.St?.roomCode);
}

function _fbRef(path) {
  if (!window._FB?.CONFIGURED) return null;
  return window._FB.ref(window._FB.db, path);
}

// ── 래퍼 함수 ─────────────────────────────────────────────

/**
 * Firebase 경로에 데이터를 업데이트합니다. (멀티패스 가능)
 * @param {string} path  - DB_PATHS.xxx(rc) 결과
 * @param {object} data  - 업데이트할 필드
 */
window.dbUpdate = async function(path, data) {
  if (!_fbReady()) return null;
  return window._FB.update(_fbRef(path), data);
};

/**
 * Firebase 경로에 데이터를 덮어씁니다.
 */
window.dbSet = async function(path, data) {
  if (!_fbReady()) return null;
  return window._FB.set(_fbRef(path), data);
};

/**
 * Firebase 경로에 새 자식을 push합니다.
 * @returns {string|null} 생성된 key
 */
window.dbPush = async function(path, data) {
  if (!_fbReady()) return null;
  const ref = window._FB.push(_fbRef(path));
  await window._FB.set(ref, data);
  return ref.key;
};

/**
 * Firebase 경로의 데이터를 한 번 읽습니다.
 * @returns {any} val() 결과 또는 null
 */
window.dbGet = async function(path) {
  if (!window._FB?.CONFIGURED) return null;
  const snap = await window._FB.get(_fbRef(path));
  return snap.exists() ? snap.val() : null;
};

/**
 * Firebase 경로의 데이터를 삭제합니다.
 */
window.dbRemove = async function(path) {
  if (!_fbReady()) return null;
  return window._FB.remove(_fbRef(path));
};

/**
 * 루트 기준 멀티패스 업데이트 (기존 `update(ref(db), payload)` 대체)
 * @param {object} payload - { 'rooms/rc/path': value, ... }
 */
window.dbMultiUpdate = async function(payload) {
  if (!window._FB?.CONFIGURED) return null;
  return window._FB.update(window._FB.ref(window._FB.db), payload);
};

/**
 * 현재 서버 타임스탬프를 반환합니다.
 */
window.dbTimestamp = function() {
  return window._FB?.serverTimestamp?.() ?? Date.now();
};
