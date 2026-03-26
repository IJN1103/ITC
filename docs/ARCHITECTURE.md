# ITC TRPG v2 — 아키텍처 설계 문서

## 1. 현재 문제 진단

| 영역 | 현재 상태 | 문제 |
|------|----------|------|
| 파일 구조 | 단일 `index.html` (6,100+ 줄, 221개 함수) | 유지보수 불가, 코드 탐색 어려움 |
| 이미지 | Base64 → RTDB 저장 | 1개 스탠딩 = ~200KB JSON, 로딩 시 전체 저널 데이터 폭증 |
| 채팅 동기화 | `onValue(chat)` | 메시지 100개 시 100개 전체 재전송, 300명이면 초당 30,000건 |
| 토큰/맵 | `onValue(tokens)` | 토큰 1개 이동 → 전체 토큰 데이터 재수신 |
| 시스템별 로직 | CoC만 구현, 나머지 stub | 확장 구조 없음 |
| 메모리 | DOM 무한 누적 | 채팅 1,000개 → DOM 노드 5,000+개, 브라우저 버벅임 |

## 2. 목표 아키텍처

```
┌─────────────────────────────────────────────┐
│                index.html                    │
│  (최소 HTML 셸 + <script> 로더만)              │
├─────────────────────────────────────────────┤
│              app.js (Entry Point)            │
│  Firebase 초기화 → Auth → Router             │
├──────┬──────┬───────┬───────┬───────────────┤
│ auth │ chat │ map   │ token │ journal  ...   │  ← 기능 모듈
├──────┴──────┴───────┴───────┴───────────────┤
│            core/firebase.js                  │  ← Firebase 추상화
│            core/storage.js                   │  ← Storage 유틸
│            core/state.js                     │  ← 전역 상태
│            core/events.js                    │  ← 이벤트 버스
├─────────────────────────────────────────────┤
│         systems/{coc7,dx3,...}/index.js       │  ← 룰별 플러그인
└─────────────────────────────────────────────┘
```

## 3. 폴더 구조

```
itc-trpg-v2/
├── index.html                  # 최소 셸 (DOM 스켈레톤 + 로더)
├── styles/
│   ├── base.css                # 리셋, CSS 변수, 타이포
│   ├── layout.css              # 그리드, 패널, 반응형
│   ├── chat.css                # 채팅 메시지 스타일
│   ├── map.css                 # 맵/토큰 스타일
│   ├── modal.css               # 모달 공통
│   └── systems.css             # 시스템별 캐릭터시트
├── src/
│   ├── app.js                  # 엔트리포인트
│   ├── core/
│   │   ├── firebase.js         # Firebase 초기화 + 헬퍼
│   │   ├── storage.js          # Firebase Storage 업로드/다운로드
│   │   ├── state.js            # 전역 상태 (St 객체 + 반응형)
│   │   ├── events.js           # 이벤트 버스 (모듈 간 통신)
│   │   └── image-utils.js      # WebP 변환, 리사이징, 압축
│   ├── modules/
│   │   ├── auth/
│   │   │   └── auth.js         # 로그인/회원가입/Google
│   │   ├── chat/
│   │   │   ├── chat.js         # 메시지 송수신 (onChildAdded)
│   │   │   ├── chat-renderer.js # 가상 스크롤 + DOM 관리
│   │   │   ├── casual.js       # 잡담 탭
│   │   │   └── whisper.js      # 귓말 시스템
│   │   ├── journal/
│   │   │   ├── journal.js      # CRUD + Firebase 동기화
│   │   │   ├── sheet.js        # 캐릭터 시트 편집
│   │   │   └── sheet-assign.js # 소유권/공유
│   │   ├── map/
│   │   │   ├── map.js          # 맵 배경, 그리드
│   │   │   └── map-viewport.js # 줌/팬 시스템
│   │   ├── token/
│   │   │   ├── token.js        # 토큰 CRUD
│   │   │   ├── token-drag.js   # 드래그 앤 드롭
│   │   │   └── token-edit.js   # 편집 모달
│   │   ├── dice/
│   │   │   ├── dice.js         # 다이스 엔진
│   │   │   └── dice-ui.js      # 다이스 버튼/결과 표시
│   │   ├── bgm/
│   │   │   └── bgm.js          # 배경음악 관리
│   │   ├── permissions/
│   │   │   └── permissions.js  # 권한 시스템
│   │   └── popout/
│   │       └── popout.js       # 팝아웃 창 관리
│   ├── systems/
│   │   ├── registry.js         # 시스템 레지스트리
│   │   ├── coc7/
│   │   │   ├── index.js        # CoC 7판 플러그인
│   │   │   ├── schema.js       # 데이터 스키마
│   │   │   ├── sheet-ui.js     # 캐릭터시트 렌더링
│   │   │   └── dice.js         # CoC 전용 다이스 (1d100, 펀블, 크리티컬)
│   │   ├── dx3/
│   │   │   ├── index.js        # 더블크로스 플러그인
│   │   │   ├── schema.js       # 침식률, 이펙트
│   │   │   └── sheet-ui.js
│   │   ├── insane/
│   │   │   ├── index.js        # 인세인 플러그인
│   │   │   ├── schema.js       # 광기 카드, 호기심표
│   │   │   └── sheet-ui.js
│   │   └── shinobigami/
│   │       ├── index.js        # 시노비가미 플러그인
│   │       ├── schema.js       # 비밀(핸드아웃), 감정
│   │       └── sheet-ui.js
│   └── utils/
│       ├── dom.js              # DOM 유틸 (esc, fmtText, ...)
│       ├── time.js             # 시간 포맷
│       └── virtual-scroll.js   # 가상 스크롤 엔진
```

## 4. Firebase 데이터 스키마 (v2)

### 4.1 RTDB 구조 (URL만 저장, 이미지 X)

```
rooms/{roomCode}/
├── meta/
│   ├── ownerId: "uid"
│   ├── system: "coc7" | "dx3" | "insane" | "shinobigami"
│   ├── title: "세션 제목"
│   ├── createdAt: timestamp
│   └── mapBgUrl: "https://storage.../map-bg.webp"   ← URL만!
├── players/{uid}/
│   ├── name: "닉네임"
│   ├── role: "gm" | "player"
│   ├── online: true/false
│   ├── permissions/
│   │   ├── moveToken: true
│   │   ├── createToken: true
│   │   └── ...
│   ├── currentJournalId: "jid"
│   ├── nameColor: "#b89a60"
│   └── casualNick: "잡담닉"
├── chat/{pushId}/                    ← onChildAdded
│   ├── name: "캐릭터명"
│   ├── text: "메시지"
│   ├── type: "normal" | "speak-as" | "dice" | "dsec" | "whisper"
│   ├── uid: "발신자uid"
│   ├── time: timestamp
│   ├── nameColor: "#ff6b6b"
│   ├── speakAsJournalId: "jid"
│   ├── speakAsAvatarUrl: "https://storage.../av.webp"  ← URL
│   └── standingImgUrl: "https://storage.../st.webp"    ← URL
├── casual/{pushId}/                  ← onChildAdded
├── tokens/{tokenId}/                 ← onChildAdded + onChildChanged
│   ├── name, x, y, rotation, tokenSize
│   ├── tokenImgUrl: "https://storage.../token.webp"    ← URL
│   ├── standings: [{ label, imgUrl }]                   ← URL
│   └── ...
├── journals/{journalId}/            ← onChildAdded + onChildChanged
│   ├── title, body, ownerId
│   ├── avatarUrl: "https://storage.../avatar.webp"     ← URL
│   ├── sheet: { ... 시스템별 데이터 }
│   ├── assignedTo: ["uid1", "uid2"]
│   └── nameColor: "#ff6b6b"
├── typing/{uid}/
│   └── t: timestamp
└── bgm/
    ├── playlist: [{ title, url }]
    ├── current: 0
    └── playing: true
```

### 4.2 Firebase Storage 경로

```
rooms/{roomCode}/
├── map-bg/
│   └── {timestamp}.webp           # 맵 배경 (최대 5MB)
├── tokens/{tokenId}/
│   ├── token.webp                 # 토큰 이미지 (최대 1MB)
│   └── standings/
│       └── {label}.webp           # 스탠딩 이미지 (최대 2MB)
├── journals/{journalId}/
│   └── avatar.webp                # 저널 아바타 (최대 1MB)
└── profiles/{uid}/
    └── avatar.webp                # 유저 프로필 (최대 1MB)
```

## 5. 핵심 모듈 설계

### 5.1 core/state.js — 반응형 전역 상태

```javascript
// 상태 변경 시 구독자에게 자동 통보
const state = createReactiveState({
  roomCode: '',
  myId: '',
  myName: '',
  isGM: false,
  system: 'coc7',
  players: {},
  tokens: {},
  // ...
});

state.subscribe('players', (newPlayers) => {
  refreshMyPerms();
  refreshPermUI();
  renderPlayers(newPlayers);
});
```

### 5.2 core/storage.js — 이미지 업로드 파이프라인

```
[파일 선택] → [WebP 변환] → [리사이징] → [용량 체크] → [Storage 업로드] → [URL 반환]

processImage(file, { maxWidth: 800, maxSize: 2MB, format: 'webp' })
  → Promise<{ url: string, path: string }>
```

### 5.3 chat/chat.js — onChildAdded 기반

```
기존: onValue(chatRef) → 전체 교체 (O(n) 매번)
변경: onChildAdded(chatRef) → 새 메시지만 추가 (O(1) 매번)

+ limitToLast(100)로 초기 로딩
+ 스크롤 위로 올리면 이전 메시지 lazy load
```

### 5.4 utils/virtual-scroll.js — DOM 최적화

```
전체 메시지: 10,000개
DOM에 존재: ~50개 (화면 + 버퍼)
나머지: 높이만 보존 (placeholder div)

스크롤 시 → 보이는 영역 계산 → 필요한 노드만 렌더
```

### 5.5 systems/registry.js — 룰 플러그인

```javascript
const SYSTEMS = {
  coc7:        { name: 'CoC 7판',     module: () => import('./coc7/index.js') },
  dx3:         { name: '더블크로스3rd', module: () => import('./dx3/index.js') },
  insane:      { name: '인세인',       module: () => import('./insane/index.js') },
  shinobigami: { name: '시노비가미',    module: () => import('./shinobigami/index.js') },
};

// 각 시스템은 동일한 인터페이스 구현
interface TRPGSystem {
  schema: CharacterSchema;
  renderSheet(container, data): void;
  renderDice(container): void;
  rollDice(formula): DiceResult;
  getDefaultCharacter(): object;
}
```

## 6. 시스템별 데이터 스키마

### 6.1 CoC 7판

```javascript
{
  system: 'coc7',
  stats: { str, con, siz, dex, app, int, pow, edu },
  derived: { hp, hpMax, mp, mpMax, san, sanMax, luck, db, build, move },
  skills: { '도서관': { base: 20, added: 0, checked: false }, ... },
  combat: [{ name, skill, dmg, range, atk, ammo, mal }],
  backstory: { appearance, ideology, wounds, ... },
  // CoC 전용
  madness: { temporary: null, indefinite: null },  // 광기 상태
  sanityBreakpoints: { mythosMax: 99 },
}
```

### 6.2 더블크로스 3rd

```javascript
{
  system: 'dx3',
  breed: 'crossbreed',          // 퓨어, 크로스, 트라이
  syndromes: ['angel-halo', 'balor'],
  encroachment: { base: 30, current: 30 },  // 침식률
  lois: [{ name, relation, positive, negative, sublimation }],
  titus: [{ name, effect }],
  powers: [{ name, level, timing, skill, dfclty, target, range, cost, restrict, effect }],
  stats: { body, sense, mind, social },
  skills: { melee: 1, ranged: 0, rc: 0, ... },
  hp: { current: 30, max: 30 },
  initiative: 7,
}
```

### 6.3 인세인

```javascript
{
  system: 'insane',
  // 특기표 (6x11)
  skills: {
    violence: [false,false,...],   // 폭력 (11개)
    emotion:  [false,false,...],   // 감정
    perception:[false,false,...],  // 지각
    technology:[false,false,...],  // 기술
    knowledge: [false,false,...],  // 지식
    charm:     [false,false,...],  // 매력
  },
  hp: { current: 6, max: 6 },
  sanity: { current: 6, max: 6 },
  // 광기 카드 (비밀)
  madnessCards: [{ id, name, trigger, effect, revealed: false }],
  // 호기심표
  curiosity: [{ target, question, known: false }],
  handouts: [{ id, title, publicText, secretText, owner }],
}
```

### 6.4 시노비가미

```javascript
{
  system: 'shinobigami',
  clan: 'hasuba',               // 유파
  rank: 'chunin',
  // 특기표 (6x11)
  skills: { /* insane과 유사한 구조 */ },
  // 닌법
  ninjutsu: [{ name, type, skill, cost, range, effect, gap }],
  hp: { current: 6, max: 6 },
  // 감정 (다른 PC에 대한)
  emotions: [{ targetId, positive, negative, revealed: false }],
  // 비밀 (핸드아웃)
  secrets: [{ id, title, text, owner, sharedWith: [] }],
  // 프라이즈
  prize: null,
}
```

## 7. 마이그레이션 전략

### Phase 1: Storage 도입 (비파괴적)
1. `core/storage.js` + `core/image-utils.js` 작성
2. 이미지 업로드 함수를 Storage 기반으로 교체
3. 기존 Base64 데이터 → 자동 마이그레이션 (첫 로딩 시 Storage 업로드 + URL 교체)

### Phase 2: 채팅 최적화
1. `onValue(chat)` → `onChildAdded(chat)` + `limitToLast(100)`
2. 가상 스크롤 적용
3. 기존 메시지 호환 유지

### Phase 3: 모듈 분리
1. `core/` 먼저 추출
2. `modules/chat/` → `modules/token/` → 순차 분리
3. 각 단계에서 기존 기능 100% 호환 테스트

### Phase 4: 시스템 확장
1. CoC를 플러그인 구조로 리팩토링
2. DX3 → 인세인 → 시노비가미 순차 구현

## 8. 번들러 없는 모듈 로딩 전략

```html
<!-- index.html -->
<script type="module">
  // ES Modules는 모든 모던 브라우저 지원 (Chrome 61+, Firefox 60+, Safari 11+)
  import { initApp } from './src/app.js';
  initApp();
</script>
```

각 모듈은 `export`/`import`로 의존성 관리. 번들러 없이 브라우저 네이티브 ES Modules 사용.
프로덕션 배포 시에만 선택적으로 esbuild/vite 적용 가능.
