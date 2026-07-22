# progress_v4.0 · Step 2-A Day2 (플랜 업그레이드 후 재시도) · 엄마2

- **작성일**: 2026-07-22
- **브랜치**: `feature/step2-A-personalization` (로컬 · 미푸시)
- **상태**: 🟢 **시나리오 2 통과** (Pinecone Standard Trial · 429 해제 후)

## 재시도 결과
| 단계 | 결과 |
|---|---|
| Step 1 · upsert(벡터 저장) | ✅ **429 → 200 성공** (`id` 반환, 네임스페이스 저장 확인) |
| Step 2 · 시나리오2 "어제 만든 자료 뭐였지?" | ✅ **통과** → "재테크 아카데미 3기 커리큘럼 초안" 조회 |

## 진단·수정 (정직)
- 처음 조회가 빈 값이었던 진짜 원인: 저장은 됐으나 **유사도 0.150**이 필터(0.2)에 걸러짐.
- **"어제 만든 자료"는 의미검색이 약한 "최근순" 질의** (명세서 시나리오2 = "생성물 벡터 조회 · 최근 순 정렬").
- 수정: `personal_memory.js`에 **`recallRecent`(source 필터 + timestamp 내림차순)** + **`recallSmart`**(시간·회상 질의면 최근순, 아니면 의미검색) 추가. MIN_SCORE 0.2→0.1.
- 대화 배선(`orderHandler`)을 `recallContext` → `recallSmart`로 교체.

## 서브태스크 (명세서 A-1~A-7)
| # | 태스크 | 상태 |
|---|---|---|
| A-1 | 인덱스 ohwant-genya | ✅ 라이브 |
| A-2 | 네임스페이스 | ✅ |
| A-3 | 임베딩(text-embedding-3-small) | ✅ |
| A-4 | 대화 자동 저장 미들웨어 | ✅ |
| A-5 | 유사/최근순 조회 주입 | ✅ (recallSmart) |
| A-6 | 문서·업로드 파싱·임베딩 | ⬜ 다음(coverage/analyze에 source=upload 훅) |
| A-7 | 생성물 자동 저장 | ⬜ 다음(compare/policy/pension에 source=generated 훅) |

## 다음
- A-6 · A-7 훅(문서·생성물 자동 임베딩) → 시나리오1(고객 기억)·10(문서생성연결) 대비
- genyaPersona 배선은 A+E 통합(결재) 시 적용(스펙 완비)

## 절대유지
✅ ohwant-homepage 무접촉 · Step2-1 프로덕션 그대로 · main push 금지 · 엄마3 브랜치 무접촉
