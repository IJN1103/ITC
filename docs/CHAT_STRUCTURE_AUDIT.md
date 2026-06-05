# CHAT 구조 감사 문서

기준 파일: `ITC-main(281).zip`

목적: 채팅 안정화/디버깅/최적화 전에 현재 chat 관련 구조, 데이터 흐름, 위험 지점, 다음 정리 순서를 문서화한다. 이 문서는 코드 수정 없이 구조 감사 결과만 정리한다.

---

## 1. 전체 판단

현재 chat 구조는 기능 단위가 분리되어 있기는 하지만, 실제 런타임 책임은 여러 전역 함수와 큰 파일에 강하게 묶여 있다. 단기 버그 수정은 가능하지만, 채팅/DM/팝아웃/모바일/아바타/IME/히스토리 패치가 누적되면서 디버깅 난이도가 높아진 상태다.

가장 중요한 결론은 다음과 같다.

1. `src/modules/chat-v1/chat.js`가 2,779줄이고, 내부 함수가 약 149개다. 입력, 전송, 렌더, 히스토리, 이미지, 아바타, IME, resize, 팝아웃 연동까지 한 파일에 들어 있다.
2. `src/modules/game/game.js`가 채팅 listener, DM 채널 전환, DM meta 갱신, 이전 채팅 로딩을 함께 담당한다. 즉, 채팅 핵심 로직이 `chat.js`에만 있지 않다.
3. DM 관련 UI는 `src/modules/chat-dm/dm-ui.js`에 있으나, 실제 메시지 전송/수신/삭제/읽음 상태는 `chat.js`, `game.js`, `v1-core.js`, `popout.js`까지 걸쳐 있다.
4. `src`와 `dev`가 일부 불일치한다. 특히 chat은 `build.sh`를 실행하면 현재 `src/modules/chat-v1/chat.js`의 일부 안정화 코드가 사라질 위험이 있다.
5. DM 메시지 저장 구조가 과도기 상태다. `dm-storage.js`는 `rooms/{roomCode}/dmChats/{channelKey}/messages`를 가리키지만, 일반 DM 메시지 전송은 여전히 `rooms/{roomCode}/chat`에 `dmChannelKey`를 붙여 저장한다.

따라서 현재 단계에서 바로 대규모 리팩토링을 시작하는 것은 위험하다. 우선 `src/dev` 동기화와 책임 지도 정리가 먼저 필요하다.

---

## 2. 관련 파일 규모

| 파일 | 라인 수 | 현재 역할 | 위험도 |
|---|---:|---|---|
| `src/modules/chat-v1/chat.js` | 2,779 | 채팅 입력/전송/렌더/히스토리/이미지/아바타/IME/resize | 높음 |
| `dev/chat-v1/_chat-render.js` | 1,249 | 렌더 + 일부 입력/IME/resize + history store | 높음 |
| `dev/chat-v1/_chat-image.js` | 586 | 이미지 프리뷰/압축/업로드/첨부 전송 | 중간 |
| `dev/chat-v1/_chat-send.js` | 740 | 일반 채팅/잡담/귓말/아바타/메시지 DOM | 높음 |
| `src/modules/game/game.js` | 2,017 | 방 listener, active chat listener, history paging, DM meta | 높음 |
| `src/modules/chat-dm/dm-ui.js` | 652 | DM 버튼/UI/unread dot/DM방 목록 | 중간 |
| `src/modules/chat-dm/dm-channel.js` | 206 | DM 채널 키/현재 채널 관리 | 중간 |
| `src/modules/chat-dm/dm-storage.js` | 44 | DM 경로 유틸 | 낮음, 단 과도기 상태 |
| `src/modules/popout-v1/popout.js` | 692 | 팝아웃 렌더/동기화/전송 위임 | 중간 |
| `src/v1-core.js` | 374 | 메시지 수정/삭제, 모바일 long-press 액션 | 중간 |
| `styles/all.css` | 1,515 | 채팅/팝아웃/모바일/입력창 CSS 포함 | 중간 |

---

## 3. 로드 순서

`index.html` 기준 스크립트 로드 순서는 다음이다.

```text
src/core/image-utils.js
src/modules/auth/auth.js
src/modules/auth/profile.js
src/modules/lobby/lobby.js
src/modules/game/game.js
src/modules/dice-v1/dice.js
src/modules/chat-v1/chat.js
src/modules/chat-dm/dm-channel.js
src/modules/chat-dm/dm-storage.js
src/modules/chat-dm/dm-ui.js
...
src/modules/bgm-v1/bgm.js
src/modules/ui/ui.js
src/modules/popout-v1/popout.js
src/modules/journal-v1/journal.js
src/modules/speak-as/speak-as.js
src/v1-core.js
```

주의점:

- `game.js`가 `chat.js`보다 먼저 로드된다. 그래서 `game.js` 내부의 일부 함수는 실행 시점에 `window.appendChatMsg`, `window.seedChatHistoryStore`, `window.configureHistoryPaging` 등이 존재한다고 가정한다.
- `v1-core.js`는 마지막에 로드되며, 메시지 수정/삭제 버튼을 `addMsgActions()`로 붙인다. `chat.js`의 DOM 생성 로직이 `v1-core.js`의 전역 함수에 의존한다.
- 팝아웃은 별도 파일이지만, 내부 스크립트를 문자열로 조립하는 구조라 정적 분석과 디버깅이 어렵다.

---

## 4. 현재 채팅 전송 흐름

### 4.1 메인 일반 채팅

```text
사용자 입력
  ↓
chatKeydown() 또는 전송 버튼
  ↓
sendChat()
  ↓
명령어/귓말/이미지/잡담/저널 speak-as 분기
  ↓
sendMessage() 또는 saSendMessage() 또는 sendWhisperMessage()
  ↓
Firebase push: rooms/{roomCode}/chat
  ↓
payload.dmChannelKey = 현재 채널 키
  ↓
DM 채널이면 notifyDmMetaAfterChatPush()
  ↓
touchDmChannelMetaForMessage()
  ↓
rooms/{roomCode}/dmChats/{channelKey}/meta 갱신
```

현재 일반 채팅과 DM 채팅 모두 기본 저장 위치는 `rooms/{roomCode}/chat`이다. DM 여부는 메시지의 `dmChannelKey`로 구분한다.

### 4.2 잡담 탭

```text
sendChat()
  ↓
sendCasualMsg()
  ↓
Firebase push: rooms/{roomCode}/casual
```

잡담은 `rooms/{roomCode}/casual`로 별도 분리되어 있어 일반/DM 채팅보다 구조가 단순하다.

### 4.3 이미지 채팅

```text
파일 선택
  ↓
queuePendingChatImages()
  ↓
프리뷰/압축/메타 생성
  ↓
sendPendingChatImages()
  ↓
sendPreparedChatImage()
  ↓
Cloudinary 업로드
  ↓
rooms/{roomCode}/chat에 이미지 메시지 push
```

이미지는 Cloudinary 업로드 이후 URL을 채팅 메시지로 저장한다. 이미지 전송도 현재 채널의 `dmChannelKey`를 따른다.

### 4.4 귓말

```text
/w 명령 또는 whisper 상태
  ↓
sendWhisperMessage()
  ↓
rooms/{roomCode}/chat에 type='whisper' 저장
  ↓
렌더 단계에서 uid/whisperTo 기준으로 표시 여부 판단
```

귓말은 별도 Firebase 경로가 아니라 일반 chat 경로에 저장된다.

---

## 5. 현재 채팅 수신/렌더 흐름

### 5.1 방 입장 후 listener 구성

```text
enterGame()
  ↓
setupFirebaseListeners()
  ↓
switchActiveChatChannel(initialChatChannelKey)
  ↓
rooms/{roomCode}/chat listener 구성
```

`switchActiveChatChannel()`은 현재 채널이 global인지 DM인지에 따라 listener를 구성한다.

- global: `rooms/{roomCode}/chat` 최근 N개 수신 후 클라이언트 필터링
- DM: `orderByChild('dmChannelKey')`, `equalTo(channelKey)` 기반 query 사용 가능 시 해당 DM만 수신

수신된 메시지는 다음 흐름으로 렌더된다.

```text
Firebase snapshot
  ↓
shouldShowChatMessageForChannel()
  ↓
cacheChannelMessages()
  ↓
appendChatMsg() 또는 replaceChatMsg()
  ↓
upsertStoredMessage()
  ↓
queueMessageRender()
  ↓
flushMessageRender()
  ↓
DOM 반영
```

### 5.2 내부 상태가 이중화되어 있음

현재 채팅 메시지는 최소 두 곳에 상태가 쌓인다.

1. `game.js`의 `_chatRecordsByChannel`
2. `chat.js`의 render store: `storeMap`, `storeOrder`, `map`, `queue`

이 구조는 성능 최적화에는 도움이 될 수 있지만, 동기화가 어긋나면 다음 문제가 생길 수 있다.

- 메시지 일부가 store에는 있는데 DOM에 없음
- DOM에는 있는데 processed set 때문에 다시 렌더되지 않음
- 이전 메시지를 불러왔지만 늦게 들어온 snapshot 항목으로 판단되어 skip됨
- 채널 전환 시 캐시 복원이 현재 Firebase 상태와 어긋남

---

## 6. 이전 채팅 히스토리 흐름

상단 스크롤 시 대략 다음 흐름이다.

```text
채팅창 scrollTop 근처 감지
  ↓
requestOlderHistory()
  ↓
configureHistoryPaging()에 등록된 loadOlder 실행
  ↓
loadOlderChatHistoryForChannel(channelKey)
  ↓
rooms/{roomCode}/chat에서 orderByKey + endBefore(cursorKey) + limitToLast(pageLimit)
  ↓
클라이언트에서 channelKey 필터링
  ↓
seedChatHistoryStore(... position='prepend')
  ↓
prependStoredWindow()
```

### 현재 문제 가능성

이전 채팅 일부가 안 보이는 문제는 구조적으로 다음 가능성이 있다.

1. `rooms/{roomCode}/chat`에 global/DM/whisper가 섞여 있어, global 히스토리를 찾을 때 불필요한 DM 메시지를 많이 건너뛰어야 한다.
2. `limitToLast(pageLimit)`로 가져온 범위 안에 목표 채널 메시지가 적으면, 사용자는 이전 채팅이 비어 있거나 일부 누락된 것처럼 볼 수 있다.
3. `processed` set과 `late-older-message-skip` 로직이 늦게 도착한 과거 메시지를 중복 방지 목적으로 스킵할 수 있다.
4. store window와 실제 DOM window가 별도로 움직여, 스크롤 위치 보정 중 일부 메시지가 화면 밖으로 밀릴 수 있다.

최근 패치에서 page limit과 memory limit을 늘린 것은 완화책이다. 근본 해결은 “채널별로 메시지 저장 경로 또는 인덱스를 분리”하는 쪽이다.

---

## 7. DM unread dot 흐름

현재 unread dot은 대략 다음 구조다.

```text
rooms/{roomCode}/dmChats listener
  ↓
dm-ui.js: rebuildUnreadState()
  ↓
meta.latestAt 기준 latestByChannel 구성
  ↓
localStorage seen map과 비교
  ↓
window.setDmUnreadState(channelKey, true/false)
  ↓
DM 버튼/목록/팝아웃 dot 표시
```

DM방을 클릭하면 다음 흐름도 같이 발생한다.

```text
DM 버튼 클릭
  ↓
setCurrentDmChannelKey(channelKey)
  ↓
switchActiveChatChannel(channelKey)
  ↓
markChannelSeen(channelKey)
  ↓
localStorage seen[channelKey] = latestAt
```

### 현재 문제 가능성

- `meta.updatedAt`을 새 메시지 기준처럼 쓰면 “클릭만 했는데 새 메시지”처럼 보일 수 있다.
- 현재는 unread 기준에서 `latestAt` 중심으로 보는 방향이 맞다.
- 다만 `meta.latestAt`도 실제 메시지 전송 외의 복구/부트스트랩/마이그레이션 로직에서 갱신되면 dot 오작동 가능성이 남는다.
- unread 상태는 localStorage 기반이므로 같은 유저라도 브라우저/탭/기기별로 상태가 다를 수 있다.

장기적으로는 `latestMessageKey`, `latestSenderUid`, `latestAt`을 기준으로 하고, “본인이 보낸 최신 메시지”는 unread가 되지 않도록 명확히 고정하는 편이 안전하다.

---

## 8. src/dev/build 상태 점검

`build.sh` 구조:

```text
cat dev/chat-v1/_chat-render.js \
    dev/chat-v1/_chat-image.js \
    dev/chat-v1/_chat-send.js \
    > src/modules/chat-v1/chat.js
```

점검 결과:

| 대상 | 상태 |
|---|---|
| chat dev 3파일 concat vs `src/modules/chat-v1/chat.js` | 불일치 |
| map-token dev 3파일 concat vs `src/modules/map-token/map-token.js` | 불일치 |
| journal dev 3파일 concat vs `src/modules/journal-v1/journal.js` | 일치 |

### chat 불일치의 의미

현재 상태에서 `build.sh`를 실행하면 `src/modules/chat-v1/chat.js`의 일부 런타임 수정사항이 dev 파일 기준으로 덮어써질 수 있다.

확인된 chat 차이 예시:

- `getRenderedNodeByKey()` 계열 DOM 중복 방지 함수
- `insertStoredKeyInOrder()` / `insertRenderedNodeInStoredOrder()` 계열 정렬 삽입 로직
- duplicate rendered message 제거 로직
- 일부 dialogue portrait 필드 보존
- casual name color 전달 보정
- 일부 speak-as image nameColor 보정
- queue dedupe/ordered insert 관련 보정

따라서 현재는 `build.sh` 실행을 계속 금지하는 것이 맞다. 리팩토링 이전에 반드시 `src/dev` 동기화가 선행되어야 한다.

---

## 9. 현재 구조의 핵심 위험 지점

### 위험 1. `chat.js` 과밀

`chat.js`가 너무 많은 책임을 가진다.

현재 섞여 있는 기능:

- 입력창 resize
- IME 한글 입력 guard
- desc mode
- 채팅 전체 삭제
- render state/store/window
- virtual render
- history paging
- 이미지 lazy load
- 이미지 업로드/프리뷰
- 일반 채팅/잡담/귓말 전송
- typing indicator
- 아바타 HTML/fallback/preload
- 메시지 DOM 생성
- 팝아웃 메시지 relay
- 전역 함수 export

이 구조에서는 단순 입력창 수정도 렌더/전송/팝아웃에 영향을 줄 수 있다.

### 위험 2. render 파일에 input 로직이 있음

`dev/chat-v1/_chat-render.js` 안에 입력창 resize, IME guard, `chatKeydown()`이 포함되어 있다. 파일명과 책임이 맞지 않는다.

추천 분리 후보:

```text
dev/chat-v1/_chat-input.js
```

담당:

- `chatKeydown()`
- IME guard
- 입력창 resize
- desc mode 입력창 상태
- typing broadcast 호출 연결

### 위험 3. DM 메시지 경로가 과도기 상태

`dm-storage.js`는 DM 메시지 경로를 `rooms/{roomCode}/dmChats/{channelKey}/messages`로 제공하지만, 실제 send 계열은 대부분 `rooms/{roomCode}/chat`에 push한다.

즉, 코드상으로는 “분리된 DM 메시지 경로”를 준비한 흔적이 있지만 런타임은 아직 legacy mixed path를 사용한다.

현재 당장 분리하면 안 되는 이유:

- 기존 DM 기록이 `rooms/{roomCode}/chat`에 남아 있음
- DM 삭제가 legacy path와 new path를 모두 고려해야 함
- 팝아웃/히스토리/검색/삭제/메타 복구 모두 영향받음

장기적으로는 dual-read/dual-write/migration 계획이 필요하다.

### 위험 4. `onValue` snapshot 기반 처리와 processed set의 충돌 가능성

현재 active channel listener는 snapshot 전체를 받아 필터링한 뒤 `processed` set과 signature map으로 중복/변경을 판정한다.

장점:

- 초기 복원/채널 전환 시 한 번에 맞추기 쉬움

단점:

- snapshot 범위 밖 메시지, 뒤늦게 들어온 과거 메시지, history prepend가 서로 충돌할 수 있음
- `late-older-message-skip`이 필요한 구조 자체가 이미 복잡하다는 신호
- 대량 채팅에서는 DOM/window/store/cache 간 싱크가 흔들릴 여지가 있음

### 위험 5. 팝아웃 스크립트 문자열 조립

`popout.js` 내부에서 팝아웃 HTML/스크립트를 문자열로 생성한다. 이 구조는 다음이 어렵다.

- 문법 검사
- 부분 수정
- 함수 재사용
- 메인창과 팝아웃의 기능 동기화
- 이벤트/DOM 차이 디버깅

현재 팝아웃이 안정화된 상태라면 당장 변경하지 않는 것이 맞다. 다만 장기적으로는 팝아웃 공용 렌더 유틸 분리가 필요하다.

### 위험 6. 메시지 action이 `v1-core.js`에 있음

`addMsgActions()`, `editMsg()`, `deleteMsg()`, 모바일 long-press action이 `v1-core.js`에 있다. 하지만 메시지 DOM은 `chat.js`에서 만든다.

즉, 메시지 수정/삭제는 사실상 chat 기능인데 core 파일에 있다. 향후 분리 후보는 다음이다.

```text
dev/chat-v1/_chat-actions.js
```

---

## 10. 지금 바로 하면 안 되는 작업

다음 작업은 현재 단계에서 바로 진행하지 않는 편이 안전하다.

1. `rooms/{roomCode}/chat`에서 DM 메시지를 즉시 분리 저장하는 대규모 변경
2. `popout.js` 구조 전면 개편
3. `chat.js`를 여러 파일로 한 번에 분해
4. `build.sh` 실행 기반으로 전환
5. virtual render/window 구조 전면 교체
6. unread seen 상태를 Firebase 유저별 상태로 즉시 이전

이 작업들은 안정화 테스트 없이 진행하면 기존 채팅/DM/팝아웃/히스토리 회귀 가능성이 높다.

---

## 11. 권장 다음 작업 순서

사용자가 5인 장시간 테스트를 스킵해야 하는 상황이라면, 다음 순서가 가장 안전하다.

### PHASE 3-1. 구조 감사 문서 작성

현재 문서. 코드 수정 없음.

목적:

- 채팅 전송/수신/렌더/DM unread/팝아웃 흐름 고정
- 리팩토링 전 위험 지점 확인
- 다음 작업의 기준선 확보

### PHASE 3-2. `src/dev` 동기화 패치

목표:

- `build.sh`를 실행하지 않아도 현재 런타임 기준을 dev 파일에 반영
- `src/modules/chat-v1/chat.js`와 dev concat 결과를 일치시키기
- 기능 변경 없이 소스 기준선만 정리

수정 후보:

```text
dev/chat-v1/_chat-render.js
dev/chat-v1/_chat-image.js
dev/chat-v1/_chat-send.js
src/modules/chat-v1/chat.js
```

주의:

- 기능 추가 금지
- Firebase rules 변경 금지
- build.sh 실행은 아직 하지 않음
- 최종적으로 concat 비교만 통과시키는 것이 목적

### PHASE 3-3. chat input 책임 분리

목표:

```text
dev/chat-v1/_chat-input.js
```

신규 분리 또는 명확한 섹션화.

분리 대상:

- IME guard
- `chatKeydown()`
- 입력창 resize
- desc mode 입력창 상태
- typing 입력 이벤트 연결

위험도는 낮은 편이지만, Enter 전송/Shift+Enter/PC 입력/모바일 입력을 반드시 확인해야 한다.

### PHASE 3-4. history/unread debug 기준 추가

목표:

- 이전 채팅 누락 발생 시 어떤 단계에서 빠졌는지 확인할 수 있게 함
- DM dot 오작동 시 latest/seen/sender/channel 상태를 확인할 수 있게 함

추가 후보:

```text
window.itcChatDebugReport(channelKey)
window.itcDmUnreadDebugReport()
```

이미 `itcChatDebugReport()`는 일부 존재한다. DM unread 쪽은 더 명확한 report가 필요하다.

### PHASE 3-5. 낮은 위험도 파일부터 실제 분리

추천 순서:

1. `chat-input`
2. `chat-actions`
3. `chat-avatar`
4. `chat-history`
5. `chat-render`
6. `chat-send`
7. `chat-image`

단, 각 단계는 “기능 변경 없는 이동”을 원칙으로 한다.

### PHASE 3-6. DM 메시지 경로 분리 설계

이 단계는 실제 리팩토링보다 먼저 설계 문서가 필요하다.

선택지:

A. 현재 mixed path 유지 + index 개선  
B. 신규 DM만 `dmChats/{key}/messages`에 저장 + legacy read 유지  
C. dual-write 후 점진 이관  
D. 완전 migration

현재 상황에서는 B 또는 C가 현실적이다. 단, 반드시 별도 설계 후 진행해야 한다.

---

## 12. 권장 파일 분리 최종안

장기적으로는 다음 구조가 가장 읽기 쉽다.

```text
src/modules/chat-v1/
  chat.js                 // 공개 API 조립, window export만 담당
  chat-state.js            // 공통 상태/상수/guard
  chat-input.js            // 입력창, IME, resize, typing 입력
  chat-send.js             // 일반 채팅/desc/choice/dice 명령 분기
  chat-whisper.js          // 귓말 전송/렌더 조건
  chat-casual.js           // 잡담 탭
  chat-image.js            // 이미지 프리뷰/업로드/lazy load
  chat-render.js           // DOM 생성/메시지 렌더
  chat-history.js          // 이전 채팅 로드/window/scroll 보정
  chat-actions.js          // 수정/삭제/모바일 long-press
  chat-avatar.js           // 아바타 URL/fallback/preload
  chat-popout-bridge.js    // 팝아웃 전달용 snapshot/bridge
```

DM은 다음처럼 별도 유지한다.

```text
src/modules/chat-dm/
  dm-channel.js            // 현재 채널/키 생성/참여자 정규화
  dm-storage.js            // Firebase path utility
  dm-ui.js                 // 버튼/목록/toast
  dm-unread.js             // unread latest/seen/dot 판단
  dm-meta.js               // meta 생성/복구/갱신
```

단, 실제 코드 파일 수를 이렇게 바로 늘리는 것은 권장하지 않는다. 처음에는 dev 파일 기준으로 책임만 나누고, 런타임 번들은 기존 `chat.js` 하나로 유지하는 방식이 안전하다.

---

## 13. 이번 감사의 결론

현재 채팅 구조는 다음 상태다.

| 항목 | 판단 |
|---|---|
| 당장 버그 수정 가능성 | 가능 |
| 장기 유지보수성 | 부족 |
| build.sh 사용 가능성 | 현재 낮음 |
| chat.js 책임 분리 필요성 | 높음 |
| DM 데이터 경로 정리 필요성 | 높음 |
| 팝아웃 구조 개선 필요성 | 중간, 단 지금은 보류 권장 |
| 최우선 다음 작업 | `src/dev` 동기화 |

다음 실제 작업으로는 **PHASE 3-2: chat `src/dev` 동기화 패치**를 권장한다. 이 작업은 기능을 바꾸지 않고 현재 런타임 기준을 보존하는 정리 작업이므로, 대규모 리팩토링 전 가장 먼저 해야 한다.
