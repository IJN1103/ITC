# POP_OUT CHAT STRUCTURE AUDIT — PHASE 6-1 / 6-2

## 목적

팝아웃 채팅 구조를 정리하기 전에, 현재 정상 동작 중인 기능을 깨지 않기 위한 기준선을 문서화한다. 이번 단계는 기능 변경이 아니라 구조 점검/주석화 단계다.

## 현재 유지해야 하는 핵심 동작

- 본창과 팝아웃창은 서로 다른 채팅 채널을 볼 수 있어야 한다.
  - 본창: 전체 / 팝아웃: DM 가능
  - 본창: DM / 팝아웃: 전체 가능
  - 본창: A DM / 팝아웃: B DM 가능
- 팝아웃에서 채널을 선택해도 본창의 active DM 채널이 강제로 바뀌면 안 된다.
- 팝아웃에서 메시지를 보내면 해당 팝아웃 채널에만 기록되어야 한다.
- 팝아웃에서 메시지를 보낸 후 본창의 기존 채널 선택은 유지되어야 한다.
- 본인이 보낸 DM은 본인에게 unread DOT를 만들면 안 된다.
- 현재 본창 또는 팝아웃에서 보고 있는 DM방은 read 상태로 처리되어야 한다.
- 팝아웃 전체 채팅/DM 채팅/잡담탭은 기존 렌더링, 이미지, dice, desc, speak-as 표시를 유지해야 한다.

## 관련 파일과 책임

### `src/modules/popout-v1/popout.js`

담당 영역:

- 팝아웃 HTML 생성
- 팝아웃 내부 스크립트 생성
- 팝아웃 창 목록 관리
- 본창 → 팝아웃 메시지 동기화
- 팝아웃 → 본창 메시지 전송 bridge
- 팝아웃별 현재 채널 추적
- 팝아웃 잡담/문서/색상 UI 동기화

주의 지점:

- 팝아웃 내부의 `popDmChannelKey`는 본창의 `_itcActiveChatChannelKey`와 분리되어야 한다.
- 팝아웃에서 `opener.setCurrentDmChannelKey()`를 직접 호출하면 본창 채널까지 바뀌는 회귀가 생길 수 있다.
- `sendChatFromPopout()`과 `sendDescFromPopout()`은 전송 중에만 임시로 target channel을 적용하고, 반드시 이전 채널을 복구해야 한다.

### `src/modules/game/game.js`

담당 영역:

- 본창 active chat listener
- 팝아웃 전용 chat channel watcher
- 채널별 메시지 캐시
- 팝아웃에 제공할 채널 메시지 getter

주의 지점:

- `watchPopoutChatChannel()`은 팝아웃 전용 watcher다.
- 이 함수는 본창 active channel을 바꾸면 안 된다.
- 팝아웃이 보고 있는 채널의 메시지는 `_chatRecordsByChannel` 캐시에 쌓이고, `getChatRecordsForChannel()`을 통해 복사본으로 전달된다.

### `src/modules/chat-dm/dm-ui.js`

담당 영역:

- DM방 목록/버튼 UI
- unread DOT 판단
- visible DM channel 목록
- seen 상태 관리

주의 지점:

- unread 판단 기준은 실제 메시지(`latestAt`, `latestMessageKey`, `latestSenderUid`) 중심이어야 한다.
- `updatedAt`은 단순 meta 갱신에도 바뀔 수 있으므로 unread 판단 기준으로 쓰면 안 된다.
- 본창과 팝아웃에서 열람 중인 DM방 모두 active/read 후보로 봐야 한다.

## 팝아웃 동기화 흐름

### 본창에서 팝아웃으로

1. 본창 채팅 listener가 Firebase 메시지를 수신한다.
2. 채널별 캐시에 메시지가 저장된다.
3. `forcePopoutSync()`가 예약된다.
4. 각 팝아웃창의 `getCurrentDmChannelKey()`를 확인한다.
5. 해당 팝아웃창이 보고 있는 채널의 메시지 목록만 전달한다.

### 팝아웃에서 메시지 전송

1. 팝아웃 내부 입력창에서 전송한다.
2. `window.opener.sendChatFromPopout(text, tab, channelKey)`를 호출한다.
3. 본창은 기존 active channel을 저장한다.
4. 전송할 channelKey를 임시 적용한다.
5. 기존 `sendMessage()` / `saSendMessage()` 흐름으로 Firebase에 메시지를 저장한다.
6. 본창 active channel을 이전 값으로 복구한다.
7. 팝아웃 sync를 짧은 간격으로 재요청한다.

## 현재 단계에서 하지 않은 것

- 팝아웃 구조 대규모 리팩토링
- 팝아웃 HTML/script string 생성 방식 변경
- Firebase 경로 변경
- DM 저장 구조 변경
- unread 알고리즘 변경
- 본창/팝아웃 공통 렌더 함수 추출

## 회귀 방지 체크리스트

PHASE 6 이후 관련 패치가 있을 때 최소 확인할 것:

1. 본창 전체 / 팝아웃 DM 조합 가능
2. 본창 DM / 팝아웃 전체 조합 가능
3. 본창 A DM / 팝아웃 B DM 조합 가능
4. 팝아웃 전체 채팅 전송 즉시 표시
5. 팝아웃 DM 채팅 전송 즉시 표시
6. 본창 전송 메시지가 팝아웃에 반영
7. 팝아웃 전송 메시지가 본창에 반영
8. 본인 DM 전송 시 본인 unread DOT 없음
9. 타인이 DM 전송 시 수신자에게만 unread DOT 표시
10. 팝아웃에서 보고 있는 DM방은 read 처리
11. DM방 클릭만으로 unread DOT가 생기지 않음
12. 팝아웃 잡담/문서/저널/색상 기능 유지

## 다음 권장 단계

다음 단계는 `PHASE 6-2: popout sync bridge 정리`로 두는 것이 안전하다.

추천 범위:

- 기능 변경 없이 `popout.js` 내부 동기화 함수 이름/구역 추가 정리
- 중복 sync 예약 호출 위치 점검
- `forcePopoutSync`, `schedulePopoutSyncSoon`, `watchPopoutChatChannel` 호출 관계 문서화

비추천 범위:

- 팝아웃 스크립트 생성 방식을 한 번에 갈아엎기
- 본창/팝아웃 렌더 함수를 즉시 공통화하기
- DM 저장 경로 변경


---

## PHASE 6-2 추가 정리: popout sync bridge

이번 단계에서는 기능을 바꾸지 않고, 팝아웃 동기화 bridge의 호출 경로를 한 곳에서 추적하기 쉽도록 정리했다.

정리된 helper:

- `normalizePopoutChatChannelKey()`
  - 팝아웃 전용 채널 key를 항상 `global` 또는 DM key로 정규화한다.
- `requestPopoutChannelSync()`
  - 팝아웃이 보고 있는 채널의 watcher/cache 갱신을 요청한다.
- `finishPopoutBridgeSync()`
  - 전송 후 watcher 갱신과 팝아웃 재동기화를 같이 예약한다.
- `withTemporaryPopoutTargetChannel()`
  - 팝아웃 메시지 전송 중에만 본창의 `_itcActiveChatChannelKey`를 임시로 target channel에 맞추고, 전송 직후 반드시 이전 값으로 복구한다.
- `notifyPopoutChatChannelCacheChanged()`
  - `game.js`의 팝아웃 전용 watcher가 메시지 캐시를 갱신했을 때 팝아웃 sync를 요청하고 이벤트를 발생시킨다.

보존해야 하는 규칙:

- 팝아웃에서 메시지를 보내도 본창의 현재 채널 선택은 바뀌면 안 된다.
- 본창과 팝아웃은 서로 다른 채널을 볼 수 있어야 한다.
- 팝아웃 watcher는 본창 active listener를 대체하지 않는다.
- `watchPopoutChatChannel()`은 팝아웃 표시용 캐시를 채우는 보조 watcher로만 유지한다.
- `itc:popout-channel-cache-change` 이벤트는 팝아웃 표시 갱신용이며 unread 판단 기준으로 쓰면 안 된다.

다음 단계에서는 `popout.js` 내부의 HTML 문자열 생성 방식까지 건드리지 말고, 먼저 팝아웃 채널 독립성 회귀 테스트를 통과한 뒤 다음 정리를 판단한다.

---

## PHASE 6-3 추가 정리: popout watcher lifecycle 정리

이번 단계에서는 팝아웃 채팅 채널 독립성을 유지하면서, 팝아웃 전용 Firebase watcher가 불필요하게 누적되지 않도록 수명주기를 정리했다.

정리된 helper:

- `getOpenPopoutChatChannelKeys()`
  - 현재 열려 있는 팝아웃창들이 보고 있는 채널 key를 수집한다.
  - 전체 채팅은 `global`, DM은 해당 `dmChannelKey`로 유지한다.
- `pruneUnusedPopoutChannelWatchers()`
  - 팝아웃 sync 시점에 열려 있는 팝아웃 채널만 보존하도록 본창 watcher 정리를 요청한다.
- `prunePopoutChatChannelWatchers(keepKeys)`
  - `game.js`에서 팝아웃 전용 watcher 중 더 이상 필요한 채널이 아닌 watcher를 unsubscribe한다.
- `getPopoutChatWatcherDebugStatus()`
  - 콘솔에서 팝아웃 전용 watcher 상태를 확인할 수 있는 디버깅 helper다.

보존해야 하는 규칙:

- watcher 정리는 팝아웃 전용 watcher에만 적용한다.
- 본창 active chat listener는 건드리지 않는다.
- 팝아웃에서 보고 있는 채널 watcher는 유지한다.
- 닫힌 팝아웃 또는 더 이상 보고 있지 않은 DM 채널 watcher만 정리한다.
- 팝아웃 채널을 다시 선택하면 `watchPopoutChatChannel()`이 필요한 watcher를 다시 생성할 수 있어야 한다.

점검 포인트:

- 본창 전체 / 팝아웃 DM 조합 유지
- 본창 DM / 팝아웃 전체 조합 유지
- 본창 A DM / 팝아웃 B DM 조합 유지
- 여러 DM방을 오가도 이전 DM watcher가 과도하게 누적되지 않음
- 팝아웃을 닫거나 방을 나갈 때 watcher가 정리됨

---

## PHASE 6-4 추가 정리: popout message sync 중복 렌더 방어

이번 단계에서는 팝아웃 채팅 채널 독립성과 watcher 구조를 유지하면서, 팝아웃 메시지 pane의 불필요한 전체 재렌더를 줄였다.

정리된 기준:

- 팝아웃 `setMessages()`는 전달받은 메시지 목록의 signature를 계산한다.
- 직전 signature와 완전히 같으면 DOM을 비우고 다시 그리지 않는다.
- signature에는 현재 팝아웃 채팅 채널, 메시지 key, 시간, 타입, 이름, 색상, 본문, 포맷 HTML, 아바타, 이미지 표시 옵션을 포함한다.
- 전체 채팅과 DM은 같은 `chat` pane을 쓰지만 현재 `popDmChannelKey`를 signature에 포함해 서로 다른 채널로 취급한다.
- 메시지가 수정/삭제되거나 채널이 바뀌면 signature가 달라져 기존처럼 다시 렌더된다.

보존해야 하는 규칙:

- 기능 결과는 바꾸지 않는다.
- 본창/팝아웃 채널 독립성은 유지한다.
- 팝아웃 채팅 전송/수신/DM 전환은 기존과 같아야 한다.
- 중복 렌더 방어는 표시 결과가 동일할 때만 작동해야 한다.
- 팝아웃 스크롤 위치 보존 로직은 기존 기준을 유지한다.

점검 포인트:

- 팝아웃 전체 채팅 새 메시지 즉시 표시
- 팝아웃 DM 채팅 새 메시지 즉시 표시
- 본창 메시지 수정/삭제가 팝아웃에 반영
- 채널 전환 후 이전 채널 내용이 남지 않음
- 같은 내용의 메시지를 여러 번 보내도 별도 메시지로 정상 표시


---

## PHASE 6-5 추가 정리: 팝아웃 채팅 최종 회귀 방어 점검

이번 단계에서는 팝아웃 채팅 구조를 다시 크게 변경하지 않고, 최근 PHASE 6-1~6-4에서 정리한 기능들이 유지되는지 확인하기 위한 점검 helper와 sync 상태 기록만 추가했다.

추가된 helper:

- `getPopoutChatSyncDebugStatus()`
  - 현재 열린 팝아웃 수, 각 팝아웃의 채널 key, 본창 active channel, 팝아웃 전용 watcher 상태, 최근 sync 요청/완료/오류 횟수를 확인한다.
  - 기능 동작을 바꾸지 않고 콘솔 점검용으로만 사용한다.

보존해야 하는 규칙:

- 팝아웃에서 채널을 바꿔도 본창 채널이 강제로 바뀌면 안 된다.
- 본창 전체 / 팝아웃 DM 조합이 가능해야 한다.
- 본창 DM / 팝아웃 전체 조합이 가능해야 한다.
- 본창 A DM / 팝아웃 B DM 조합이 가능해야 한다.
- 팝아웃에서 메시지를 보내도 본창 기존 채널은 복구되어야 한다.
- 본인이 보낸 DM은 본인 unread DOT를 만들면 안 된다.
- 실제 새 메시지를 받은 참여자에게만 unread DOT가 떠야 한다.
- 팝아웃 메시지 signature 최적화는 같은 표시 결과일 때만 재렌더를 막아야 한다.
- 메시지 수정/삭제/채널 전환/새 메시지는 팝아웃에 계속 반영되어야 한다.

점검 포인트:

- 콘솔에서 `getPopoutChatSyncDebugStatus()` 호출 시 오류 없이 상태 객체가 반환된다.
- `openPopoutCount`가 실제 열린 팝아웃 수와 맞다.
- `activeMainChannelKey`와 각 `popouts[].channelKey`가 서로 독립적으로 유지된다.
- 팝아웃을 닫은 뒤 sync가 다시 발생하면 닫힌 창이 목록에서 제거된다.
- watcherStatus에는 현재 팝아웃이 보고 있는 DM 채널만 남아야 한다.

PHASE 6-5 이후에는 팝아웃 채팅 구조 안정화의 1차 정리를 완료한 것으로 보고, 다음 단계는 chat build 체계 최종 점검으로 넘어간다.
