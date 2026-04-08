# 개발 워크플로우

## 구조

```
프로젝트/
├── dev/                          ← 편집용 (작은 파일)
│   ├── chat-v1/
│   │   ├── _render.js   (775줄)  렌더 엔진, 가상 스크롤, DOM 큐
│   │   ├── _image.js    (541줄)  이미지 업로드/미리보기/전송
│   │   └── _send.js     (589줄)  메시지 송수신, 타이핑, 잡담
│   ├── map-token/
│   │   ├── _viewport.js (567줄)  좌표계, 줌/팬, 입력 이벤트
│   │   ├── _render.js   (438줄)  토큰 CRUD, 렌더, 메모, 컨텍스트메뉴
│   │   └── _edit.js     (294줄)  토큰 편집 패널, 저장
│   └── journal-v1/
│       ├── _base.js     (767줄)  공통 유틸, 핸드아웃 전체
│       ├── _journal.js  (544줄)  저널 CRUD, 목록, 드로어
│       └── _sheet.js    (662줄)  캐릭터 시트 (CoC)
├── src/modules/                  ← 브라우저용 (빌드 결과물)
│   ├── chat-v1/chat.js           = _render + _image + _send
│   ├── map-token/map-token.js    = _viewport + _render + _edit
│   └── journal-v1/journal.js     = _base + _journal + _sheet
└── build.sh                      ← 빌드 실행
```

## 작업 순서

1. `dev/` 폴더에서 해당 파일만 수정
2. `./build.sh` 실행
3. 브라우저에서 확인

## AI에게 수정 요청할 때

❌ "chat.js를 수정해줘" (1905줄 전체 제공 필요)
✅ "dev/chat-v1/_image.js를 수정해줘" (541줄만 제공하면 됨)

## 규칙

- `dev/` 파일만 편집, `src/modules/` 파일은 직접 편집 금지
- `src/modules/`의 chat.js, map-token.js, journal.js는 빌드 결과물
- 빌드 안 하고 배포하면 수정이 반영 안 됨
- 파일 순서 변경 금지 (합치는 순서가 곧 실행 순서)
