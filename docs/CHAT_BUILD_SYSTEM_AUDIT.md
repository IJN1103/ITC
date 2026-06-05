# CHAT BUILD SYSTEM AUDIT

## 목적

CHAT 파일 정리/최적화 로드맵의 PHASE 7 결과 문서입니다.

목표는 `dev/chat-v1/*`로 분리한 파일들이 현재 런타임 파일인 `src/modules/chat-v1/chat.js`와 정확히 같은 결과를 만드는지 확인하고, 전체 `build.sh` 실행으로 인한 회귀 위험을 줄이는 것입니다.

## 현재 결론

- `chat-v1` dev/src 동기화: 정상
- `journal-v1` dev/src 동기화: 정상
- `map-token` dev/src 동기화: 불일치 확인
- 따라서 `./build.sh chat`은 chat 기준으로 사용 가능
- `./build.sh all`은 guard가 추가되어 dev/src 불일치가 있으면 기본 차단됨

## chat-v1 build 순서

`build.sh chat`은 아래 순서로 파일을 합쳐 `src/modules/chat-v1/chat.js`를 생성합니다.

```text
dev/chat-v1/_chat-input.js
dev/chat-v1/_chat-render-state.js
dev/chat-v1/_chat-render-virtual.js
dev/chat-v1/_chat-store.js
dev/chat-v1/_chat-render.js
dev/chat-v1/_chat-history.js
dev/chat-v1/_chat-image-display.js
dev/chat-v1/_chat-image-queue.js
dev/chat-v1/_chat-image-prepare.js
dev/chat-v1/_chat-image-upload.js
dev/chat-v1/_chat-image.js
dev/chat-v1/_chat-send.js
dev/chat-v1/_chat-send-message.js
dev/chat-v1/_chat-casual-state.js
dev/chat-v1/_chat-typing.js
dev/chat-v1/_chat-actions.js
dev/chat-v1/_chat-casual-render.js
dev/chat-v1/_chat-whisper.js
dev/chat-v1/_chat-lightbox.js
dev/chat-v1/_chat-avatar.js
dev/chat-v1/_chat-message.js
```

이 순서로 합친 결과는 현재 `src/modules/chat-v1/chat.js`와 완전히 일치합니다.

## 확인 결과

| 모듈 | generated line count | current src line count | 상태 |
|---|---:|---:|---|
| chat-v1 | 3260 | 3260 | 일치 |
| journal-v1 | 3866 | 3866 | 일치 |
| map-token | 2136 | 2151 | 불일치 |

## map-token 불일치 내용

이번 PHASE 7의 작업 범위는 chat build 체계 점검이므로 map-token 코드는 수정하지 않았습니다.

다만 전체 `build.sh` 실행 시 map-token이 dev 파일 기준으로 다시 생성되면 현재 런타임 `src/modules/map-token/map-token.js`의 일부 안정화 코드가 사라질 수 있습니다.

확인된 차이의 핵심은 다음과 같습니다.

- `getPanelTokenDisplayImageSource()` 누락 가능성
- imported map object 표시용 `_itcGetMapDisplayImageSrc(raw, 1600)` 처리 누락 가능성
- imported map object hidden 상태에서 `dataset.itcMapLazySrc` 사용 처리 누락 가능성
- panel token 이미지 `loading='lazy'`, `decoding='async'` 보정 누락 가능성

따라서 map-token dev/src 동기화 전에는 전체 build를 실행하지 않는 것이 안전합니다.

## build.sh 변경 내용

기존 `build.sh`는 항상 chat, map-token, journal을 모두 다시 생성했습니다.

이번 단계에서 다음 guard를 추가했습니다.

```text
./build.sh chat
```

- chat-v1만 빌드합니다.
- chat dev/src는 현재 일치하므로 chat 기준으로 안전합니다.

```text
./build.sh all
```

- 전체 build를 시도합니다.
- 단, dev/src 불일치가 있으면 기본적으로 중단합니다.
- 현재는 map-token 불일치 때문에 중단되는 것이 정상입니다.

```text
ITC_ALLOW_UNSYNCED_BUILD=1 ./build.sh all
```

- dev/src 불일치 guard를 강제로 우회합니다.
- 일반 작업에서는 사용하지 않는 것을 권장합니다.

## 현재 권장

- 일반 사용자는 `build.sh`를 실행하지 않아도 됩니다.
- chat만 재생성해야 하는 개발 상황에서는 `./build.sh chat`만 사용합니다.
- 전체 build는 map-token dev/src 동기화 전까지 사용하지 않습니다.

## 다음 권장 단계

PHASE 8로 넘어가기 전, 선택지는 두 가지입니다.

1. chat 로드맵만 계속 진행한다면 PHASE 8 채팅 성능 최적화 2차로 진행
2. build 체계를 더 안전하게 만들고 싶다면 map-token dev/src 동기화를 별도 단계로 진행

현재 최종 목표가 chat 관련 파일 정리와 채팅 기능 최적화라면, 다음은 PHASE 8이 우선입니다.
