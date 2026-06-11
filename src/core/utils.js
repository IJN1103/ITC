/**
 * ITC TRPG — 공통 유틸리티
 * 여러 모듈에서 독자 구현하던 함수를 한 곳으로 통합합니다.
 *
 * 전역 노출:
 *   ITC_ESC(str)          — HTML 이스케이프 (XSS 방지)
 *   ITC_DEBOUNCE(fn, ms)  — 디바운스 래퍼
 *   ITC_THROTTLE(fn, ms)  — 스로틀 래퍼
 *   ITC_CLAMP(v, min, max) — 값 범위 제한
 *   ITC_PICK(obj, keys)   — 객체 필드 선택
 */

// ── HTML 이스케이프 ───────────────────────────────────────
// 기존: esc() in v1-core.js, escHtml() in popout.js,
//        escapeHtml() in cocofolia-import.js, dm-ui.js
// → 모두 ITC_ESC 로 통일. 기존 함수는 기존 파일에서 유지 (하위 호환)
const _ESC_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;' };
window.ITC_ESC = function(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => _ESC_MAP[c]);
};

// ── 디바운스 ──────────────────────────────────────────────
// 기존: clearTimeout(_timer); _timer = setTimeout(...) 패턴 9개 파일
// → ITC_DEBOUNCE로 통일. 새 코드에서 사용, 기존 코드는 점진적 교체
/**
 * @param {Function} fn
 * @param {number} ms - 대기 시간 (ITC_CONFIG.TIMING 상수 권장)
 * @returns {Function} 디바운스된 함수 (cancel 메서드 포함)
 */
window.ITC_DEBOUNCE = function(fn, ms) {
  let timer = 0;
  function debounced(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; fn.apply(this, args); }, ms);
  }
  debounced.cancel = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  return debounced;
};

// ── 스로틀 ───────────────────────────────────────────────
/**
 * @param {Function} fn
 * @param {number} ms - 최소 호출 간격
 * @returns {Function} 스로틀된 함수
 */
window.ITC_THROTTLE = function(fn, ms) {
  let last = 0;
  return function(...args) {
    const now = Date.now();
    if (now - last < ms) return;
    last = now;
    return fn.apply(this, args);
  };
};

// ── 값 범위 제한 ─────────────────────────────────────────
window.ITC_CLAMP = function(v, min, max) {
  return Math.max(min, Math.min(max, v));
};

// ── 객체 필드 선택 ───────────────────────────────────────
window.ITC_PICK = function(obj, keys) {
  const out = {};
  keys.forEach(k => { if (k in obj) out[k] = obj[k]; });
  return out;
};

// ── 안전한 JSON 파싱 ─────────────────────────────────────
window.ITC_PARSE_JSON = function(str, fallback = null) {
  try { return JSON.parse(str); } catch(e) { return fallback; }
};

// ── 타임스탬프 포맷 ──────────────────────────────────────
window.ITC_FORMAT_TIME = function(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
};
