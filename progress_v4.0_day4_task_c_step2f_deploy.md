# Task C — Step 2-F(명단 업로드) 프로덕션 배포

## 목표
2F 백엔드(명단 업로드→회원 시트 저장, `POST /api/roster/import`) + 우측 명단·연결 드로어 UI를 프로덕션에 FF 배포. 회장님 5분 수동 실측.

## 배포 경위(안전 우선 우회)
- 2F 워크트리(genya-b-2F)는 오래된 베이스(fa253ca) + untracked 잔여파일로 리베이스 체크아웃이 막힘(삭제 권한 거부).
- → **깨끗한 2B 워크트리에서 2F 3커밋 cherry-pick**으로 우회(더 안전·영역 무충돌).
  - 7deaf73(Day1 설계) · ddc20f6(백엔드 roster_import + 엔드포인트) · d475ad5(드로어 UI).
  - 충돌: main_server.js require 줄 1곳뿐(approval vs rosterImport 둘 다 추가) → **양쪽 유지**로 해결. 엔드포인트(1044~)·roster파일·genya.html은 자동병합.

## 무접촉 검증
- **genya.html**: fa253ca 이후 origin/main에서 무수정 확인 → 2F 드로어(+83줄) 병합이 엄마1 후속작업을 덮어쓸 것 0.
- main_server.js 2F 변경 = 순수 추가(require 1줄 + init/엔드포인트). 하이브리드 라우터(Step2-1)·OAuth·approval 영역 무접촉.
- roster_import.js = 독립 모듈(제로 인그레스: 파싱만·회원 시트 write·서버 저장 0).

## 실측(Real)
- `node --check` main_server.js·roster_import.js 통과.
- **백엔드 단위테스트 12/12 통과**(`_test_roster.js`: parse·미리보기 needsConfirm·신규/중복·replace(clear+재작성)·append(보존) 전부).
- 로컬 부팅 스모크: `POST /api/roster/import`→200 needsGoogle 게이트 정직 / `/`(genya.html) 200·드로어 로드 / 회귀 `/결재함`·`/login`·`/me` 200.
- 배포 후 라이브 재검증(아래).

## 회장님 5분 수동 실측 가이드
1. https://genya-builder.onrender.com 로그인 → [구글 연결](시트).
2. 우측 상단 **명단** 드로어 → 엑셀/CSV 명단 업로드.
3. 미리보기(needsConfirm) 확인 → 확정 → 회원 시트 `고객명단` 탭에 저장 확인.
4. 신규/중복/replace/append 동작 확인.

## 배포
- 2B 브랜치 cherry-pick 3커밋 → origin/main 리베이스 → FF push → Render 자동배포.
