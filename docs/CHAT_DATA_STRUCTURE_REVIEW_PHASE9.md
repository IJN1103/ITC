# CHAT DATA STRUCTURE REVIEW — PHASE 9

## 목적

이 문서는 현재 TRPG 웹앱의 채팅/DM 데이터 저장 구조를 점검하고, 장기적으로 전체 채팅과 DM을 분리할지 여부를 검토하기 위한 기준 문서다.

이번 PHASE 9는 **구현 작업이 아니다.** Firebase 경로, Rules, 런타임 코드를 변경하지 않는다. 기존 기능을 보존한 상태에서 이후 구조 개선을 할지 판단하기 위한 검토 단계다.

---

## 현재 구조 요약

현재 채팅 관련 주요 Firebase 경로는 다음과 같다.

```text
rooms/{roomCode}/chat
rooms/{roomCode}/casual
rooms/{roomCode}/dmChats/{dmKey}/meta
rooms/{roomCode}/dmChats/{dmKey}/messages
rooms/{roomCode}/dmMessageIndex/{dmKey}/{messageId}
rooms/{roomCode}/typing/{uid}
```

실제 핵심 메시지 흐름은 아직 대부분 아래 경로를 중심으로 작동한다.

```text
rooms/{roomCode}/chat
```

전체 채팅과 DM 메시지는 `rooms/{roomCode}/chat`에 함께 저장되고, 메시지의 `dmChannelKey` 값으로 구분된다.

예상 메시지 구분 방식:

```js
// 전체 채팅
{ dmChannelKey: "global" }

// DM 채팅
{ dmChannelKey: "uidA__uidB" }
```

`dmChats/{dmKey}/meta`는 DM방 목록, 최신 메시지, unread dot 계산을 위한 metadata 용도로 쓰인다.

`dmMessageIndex/{dmKey}/{messageId}`는 특정 DM방에 속한 메시지를 추적하거나 삭제할 때 보조 index로 쓰인다.

`dmChats/{dmKey}/messages` 경로는 규칙과 helper상 존재하지만, 현재 핵심 송수신 흐름은 `rooms/{roomCode}/chat` + `dmChannelKey` 구조를 기준으로 유지되고 있다.

---

## 현재 구조의 장점

### 1. 기존 기능과 호환성이 높음

전체 채팅, DM, 팝아웃, 수정/삭제, 이미지, 저널 speak-as가 모두 같은 메시지 객체 형태를 공유한다.

그래서 다음 기능들이 같은 렌더러를 재사용할 수 있다.

- 전체 채팅
- DM 채팅
- 팝아웃 전체/DM 채팅
- 이미지 메시지
- whisper 메시지
- speak-as 메시지
- 다이스/일반 메시지 표시
- 수정/삭제 반영

### 2. 기존 데이터 마이그레이션 없이 유지 가능

이미 쌓인 채팅 데이터가 `rooms/{roomCode}/chat`에 있기 때문에, 현재 구조를 유지하면 기존 방의 히스토리를 그대로 사용할 수 있다.

### 3. 단기 안정화에 유리함

최근 PHASE 4~8에서 히스토리 로딩, DM unread, 팝아웃 독립 채널, 성능 최적화를 이미 현재 구조 기준으로 안정화했다.

따라서 지금 당장 구조를 바꾸면 안정화된 기능을 다시 흔들 위험이 있다.

---

## 현재 구조의 단점

### 1. 전체 채팅과 DM이 한 경로에 섞임

`rooms/{roomCode}/chat` 안에 전체 채팅과 모든 DM방 메시지가 함께 쌓인다.

이로 인해 채팅이 많아질수록 다음 부담이 커진다.

- 전체 채팅을 보려면 DM 메시지를 필터링해야 함
- DM방을 보려면 같은 `chat` 경로에서 특정 `dmChannelKey`만 필터링해야 함
- 최근 N개만 읽을 때 DM 메시지가 섞이면 실제 표시 가능한 전체 채팅 수가 부족할 수 있음
- 오래된 전체 채팅을 찾기 위해 더 깊은 히스토리 탐색이 필요함

PHASE 4에서 초기 수신/히스토리 탐색 범위를 넓히고 anchor 복원을 보강했지만, 근본 구조는 여전히 혼재 방식이다.

### 2. DM 삭제 로직이 복잡함

DM방 삭제 시 고려해야 하는 위치가 많다.

```text
rooms/{roomCode}/chat/{messageId}
rooms/{roomCode}/dmMessageIndex/{dmKey}/{messageId}
rooms/{roomCode}/dmChats/{dmKey}/meta
rooms/{roomCode}/dmChats/{dmKey}/messages/{messageId}
```

현재는 legacy DM 메시지, index, meta를 함께 처리하는 방어 코드가 필요하다.

### 3. unread dot 계산이 meta에 민감함

현재 PHASE 5에서 unread 기준을 `latestAt`, `latestMessageKey`, `latestSenderUid` 중심으로 정리했지만, 이 구조는 여전히 DM meta 정확성에 의존한다.

메시지 저장과 meta 갱신이 분리되어 있기 때문에, 둘 중 하나가 실패하거나 지연되면 dot 상태가 어긋날 가능성이 있다.

### 4. 장기적으로 읽기 비용이 증가함

방이 오래 유지되고 채팅이 많이 쌓이면, 단일 `chat` 경로가 계속 커진다.

이 경우 전체 채팅/DM 구분을 클라이언트에서 계속 수행해야 하므로 다음 비용이 증가한다.

- Firebase snapshot 크기
- 클라이언트 필터링 비용
- 정렬 비용
- 캐시 관리 비용
- 팝아웃 watcher 비용

---

## 구조 개선 후보

### 후보 A. 현재 구조 유지 + 인덱스/캐시 보강

```text
rooms/{roomCode}/chat
rooms/{roomCode}/dmChats/{dmKey}/meta
rooms/{roomCode}/dmMessageIndex/{dmKey}/{messageId}
```

특징:
- 지금 구조 유지
- DM/전체 메시지는 계속 `chat`에 저장
- index와 meta만 더 엄격히 관리
- 현재 안정화 흐름을 가장 적게 건드림

장점:
- 위험도 낮음
- 기존 데이터 마이그레이션 불필요
- 팝아웃/수정삭제/히스토리 로직 유지 가능

단점:
- 근본적인 채팅/DM 혼재 문제는 남음
- 매우 오래된 방에서는 계속 최적화 부담이 있음

권장도:
- 단기 권장

---

### 후보 B. DM만 별도 messages 경로로 신규 저장, legacy chat 병행 읽기

```text
rooms/{roomCode}/chat
rooms/{roomCode}/dmChats/{dmKey}/messages
rooms/{roomCode}/dmChats/{dmKey}/meta
```

특징:
- 새 DM 메시지는 `dmChats/{dmKey}/messages`에 저장
- 기존 DM 메시지는 `chat` 경로에서 읽는 legacy fallback 유지
- 일정 기간 dual-read 구조 사용

장점:
- 신규 DM은 전체 채팅 경로와 분리 가능
- 장기적으로 DM방 히스토리 로딩이 쉬워짐
- 기존 데이터 즉시 마이그레이션은 필요 없음

단점:
- dual-read 때문에 중복 표시 방어 필요
- 삭제/수정/팝아웃/unread를 두 경로에 맞춰 다시 점검해야 함
- Firebase Rules 재검토 필요

위험도:
- 중간~높음

권장도:
- 장기 후보
- 지금 바로 구현은 비추천

---

### 후보 C. 전체 채팅과 DM을 완전히 분리

```text
rooms/{roomCode}/chat/public/{messageId}
rooms/{roomCode}/dmChats/{dmKey}/messages/{messageId}
rooms/{roomCode}/dmChats/{dmKey}/meta
rooms/{roomCode}/casual/{messageId}
```

특징:
- 전체 채팅과 DM을 물리적으로 완전히 분리
- `dmChannelKey` 의존도를 줄임

장점:
- 구조가 가장 명확함
- 전체 채팅 히스토리 로딩이 DM에 방해받지 않음
- DM방별 히스토리 로딩이 단순함
- 장기 성능 최적화에 유리함

단점:
- 기존 데이터 마이그레이션 필요 가능성 큼
- 기존 `chat` 렌더러/수정삭제/팝아웃/listener 대규모 수정 필요
- Firebase Rules 대폭 수정 필요
- 기존 방 호환성 문제가 큼

위험도:
- 높음

권장도:
- 지금 단계에서는 비추천
- 대규모 안정화 이후 별도 브랜치/백업 전제에서만 검토

---

## 권장 판단

현재는 **후보 A 유지**가 가장 안전하다.

이유:
- 최근 채팅 안정화 패치들이 현재 구조 기준으로 테스트 완료됨
- DM unread, 팝아웃 독립 채널, 히스토리 로딩이 이미 안정화됨
- 지금 데이터 경로를 바꾸면 Firebase Rules, 팝아웃 watcher, 수정삭제, DM 삭제, 히스토리 로딩이 모두 다시 영향을 받음
- 기존 장시간 방의 데이터 호환성을 보장하기 어렵다

따라서 현재 단계의 권장 결론은 다음과 같다.

```text
단기: 현재 구조 유지
중기: index/meta 무결성 보강
장기: 신규 DM만 별도 messages 경로로 dual-write/dual-read 검토
최종: 전체/DM 완전 분리는 마지막 선택지로 보류
```

---

## 만약 장기 구조 개선을 한다면 필요한 선행 조건

### 1. 백업

Firebase Realtime Database 백업이 필요하다.

### 2. Rules 설계

다음 권한을 명확히 나눠야 한다.

- 전체 채팅 읽기/쓰기
- DM방 참여자만 읽기
- DM방 참여자만 쓰기
- GM DM방 삭제 권한
- 기존 message edit/delete 권한
- 팝아웃 watcher 읽기 권한

### 3. 기존 데이터 호환 전략

선택지가 필요하다.

```text
A. 기존 데이터는 그대로 두고 새 메시지만 새 구조에 저장
B. 기존 데이터를 새 구조로 마이그레이션
C. 일정 기간 legacy read fallback 유지 후 정리
```

현재 프로젝트 안정성 기준으로는 C 또는 A가 상대적으로 안전하다.

### 4. 중복 표시 방어

dual-write 또는 dual-read 시 같은 메시지가 두 경로에서 읽힐 수 있다.

필요한 기준:

- `messageId`
- `legacyMessageKey`
- `clientMessageId`
- `createdAt`
- `dmChannelKey`

### 5. 수정/삭제 동기화

메시지가 두 경로에 존재할 수 있다면 수정/삭제도 두 경로에 반영해야 한다.

특히 아래 기능을 다시 점검해야 한다.

- PC hover 수정/삭제
- 모바일 long-press 수정/삭제
- GM 삭제
- DM방 삭제
- 팝아웃 반영
- history cache 제거

---

## 진행하지 말아야 할 작업

현재 단계에서 아래 작업은 비추천한다.

- Firebase 채팅 경로 즉시 변경
- 기존 `rooms/{roomCode}/chat` 데이터 삭제 또는 마이그레이션
- 전체/DM 완전 분리 구현
- `dmChats/{dmKey}/messages` 단독 사용으로 즉시 전환
- Rules 대규모 변경
- 팝아웃 watcher 구조 재작성

---

## 이후 권장 작업

### 선택 1. 여기서 CHAT 로드맵 종료

현재까지 진행한 안정화와 문서화를 기준으로, 다른 기능 작업으로 넘어갈 수 있다.

### 선택 2. map-token dev/src 동기화

PHASE 7에서 확인된 별도 이슈다.

- chat dev/src: 동기화 완료
- journal dev/src: 동기화 확인됨
- map-token dev/src: 불일치 확인됨

전체 build 안정성을 높이려면 map-token 동기화를 별도 작업으로 진행할 수 있다.

### 선택 3. DM 데이터 구조 개선 설계만 추가 문서화

구현 없이 Firebase Rules 초안, 마이그레이션 전략, dual-read/dual-write 전략만 별도 문서로 작성할 수 있다.

---

## 최종 결론

현재 프로젝트 상태에서는 **채팅 데이터 구조를 지금 바로 바꾸지 않는 것**이 가장 안전하다.

최종 목표가 “chat 관련 파일 정리와 채팅 기능 최적화”라면, 이미 다음 핵심 단계는 완료되었다.

- chat dev 파일 분리
- src/dev 동기화
- 히스토리 로딩 최적화 1차
- DM unread 구조 안정화
- 팝아웃 채널 독립화 및 sync 안정화
- 성능 미세 최적화
- 최종 회귀 체크리스트 정리

남은 데이터 구조 개선은 장기 과제이며, 실제 구현은 Firebase 백업과 별도 migration 계획이 생긴 뒤 진행하는 것이 맞다.
