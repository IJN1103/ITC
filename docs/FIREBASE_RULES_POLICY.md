Firebase Rules 권한 정책 정리
=============================

목적
----
이 문서는 현재 운영 Firebase Realtime Database Rules의 권한 기준을 고정하기 위한 문서다.
2026-04-20 기준으로 `database.rules.console-candidate.json`을 Firebase Console에 적용했고, GM/플레이어 2계정 Stage 4 테스트를 통과했다.

현재 파일 기준
--------------
- `database.rules.json`: 현재 Firebase Console에 적용된 운영 기준 Rules.
- `database.rules.console-candidate.json`: Stage 4에서 검증 후 운영 반영된 동일 Rules 후보본.
- `database.rules.hardening-draft.json`: 현재는 운영 기준과 동일하게 맞춰 둔 검토용 파일.
- `database.rules.rollback-current.json`: 하드닝 적용 전 기존 Rules 롤백본.

운영 확정된 권한 기준
--------------------
### 방 삭제
- 방 전체 삭제는 GM/owner만 가능하다.
- 일반 플레이어가 마지막으로 방을 나가도 `rooms/{roomCode}` 전체를 삭제하면 안 된다.
- 클라이언트에서도 일반 플레이어 `leaveRoom()`이 방 전체 삭제를 하지 않도록 방어되어 있다.

### players
- GM/owner는 플레이어 목록, role, permissions를 관리할 수 있다.
- 일반 플레이어는 자기 role을 gm으로 바꾸거나 permissions를 직접 부여할 수 없다.
- 일반 플레이어의 기본 표시 정보는 기존 기능 유지를 위해 필요한 범위에서만 유지한다.

### BGM
- 기본적으로 GM/owner만 BGM을 수정할 수 있다.
- 예외: `players/{uid}/permissions/manageBgm === true`인 플레이어는 BGM playlist/currentTrack 수정 가능.
- 현재 BGM 기능은 완성/실사용 단계가 아니므로 manageBgm 실제 UI 테스트는 보류 상태다.
- BGM 권한자는 맵세팅 데이터(`mapBackground`, `mapObjects`, `mapLayerState` 등)를 수정할 수 없도록 분리한다.

### Tokens
- 기본적으로 GM/owner만 토큰 생성/편집/삭제/이동 가능하다.
- 예외: GM이 플레이어에게 부여한 권한만큼 허용한다.
  - `createToken`: 토큰 생성
  - `moveToken`: 토큰 이동
  - `editToken`: 토큰 편집/삭제
- 권한 없는 플레이어의 무단 토큰 조작은 Rules 레벨에서 차단한다.

### Map / mapScenes
- 맵세팅 ZIP, 레이어, 장면 전환 저장/복제/순서 변경은 GM/owner 중심 기능이다.
- `mapScenes` write는 GM/owner 기준으로 유지한다.
- 맵세팅 관련 `bgm` 하위 키는 BGM 권한과 분리하며, GM/owner 또는 `manageMap` 기준으로 관리한다.

### Journals
현재 코드 기준:
- 저널은 `ownerId`, `assignedTo`를 사용한다.
- GM은 전체 접근 가능.
- 플레이어는 `ownerId === 내 uid` 또는 `assignedTo`에 포함된 저널을 볼 수 있고 편집할 수 있는 구조다.

운영 기준:
- 이번 Rules 하드닝에서는 `journals` read를 per-item 단위로 강하게 잠그지 않았다.
- 이유: 현재 코드는 `rooms/{roomCode}/journals` 전체를 한 번 읽은 뒤 프론트에서 필터링하는 구조이기 때문이다.
- per-item read 하드닝은 저널 로딩 구조를 바꾼 뒤 별도 단계로 진행해야 한다.

권장 장기 정책:
- GM: 모든 저널 읽기/수정/삭제 가능.
- 플레이어: 권한 받은 저널 읽기/수정 가능.
- 삭제는 GM만 허용하는 방향을 권장한다.

### Handouts
현재 코드 기준:
- 핸드아웃은 `ownerId`, `allowedTo`를 사용한다.
- GM/owner는 편집 가능.
- 플레이어는 `allowedTo`에 포함된 핸드아웃만 볼 수 있도록 프론트에서 필터링한다.

운영 기준:
- 이번 Rules 하드닝에서는 `handouts` read를 per-item 단위로 강하게 잠그지 않았다.
- 이유: 현재 코드는 `rooms/{roomCode}/handouts` 전체를 한 번 읽은 뒤 프론트에서 필터링하는 구조이기 때문이다.
- per-item read 하드닝은 핸드아웃 로딩 구조를 바꾼 뒤 별도 단계로 진행해야 한다.

권장 장기 정책:
- GM: 모든 핸드아웃 읽기/수정/삭제/공개대상 관리 가능.
- 플레이어: 허용된 핸드아웃만 읽기 가능.
- 플레이어 수정/삭제는 기본 금지 권장.

Stage 4 적용 결과
----------------
사용자가 Firebase Console에 `database.rules.console-candidate.json`을 적용했고, GM/플레이어 2계정으로 주요 테스트를 통과했다.

확인된 것:
- GM/owner 기능이 막히지 않음.
- 일반 플레이어의 방 전체 삭제가 차단됨.
- 일반 플레이어의 권한 상승 가능성이 줄어듦.
- 채팅/팝아웃/토큰/맵세팅/장면 전환 주요 기능 정상.
- BGM 관련 manageBgm 테스트는 기능 미구축으로 보류.

주의사항
--------
- 이후 새 Firebase 경로를 추가하는 작업은 반드시 Rules 필요 여부를 먼저 확인한다.
- journals/handouts read 하드닝은 코드 로딩 구조 변경 없이 바로 적용하지 않는다.
- 문제가 생기면 `database.rules.rollback-current.json`을 Firebase Console에 다시 붙여넣어 롤백한다.
