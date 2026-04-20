Firebase Rules 권한 정책 정리
=============================

목적
----
이 문서는 Firebase Realtime Database Rules를 강화하기 전에, 현재 프로젝트의 권한 정책을 고정하기 위한 기준 문서다.
실제 Firebase Console Rules를 바꾸기 전에 반드시 이 문서를 확인한다.

현재 확인된 위험
----------------
1. rooms/{roomCode}/players 상위에 `.write: auth != null`이 열려 있으면 인증된 유저가 player 정보/권한/role을 넓게 수정할 수 있다.
2. rooms/{roomCode} 상위 `.write`에 일반 참가자 삭제 조건이 있으면, 일반 플레이어도 방 전체를 삭제할 수 있는 구조가 될 수 있다.
3. bgm/tokens/journals/handouts가 참가자 전체 write로 열려 있으면 UI에서 막아도 Rules 수준에서 우회 가능성이 남는다.
4. dmChats는 코드에서 사용하는 경로지만, 기존 콘솔 Rules에는 명시 규칙이 없었다. 상위 write를 좁히기 전에 dmChats 규칙을 반드시 추가해야 한다.

확정된 기획 기준
----------------
### 방 삭제
- 방 전체 삭제는 GM/owner만 가능해야 한다.
- 일반 플레이어가 마지막으로 방을 나가더라도 rooms/{roomCode}를 직접 삭제하면 안 된다.

### players
- GM/owner는 player 목록/권한/강퇴 관리 가능.
- 플레이어 본인은 자기 닉네임, 아바타, 색상, online 등 자기 표시 정보만 수정 가능.
- 플레이어 본인이 자기 role을 gm으로 바꾸거나 permissions를 직접 부여하는 것은 금지.

### BGM
- 기본적으로 GM/owner만 수정 가능.
- 예외: GM이 `players/{uid}/permissions/manageBgm === true`를 부여한 플레이어는 BGM 수정 가능.

### Tokens
- 기본적으로 GM/owner만 생성/편집/삭제/이동 가능.
- 예외: GM이 플레이어에게 부여한 권한만큼 가능.
  - `createToken`: 토큰 생성
  - `moveToken`: 토큰 이동
  - `editToken`: 토큰 편집/삭제
- 현재 UI 코드도 위 권한명을 사용한다.

### Journals
현재 코드 기준:
- 저널은 `ownerId`, `assignedTo`를 사용한다.
- GM은 전체 접근 가능.
- 플레이어는 `ownerId === 내 uid` 또는 `assignedTo`에 포함된 저널을 볼 수 있고 편집할 수 있는 구조다.

권장 정책:
- GM: 모든 저널 읽기/수정/삭제 가능.
- 플레이어: 권한 받은 저널 읽기/수정 가능.
- 삭제는 가능하면 GM만 허용하는 것이 안전하다.

주의:
- 현재 코드가 `rooms/{roomCode}/journals` 전체를 한 번 읽은 뒤 프론트에서 필터링하는 구조다.
- Rules에서 저널별 read를 엄격하게 걸려면, 코드도 저널 단건/권한 인덱스 기반 로딩으로 바꿔야 한다.
- 따라서 journals read 하드닝은 코드 변경 없이 바로 적용하면 기능이 깨질 수 있다.

### Handouts
현재 코드 기준:
- 핸드아웃은 `ownerId`, `allowedTo`를 사용한다.
- GM/owner는 편집 가능.
- 플레이어는 `allowedTo`에 포함된 핸드아웃만 볼 수 있도록 프론트에서 필터링한다.

권장 정책:
- GM: 모든 핸드아웃 읽기/수정/삭제/공개대상 관리 가능.
- 플레이어: 허용된 핸드아웃만 읽기 가능.
- 플레이어 수정/삭제는 기본 금지 권장.

주의:
- 현재 코드가 `rooms/{roomCode}/handouts` 전체를 한 번 읽은 뒤 프론트에서 필터링하는 구조다.
- Rules에서 핸드아웃별 read를 엄격하게 걸려면 코드 구조 변경이 필요하다.
- 즉, handouts read 하드닝은 별도 단계로 분리해야 한다.

이번 단계에서 한 작업
--------------------
1. 현재 콘솔 Rules를 `database.rules.json`으로 프로젝트에 보관했다.
2. 콘솔 적용 전 검토용 초안을 `database.rules.hardening-draft.json`으로 추가했다.
3. 일반 플레이어가 마지막으로 방을 나가더라도 클라이언트에서 rooms/{roomCode}를 자동 삭제하지 않도록 방어 코드를 추가했다.
4. 실제 Firebase Console Rules는 아직 변경하지 않는다.

다음 단계 권장 순서
------------------
1. `database.rules.hardening-draft.json` 문법/정책 검토.
2. 코드가 쓰는 모든 경로가 draft Rules에 있는지 점검.
3. 테스트 방에서 Firebase Console Rules를 임시 적용.
4. GM/플레이어 2계정으로 아래를 확인.
   - 방 생성/입장/퇴장
   - GM 방 삭제 가능
   - 플레이어 방 삭제 불가
   - 권한 없는 플레이어 BGM 수정 불가
   - manageBgm 권한 플레이어 BGM 수정 가능
   - 권한 없는 플레이어 토큰 생성/편집/삭제 불가
   - create/move/edit 권한별 토큰 기능 확인
   - 저널/핸드아웃 기존 기능 회귀 여부 확인
5. 문제가 없을 때만 실제 운영 Rules로 반영.

Stage 2 보강 내용
-----------------
1. 일반 플레이어가 방을 나갈 때 클라이언트에서 방 전체를 삭제하지 않도록 `leaveRoom()`을 보강한다.
2. BGM은 원격 수신 재생과 직접 수정 재생을 분리한다.
   - 원격 수신: 권한 없이도 화면/재생 상태 반영.
   - 직접 수정: `manageBgm` 권한 필요.
3. `database.rules.hardening-draft.json`에서 room meta read는 방 참가 전 코드 입력 흐름을 위해 `auth != null`로 유지한다.
4. `players` read는 입장 인원 확인 흐름 때문에 일단 `auth != null`로 유지한다.
5. 토큰 권한은 create/move/edit을 분리하되, moveToken은 x/y 좌표 쓰기만 허용하는 방향으로 초안을 보강한다.
6. dmChats meta 생성은 owner/GM 기준으로 제한한다.

주의
----
Stage 2 초안은 운영 콘솔에 바로 반영하기 전 테스트 방에서 확인해야 한다.
특히 joinRoom, reserveSeatAndJoinRoom, BGM, token 권한은 Rules 적용 후 반드시 2계정으로 검증한다.
