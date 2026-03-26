# ITC TRPG v1 → v2 마이그레이션 계획

## 현재 v1 규모
- **총 6,113줄** (CSS 657줄 + HTML 987줄 + JS 4,356줄)
- **213개 함수**, 17개 카테고리로 분류

## 마이그레이션 Phase 순서

### Phase 1: 기반 (Core + CSS + HTML 셸)
**목표: v2 프로젝트가 빈 화면이라도 정상 로딩되는 상태**
- [x] `core/state.js` — 전역 상태 (뼈대 작성됨)
- [x] `core/events.js` — 이벤트 버스 (뼈대 작성됨)
- [x] `core/firebase.js` — Firebase 초기화 (뼈대 작성됨)
- [x] `utils/dom.js` — 유틸리티 (뼈대 작성됨)
- [ ] `styles/` — v1의 657줄 CSS 전체 이전 + 모듈별 분리
- [ ] `index.html` — v1의 987줄 HTML 전체 이전
- [ ] `src/app.js` — 실제 Firebase config 연결 + 화면 전환
- **함수 수: ~12개**

### Phase 2: 인증 (Auth + Profile) ✅ 완료
**목표: 로그인/회원가입/Google 로그인 작동**
- [x] `modules/auth/auth.js` — 11개 함수 (145줄)
- [x] `modules/auth/profile.js` — 11개 함수 (218줄)
- **v1-main.js: 4353줄 → 3999줄 (354줄 감소)**

### Phase 3: 로비 (Lobby)
**목표: 방 만들기/입장/캠페인 목록 작동**
- [ ] `modules/lobby/lobby.js` — 21개 함수
- [ ] `modules/lobby/campaign.js` — 캠페인 관리 분리
- **함수 수: ~21개**

### Phase 4: 게임 진입 + 플레이어
**목표: 방 입장 후 헤더 + 플레이어 칩 + 기본 레이아웃**
- [ ] `modules/game/game.js` — enterGame, setupFirebaseListeners, leaveRoom
- [ ] `modules/game/players.js` — addPlayerChip, renderPlayers
- [ ] `modules/permissions/permissions.js` — 5개 함수 (뼈대 보완)
- **함수 수: ~10개**

### Phase 5: 채팅 (Chat + Casual + Whisper + Typing)
**목표: 메시지 송수신, 잡담, 귓말, 타이핑 인디케이터**
- [ ] `modules/chat/chat.js` — 보완 (v1 appendChatMsg 완전 이전)
- [ ] `modules/chat/casual.js` — 잡담 탭
- [ ] `modules/chat/whisper.js` — 귓말 시스템 5개 함수
- [ ] `modules/chat/typing.js` — 타이핑 인디케이터
- [ ] `modules/chat/msg-actions.js` — 메시지 수정/삭제
- **함수 수: ~25개**

### Phase 6: 맵 + 토큰
**목표: 맵 배경 + 그리드 + 줌/팬 + 토큰 CRUD + 드래그**
- [ ] `modules/map/map.js` — 보완 (v1 줌/팬 완전 이전)
- [ ] `modules/token/token.js` — 보완 (v1 토큰 12개 함수)
- [ ] `modules/token/token-edit.js` — 토큰 편집 모달 (~15개 함수)
- **함수 수: ~30개**

### Phase 7: 저널 + 캐릭터 시트
**목표: 저널 CRUD + 캐릭터 시트 편집 + 소유권/공유**
- [ ] `modules/journal/journal.js` — 보완 (v1 24개 함수)
- [ ] `modules/journal/sheet.js` — 캐릭터 시트 8개 함수
- [ ] `modules/journal/sheet-assign.js` — 소유권/공유
- **함수 수: ~32개**

### Phase 8: Speak-as + VN + 다이스 + BGM
**목표: 저널로 말하기, 비주얼노벨 대사창, 다이스, BGM**
- [ ] `modules/chat/speak-as.js` — 17개 함수
- [ ] `modules/chat/vn-dialog.js` — 대사창 + 스탠딩
- [ ] `modules/dice/dice.js` — 보완 (v1 다이스 6개 함수)
- [ ] `modules/bgm/bgm.js` — 보완
- **함수 수: ~25개**

### Phase 9: 팝아웃 + 마무리
**목표: 채팅 분리 창, 최종 통합 테스트**
- [ ] `modules/popout/popout.js` — 5개 함수
- [ ] 시스템별 캐릭터 시트 UI
- [ ] 전체 통합 테스트
- **함수 수: ~15개**

## 총 예상: ~200개 함수, 9 Phase
## 각 Phase = 1~2 대화 턴
