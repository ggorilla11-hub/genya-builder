# Task 3 (Step 2-F) — 명단 드로어 부분 실측 리포트

## 회장님 요청
Playwright로 드로어 렌더·열림 부분 실측. 명단 업로드 UI 뜨는지 확인. **완전 종단 X · 부분 OK.**

## 정직: 브라우저 렌더 실측은 실행 못 함
- **Playwright**: 프로필이 **동시 실행 인스턴스에 잠김**("Browser is already in use … use --isolated") → 재사용 불가.
- **claude-in-chrome(실제 Chrome 대체 시도)**: **사용자 권한 거부**로 이동 불가.
- → 실제 브라우저에서 드로어를 눈으로 열어보는 실측은 이번엔 불가.

## 대신: 코드 레벨 부분 검증(genya.html 읽기만·엄마1 무접촉)
드로어 UI가 실제로 존재하고 **2F 백엔드에 정확히 배선**됐음을 소스에서 확인:

| 요소 | 위치(genya.html) | 확인 |
|---|---|---|
| "📇 명단·연결" 버튼 | 649 | `onclick="genyaHub()"` |
| 드로어 열기 | 2827 `genyaHub()` | `#ghOv` 오버레이 display:block + `.on` 트랜지션 + `ghLoad()` |
| 드로어 오버레이 | 2803 `#ghOv` | 존재(바깥 클릭 시 ghClose) |
| 파일 업로드 입력 | 2811 `#ghFile` | `type=file accept=.xlsx,.xls,.csv` → onchange `ghPick` |
| 미리보기 영역 | 2813 `#ghPv` | 존재 |
| **2F 백엔드 연결** | 2843·2855 | **`POST /api/roster/import`** — 미리보기(confirm:false) → 저장(confirm:true·mode append/replace) |
| 구글 게이트 | 2844 | `needsGoogle/needsConnect` 시 "구글 연결 필요" 안내 |
| 안전(replace) | 2853 | "덮어쓰기 되돌릴 수 없어요" 확인창 |

→ 버튼→드로어 열림→파일선택→**/api/roster/import**(2F 엔드포인트) 플로우가 소스상 완결·정확 배선됨.

## 종합 검증 상태
- ✅ **백엔드 완주**: 단위 12/12(`_test_roster.js`), 라이브 `POST /api/roster/import` 200·needsGoogle 게이트 정직.
- ✅ **드로어 존재·배선(코드)**: 버튼→genyaHub→ghOv+ghFile→/api/roster/import(미리보기/저장/모드/게이트) 소스 확인.
- ✅ **서빙 확인(HTTP)**: 라이브 `/` 200·genya.html에 명단 드로어 마크업 포함.
- ⚠️ **브라우저 렌더·열림·실제 업로드(눈확인)**: 미실행(Playwright 잠금·Chrome 권한거부). **완전 종단 X.**

## 회장님 최종 확인(가장 확실)
genya-builder.onrender.com 접속 → 우측 상단 **📇 명단·연결** 클릭 → 드로어 열림 + 엑셀/CSV 선택 → 미리보기 → [추가/덮어쓰기]. (실제 시트 저장은 구글 연결 후.)

## 무접촉
genya.html(엄마1)은 **읽기만**. 수정 0.
