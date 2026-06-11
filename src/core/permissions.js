/**
 * ITC TRPG — 권한 헬퍼 (ITC_PERM)
 * St.isGM, role === 'gm', hasPerm() 세 가지 방식을 단일 진입점으로 통합합니다.
 *
 * 사용 예:
 *   ITC_PERM.isGM()              → GM 여부
 *   ITC_PERM.isOwner()           → 방장 여부
 *   ITC_PERM.can('manageMap')    → 특정 권한 보유 여부
 *   ITC_PERM.isGMorOwner()       → GM 또는 방장
 *   ITC_PERM.myRole()            → 'gm' | 'player' | ''
 */

window.ITC_PERM = Object.freeze({

  // ── 기본 역할 ──────────────────────────────────────────
  isGM() {
    return !!window.St?.isGM;
  },

  isOwner() {
    const rc = window.St?.roomCode;
    const uid = window.St?.myId;
    if (!rc || !uid) return false;
    return window.St?.players?.[uid]?.role === 'owner'
      || window.St?.ownerId === uid;
  },

  isGMorOwner() {
    return this.isGM() || this.isOwner();
  },

  myRole() {
    const uid = window.St?.myId;
    if (!uid) return '';
    return String(window.St?.players?.[uid]?.role || '').toLowerCase();
  },

  // ── 세부 권한 ─────────────────────────────────────────
  // 기존 hasPerm() 함수와 동일한 키 사용
  can(permission) {
    if (this.isGM()) return true; // GM은 모든 권한 보유
    const uid = window.St?.myId;
    if (!uid) return false;
    const perms = window.St?.players?.[uid]?.permissions;
    if (!perms) return false;
    return !!perms[permission];
  },

  // ── 자주 쓰는 복합 권한 ────────────────────────────────
  canManageMap() { return this.can('manageMap'); },
  canMoveToken() { return this.can('moveToken'); },
  canCreateToken() { return this.can('createToken'); },
  canEditToken() { return this.can('editToken'); },
  canManageBgm() { return this.can('manageBgm'); },
  canSendDesc() { return this.can('sendDesc'); },

  // ── 유틸 ──────────────────────────────────────────────
  /** 권한 없을 때 toast 출력 후 false 반환 */
  requireGM(msg) {
    if (this.isGM()) return true;
    if (typeof showToast === 'function') showToast(msg || 'GM만 사용할 수 있어요.');
    return false;
  },

  require(permission, msg) {
    if (this.can(permission)) return true;
    if (typeof showToast === 'function') showToast(msg || '권한이 없어요.');
    return false;
  },
});
