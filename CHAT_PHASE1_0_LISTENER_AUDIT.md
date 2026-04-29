# CHAT PHASE 1-0 Listener Audit

기준 파일: ITC-main(251).zip
작업 범위: 코드 수정 없음. 채팅 전체 구독 제거 전 진단만 수행.

## 결론

현재 채팅 사용감을 건드리지 않고 먼저 제거/대체해야 할 전체 구독은 2개입니다.

1. `src/modules/game/game.js`의 `rooms/{code}/chat` 전체 구독
   - 위치: `setupFirebaseListeners()` 내부
   - 역할: DM방 목록 생성, 채팅 레코드 캐시 재구성
   - 위험: 방을 오래 켜고 채팅이 많이 쌓이면 모든 유저가 전체 chat snapshot을 계속 받음

2. `src/modules/chat-dm/dm-ui.js`의 `rooms/{roomCode}/chat` 전체 구독
   - 위치: `ensureUnreadSync()` 내부
   - 역할: DM unread 계산
   - 위험: unread dot 계산을 위해 전체 채팅을 매번 훑음

## 절대 먼저 건드리면 안 되는 경로

`src/modules/game/game.js`의 `switchActiveChatChannel()`은 현재 활성 채팅방을 실제로 화면에 표시하는 핵심 경로입니다.

현재 방식:
- `rooms/{roomCode}/chat`에 `limitToLast(300)` 적용
- 현재 채널에 해당하는 메시지만 filter
- 이미 처리한 message key는 중복 append 방지
- 변경된 메시지만 replace
- 늦게 들어온 과거 메시지는 append skip

이 경로를 갑자기 `onChildAdded` 중심으로 바꾸거나 DOM 전체 재렌더 방식으로 바꾸면, 과거에 발생했던 “채팅칠 때마다 채팅창이 새로 로드되는 느낌”으로 회귀할 위험이 큽니다.

## PHASE 1-1 권장 작업

다음 실제 코드 패치는 아래 순서가 안전합니다.

1. DM방 목록 소스를 root chat scan에서 `rooms/{roomCode}/dmChats/{dmKey}/meta` listener로 변경
2. DM unread 소스를 root chat scan에서 `dmChats/{dmKey}/meta/latestAt` + local seen map 비교로 변경
3. 메시지 전송 시 DM 채널이면 `dmChats/{dmKey}/meta`를 함께 갱신
4. active chat 화면 listener는 그대로 유지

## PHASE 1-1에서 수정 예상 파일

- `src/modules/game/game.js`
- `src/modules/chat-dm/dm-ui.js`
- `src/modules/chat-v1/chat.js`
- `src/modules/speak-as/speak-as.js`
- 필요 시 `src/modules/dice-v1/dice.js`는 직접 수정하지 않고 `sendMessage()` 경유 여부만 확인
- `database.rules.json`
- `firebase-rules/database.rules.console-candidate.json`
- `dev/chat-v1/*` 동기화 필요

## Firebase Rules 예상

새 경로 또는 기존 DM meta 경로 쓰기/읽기 권한 점검 필요.

예상 경로:
- `rooms/{roomCode}/dmChats/{dmKey}/meta`

기존에 `ensureDmChannelMeta()`가 이미 이 경로를 쓰고 있으므로, 완전한 신규 개념은 아니지만 unread/catlog 의존도가 높아지므로 rules 검증이 필요합니다.

## 테스트 핵심

PHASE 1-1 패치 후 테스트 핵심은 기능보다 사용감입니다.

1. 전체 채팅에서 연속 메시지 20개 전송
2. 채팅창이 깜빡이거나 전체 재로딩되는 느낌이 없는지 확인
3. 스크롤이 강제로 튀지 않는지 확인
4. DM방 3~4개 생성
5. 각 DM방 unread dot이 정상 작동하는지 확인
6. DM방 전환 시 기존 메시지 표시가 지나치게 늦거나 비지 않는지 확인
7. 팝아웃 DM 버튼/unread dot 유지 확인

## 주의

`build.sh` 기준으로 `src/modules/chat-v1/chat.js`와 `dev/chat-v1/*` 합성 결과가 현재 일치하지 않습니다.
따라서 다음 코드 패치에서는 `src`와 `dev`를 반드시 함께 맞춰야 합니다.
