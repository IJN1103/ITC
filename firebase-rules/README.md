# Firebase Rules Archive

이 폴더는 운영 기준 Rules가 아닌 Firebase Rules 관련 보조 파일을 보관합니다.

- `../database.rules.json`: 현재 운영 기준 Rules. 루트에 유지합니다.
- `database.rules.console-candidate.json`: 운영 적용 전후 비교용 후보 기록본입니다.
- `database.rules.hardening-draft.json`: 권한 강화 검토/초안 기록본입니다.
- `database.rules.rollback-current.json`: 권한 강화 전 기존 Rules 롤백본입니다.

주의:
- Firebase Console에 적용할 기본 파일은 루트의 `database.rules.json`입니다.
- 문제가 생겼을 때만 `database.rules.rollback-current.json` 내용을 Firebase Console Rules에 붙여넣어 롤백합니다.
