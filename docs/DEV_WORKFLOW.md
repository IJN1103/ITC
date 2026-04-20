# 개발 워크플로우

## 구조

```
프로젝트/
├── dev/                          ← 편집용 원본 파일
│   ├── chat-v1/
│   │   ├── _chat-render.js   (956줄)   채팅 렌더, 가상 스크롤, 히스토리 로딩
│   │   ├── _chat-image.js    (543줄)   이미지 업로드/미리보기/전송
│   │   └── _chat-send.js     (646줄)   메시지 송수신, 타이핑, 잡담
│   ├── map-token/
│   │   ├── _map-viewport.js  (660줄)   좌표계, 줌/팬, 입력 이벤트
│   │   ├── _map-render.js    (822줄)   토큰 렌더, 패널 토큰, 맵세팅 imported token
│   │   └── _token-edit.js    (507줄)   토큰 편집 패널, 저장
│   └── journal-v1/
│       ├── _journal-base.js  (767줄)   공통 유틸, 핸드아웃 전체
│       ├── _journal-core.js  (559줄)   저널 CRUD, 목록, 드로어
│       └── _journal-sheet.js (1076줄)  캐릭터 시트 (CoC)
├── src/modules/                  ← 브라우저용 빌드 결과물
│   ├── chat-v1/chat.js           = _chat-render + _chat-image + _chat-send
│   ├── map-token/map-token.js    = _map-viewport + _map-render + _token-edit
│   └── journal-v1/journal.js     = _journal-base + _journal-core + _journal-sheet
└── build.sh                      ← dev 파일을 합쳐 src 파일 생성
```

## 2026-04-20 기준 안정화 상태

이 문서 기준으로 `dev/`와 `src/`는 다시 동기화되어 있다.

아래 세 결과가 모두 성립해야 정상이다.

```txt
cat dev/chat-v1/_chat-render.js dev/chat-v1/_chat-image.js dev/chat-v1/_chat-send.js > src/modules/chat-v1/chat.js
cat dev/map-token/_map-viewport.js dev/map-token/_map-render.js dev/map-token/_token-edit.js > src/modules/map-token/map-token.js
cat dev/journal-v1/_journal-base.js dev/journal-v1/_journal-core.js dev/journal-v1/_journal-sheet.js > src/modules/journal-v1/journal.js
```

즉, `bash build.sh`를 실행해도 최근 안정화 작업이 사라지면 안 된다.

## 작업 순서

1. 가능하면 `dev/` 폴더의 해당 파일을 수정한다.
2. `bash build.sh`를 실행한다.
3. 생성된 `src/modules/...` 파일도 함께 확인한다.
4. 사용자에게 패치를 줄 때는 실제 반영에 필요한 변경 파일만 제공한다.

## AI에게 수정 요청할 때

권장:

- 채팅 렌더/히스토리/팝아웃 연동: `dev/chat-v1/_chat-render.js` 또는 `src/modules/chat-v1/chat.js` 영향 확인
- 채팅 이미지: `dev/chat-v1/_chat-image.js`
- 채팅 전송/잡담: `dev/chat-v1/_chat-send.js`
- 맵 좌표/줌/팬/드래그: `dev/map-token/_map-viewport.js`
- 패널 토큰/맵세팅 imported token 렌더: `dev/map-token/_map-render.js`
- 토큰 편집창: `dev/map-token/_token-edit.js`
- 저널/핸드아웃/시트: `dev/journal-v1/*`

주의:

- `src/modules/chat-v1/chat.js`, `src/modules/map-token/map-token.js`, `src/modules/journal-v1/journal.js`만 직접 수정하면 `build.sh` 실행 시 수정이 사라질 수 있다.
- 불가피하게 `src/`를 직접 수정한 경우, 같은 내용을 `dev/`에도 반드시 반영해야 한다.
- `dev/`와 `src/`가 다시 어긋나면 다음 AI가 오래된 dev 기준으로 작업하면서 회귀를 만들 수 있다.

## 규칙

- `dev/`와 `src/` 동기화 상태를 유지한다.
- 파일 순서 변경 금지. 합치는 순서가 곧 실행 순서다.
- `build.sh`는 `bash build.sh`로 실행 가능해야 한다.
- 큰 기능 추가 전에는 `bash build.sh` 실행 후 주요 기능 회귀 테스트를 먼저 한다.
- 회귀 위험이 큰 파일:
  - `src/modules/popout-v1/popout.js`
  - `src/modules/chat-v1/chat.js`
  - `src/modules/map-token/map-token.js`
  - `src/modules/map-scenes/map-scenes.js`
