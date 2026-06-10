/**
 * ITC TRPG — 전역 설정 상수
 * 매직 넘버를 한 곳에서 관리합니다.
 * 값을 바꾸면 전체 앱에 반영됩니다.
 */
window.ITC_CONFIG = Object.freeze({

  // ── 채팅 ──
  CHAT: {
    GLOBAL_LISTEN_LIMIT:  900,   // 전체 채팅 Firebase 실시간 구독 메시지 수
    DM_LISTEN_LIMIT:      450,   // DM 채팅 Firebase 실시간 구독 메시지 수
    CASUAL_LISTEN_LIMIT:  160,   // 캐주얼 채팅 실시간 구독 수
    DOM_MAX_VISIBLE:      320,   // 화면에 유지할 최대 DOM 노드 수
    MEMORY_MAX:          2600,   // 메모리에 유지할 최대 메시지 수
    LOAD_STEP:             80,   // 히스토리 추가 로드 단위
  },

  // ── 이미지 ──
  IMAGE: {
    AVATAR_SIZE:          160,   // 아바타 Cloudinary 변환 크기(px)
    MAP_THUMB_WIDTH:      320,   // 맵 썸네일 폭(px)
    SCENE_THUMB_WIDTH:    480,   // 장면 썸네일 폭(px)
    TOKEN_MAX_EDGE:      1280,   // 토큰 이미지 최대 변(px)
  },

  // ── 세션/방 ──
  ROOM: {
    MAX_PLAYERS:            5,   // 방당 최대 플레이어 수
  },

  // ── 타이밍(ms) ──
  TIMING: {
    PANEL_TOKEN_CLICK_DELAY: 320,  // 패널 토큰 클릭 인식 딜레이
    BGM_MOBILE_ACTIVATION:   900,  // BGM 모바일 활성화 최소 간격
    BGM_SEEK_DEBOUNCE:        180,  // BGM 탐색 디바운스
    BGM_PLAYBACK_CHECK_RETRY: 450,  // BGM 재생 상태 재확인 간격
  },

});
