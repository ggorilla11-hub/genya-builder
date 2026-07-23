# 팀장 지니야(엄마3) · Day 4 총괄 — v2.0 흡수용 종합 문서

> 미래 Claude가 이 문서 하나로 Day 4 엄마3(통합·자동화·팀장 페르소나) 성과·한계·교훈을 흡수하도록 작성.

## 0. 엄마3 역할
v4.0 "3엄마 병렬" 중 **엄마3 = 통합·자동화·팀장 페르소나**. worktree `genya-b-2B`(feature/step2-B-sheets-crud). 원칙: 엄마1(genya.html)·엄마2(personal_memory·RAG) 무접촉, Step2-1 라우터 무접촉, main FF, **Real API 실측 후 배포**.

## 1. Day 4 성과 (배포·라이브)
| 항목 | 내용 | 커밋 |
|---|---|---|
| 안전 하드가드 | `safeRecipient` 라이브 미명시 시 화이트리스트 강제·폴백=회장님 | 007dfea |
| Function Calling 근본 | 도구 property **한글키→영문키**(Anthropic 400 회피) | 318e249 |
| 시트 통합 Task1 | sheets_crud 6도구 메인대화 배선 | f6cce81 |
| Task A 세션안정성 | durable(Firestore 이메일키) 3중 복원 배선 | 3d5bfed |
| Task B 결재함 UI | `/결재함`·`/approval` 정식화(유니코드 라우트 우회) | ad5c181 |
| Task C Step2-F | 명단 업로드 드로어→`/api/roster/import` | cbb6834 |
| Task D 모닝브리핑 안내 | Render Cron 5분 가이드 | (문서) |
| **팀장-C 웹검색** | `web_search_20260209` 서버도구 통합 | ec9aa34 |
| 팀장-D 컨텍스트 | Step2-A(엄마2)에 이미 구현 확인 | (문서) |

## 2. Real API 자체 실증 결과 (mock 아님·독립)
- **시트 6도구**: 실제 Anthropic API에 스키마 전달 → 6/6 정확 선택, 400없음, input 키 전부 영문(column·name·fields·field·value).
- **결재함 3도구**: "메일 보내줘"→`create_approval`(channel/title/template/criteria 영문). 400버그 재발 0.
- **안전 하드가드**: `safeRecipient('email','외부')` → `{to:회장님번호, blocked:true, safeMode:true}`. 외부 발송 차단 실증.
- **팀장-C 웹검색**: 프로덕션 `/api/order`→오늘자 실환율(1466.8원) 응답.

## 3. OAuth 자동화 한계 (정직)
엄마3(Claude)는 **구글 OAuth 로그인을 자동화할 수 없다**(보안 원칙+브라우저 제약). 따라서 **회원 데이터 종단(시트 실행·캘린더·재로그인·발송)은 직접 통과시킬 수 없고 회장님 실측이 관문**. 브라우저 실측도 이번엔 불가(Playwright 프로필 동시인스턴스 잠금·claude-in-chrome 권한거부).

## 4. 자기답변 문제 — 근본 교훈 ⭐
- **`/api/diag/*`는 "내 코드가 내 코드를 검증"하는 자기답변** → 그것만으로 "통과"라 하면 안 된다(회장님 지적).
- **교훈: "라이브 배포 + 게이트 200" ≠ "실제 종단 통과".** 완주 판정은 ①Real API로 실증한 로직 계층 + ②회장님 실제 로그인 확인, **둘 다** 있어야 한다.
- **교훈2(중대): 부분 실측 금지.** runChat 직접호출은 orderHandler 라우팅(activeSkill·canData·분기순서)을 건너뛴다 → 반드시 실제 `/api/order`로 kind 판정. mock 단위테스트는 실제 API 스키마검증(한글키 400) 못 잡는다 → 실제 Anthropic API 자체실측 필수.
- **교훈3: "완주"라는 단어를 회장님 실측 전에 쓰지 않는다.** 정직히 "부분 통과 + 회장님 실측 대기".

## 5. 무접촉·배포 인프라 메모
- 3엄마 병렬로 origin/main 계속 이동 → 매 배포 전 리베이스(충돌0~1)→node --check→FF push.
- 로컬 실행=워크트리 deploy서 `$env:PORT=809x; node main_server.js`. 로컬포트 8090~8092 점유 시 스모크는 8095(비로컬포트).
- 한글 라우트: 이 Express 버전은 유니코드 리터럴 라우트 매칭 못 함 → `decodeURIComponent(req.path)` 미들웨어 우회.

## 6. 미결(v2.0)
- 팀장-D 심화(관심사 프로파일 카드·톤 EMA 학습): personal_memory(엄마2) 확장 필요 → 데이터 축적 후. 설계=`progress_v4.0_day4_teamleader_d_advanced_design.md`.
- 회장님 5개 실측(시트·재로그인·캘린더·발송·브라우저) 통과 시 v1.0 종단 완주 확정.

## 7. 관련 문서
- 자체검증: `progress_v4.0_day4_self_verification_task_1_A_2_3.md`, `progress_v4.0_day4_selfverify_realapi.md`
- 회장님 실측 안내: `progress_v4.0_day4_owner_final_verify_guide.md`
- 로드맵: `progress_v4.0_day5_day6_roadmap.md`
- 팀장-C/D: `progress_v4.0_day4_phase_teamleader_c_websearch.md`, `..._d_context.md`
