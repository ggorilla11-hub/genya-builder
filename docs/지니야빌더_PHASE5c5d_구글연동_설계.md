# 지니야빌더 PHASE 5c·5d — 교육생 구글 연동 + 본인 자료 업로드 설계 (검토안)

> 작성: 2026-06-20 (엔진=엄마 / 코치 검토·승인 대기). **구현 전 설계 문서 — 이 문서는 "검토안"이며, 코치 승인 후에만 구현 착수.**
> 대원칙(B4): **본인 계정 OAuth · 본인 Drive only · 오원트 서버 미저장(참조 ID만) · 점진 동의 · 발행 0접촉 · 회귀 0.**
> 선행 완료: 5a(HMAC 세션·tenant_id 발급) ✅ / 5b(읽기 격리·tenant 미들웨어·per-tenant 저장 골격·★★15문항 B3 합격) ✅

---

## 0. 출발점 (엔진 현실, 정직) — ★가장 중요한 한 가지

**현재 엔진의 구글 연동 4개는 전부 "대표 1인(OWNER) 전용"이다. 교육생 본인 것이 아니다.**

| 연동 | 현재 방식 | 누구 것 | 5c/5d에서 |
|---|---|---|---|
| 유튜브 OAuth (`/youtube/auth`) | refresh_token 1개, 탭 `제니야_유튜브토큰` | 대표 본채널 | **건드리지 않음(발행=OWNER 전용)** |
| Gmail OAuth (`/gmail/auth`) | refresh_token 1개, 탭 `제니야_Gmail토큰`, readonly | 대표 | OWNER 경로 유지, 교육생용은 **별도 per-tenant 신설** |
| 캘린더 읽기 (`/calendar/upcoming`) | **서비스계정**(google-key.json) | 대표가 SA에 공유한 캘린더 | ⚠️ 교육생 본인 것 읽기 **불가**(아래 설명) |
| 드라이브 읽기 (`/drive/files`) | **서비스계정** | 대표가 SA에 공유한 폴더 | ⚠️ 동일하게 불가 |

⚠️ **핵심 깨달음 — 서비스계정으로는 교육생 본인 구글을 못 읽는다.**
서비스계정(SA)은 "대표가 SA 이메일에 공유해준 자원"만 본다. 교육생 70만 명에게 "당신 캘린더를 우리 SA 이메일에 공유하세요"라고 시킬 수 없다(보안·UX 둘 다 파탄). → **교육생 연동은 반드시 "본인 계정 3-legged OAuth"**여야 한다. SA 패턴(캘린더·드라이브 readonly)은 **대표(OWNER) 전용으로 그대로 두고**, 교육생용은 완전히 새 per-tenant OAuth 경로를 만든다.

⚠️ **두 번째 — per-tenant OAuth 토큰 저장소가 아직 없다.**
현재 토큰은 "전역 변수 1개 + 시트 탭 1개"(대표 1인 가정). 교육생마다 본인 토큰을 **암호화해서 tenant_id에 묶어** 저장하는 골격이 없다. 5b-3의 `tenantAppend({tenant}_종류)` 패턴은 있으나, **토큰은 평문 저장 금지** → 암호화 유틸(현재 HMAC 서명만 있고 대칭 암호화는 없음)을 신설해야 한다.

---

## 1. 5a/5b 위에 무엇을 얹나 (재사용 vs 신설)

- ♻️ **재사용:** 5a 구글 로그인 OAuth 클라이언트(교육생은 이미 본인 구글로 로그인) / 5b `tenantMiddleware`(`req.tenant`·`req.isOwner`) / 5b `tenantRead`·`tenantAppend`(탭 prefix `{tenant}_`) / 부팅 복원 IIFE 패턴 / `crypto`(서명·랜덤).
- 🆕 **신설 (4가지):**
  1. **점진 동의 OAuth 경로** — 5a 로그인 OAuth 클라이언트에 스코프를 **필요할 때 추가**(incremental authorization). 본인 refresh_token 획득.
  2. **암호화 토큰 저장소** — AES-256-GCM로 암호화 후 `{tenant}_구글토큰` 탭에 저장. 키는 새 env(예: `GOOGLE_TOKEN_KEY`, 값 노출 금지). tenant는 **서명 세션에서만** 결정(URL·쿼리 주입 차단).
  3. **본인 자료 업로드(5d)** — 바이트는 **교육생 본인 Drive로 직행**, 서버엔 **참조 ID만**.
  4. **온보딩 "연결" UI(s-infra)** — 서비스별 연결/연결됨 카드.

> **5c/5d = "교육생이 본인 구글을 본인 의지로 연결하고, 본인 자료를 본인 Drive에만 둔다."** 오원트는 데이터를 보관·학습하지 않는다(참조 ID만 보관).

---

## 2. 5c — 구글 4종 연결 (본인 계정 OAuth, 점진 동의)

### 2-1. 점진 동의(Incremental Consent) 원칙
처음부터 4종 권한을 다 요구하지 않는다. **로그인은 최소(email)로, 각 기능은 그 기능을 쓰려는 순간에 해당 스코프만 추가 동의**받는다. 신뢰·승인율↑, 과잉권한 방지.

### 2-2. 최소권한 스코프 (least privilege)

| 서비스 | 제안 스코프 | 읽기/쓰기 | 비고 |
|---|---|---|---|
| 캘린더 | `calendar.readonly` | 읽기만 | 일정 조회만. insert/update/delete 미노출(구조적 차단) |
| Gmail | `gmail.readonly` | 읽기만 | **send 스코프 영영 미요청** = 발송 구조적 불가(휴먼인루프) |
| 시트 | `drive.file` (+ 필요시 `spreadsheets`) | 본인 생성분만 | ★검토포인트 A — 아래 질문 |
| 드라이브(5d) | `drive.file` | 본인 생성 파일만 | 전체 Drive 안 봄. 앱이 만든 파일만 접근(프라이버시 최강) |

★ **`drive.file`의 의미:** 우리 앱이 **직접 만든/연 파일만** 접근. 교육생의 기존 전체 드라이브는 못 본다 → "무보존·비학습·최소노출" 원칙에 정확히 부합.

### 2-3. 토큰 저장 (암호화·tenant 바인딩)
- 동의 콜백에서 받은 **refresh_token을 AES-256-GCM 암호화** → 탭 `{tenant}_구글토큰`(행: 서비스·암호문·스코프·연결시각). 평문·로그·깃 어디에도 안 남김(`no-secret-output` 원칙).
- 복호화·사용은 **`req.tenant`(서명 세션)** 로만. 쿼리/URL/바디로 tenant 주입 불가(5b 미들웨어 그대로).
- 부팅 시 시트→메모리 복원(기존 IIFE 패턴), 단 메모리에도 복호화 즉시 폐기(요청 처리 시에만 일시 복호화).

### 2-4. 신설 엔드포인트 (전부 per-tenant, OWNER 경로와 별개)
```
GET  /me/google/status            본인 4종 연결상태(연결됨 O/X·스코프)   ※토큰값 0노출
GET  /me/google/connect?svc=cal   해당 서비스 스코프 동의 시작(점진)
GET  /me/google/oauth2callback     콜백→암호화 저장→연결됨
POST /me/google/disconnect?svc=   본인 토큰 폐기(탭 행 삭제)
GET  /me/calendar                 본인 일정(읽기)         ← 본인 토큰 사용
GET  /me/gmail/recent             본인 메일 메타(읽기)
GET  /me/sheets / drive           본인 자료 목록(읽기)
```
- 기존 `/youtube/*`·`/gmail/*`·`/calendar/*`·`/drive/*`(OWNER·SA)는 **한 줄도 안 건드림 = 회귀 0.**

---

## 3. 5d — 본인 자료 업로드 (본인 Drive only·서버 미저장)

### 3-1. 데이터 흐름 (★바이트는 서버를 거치지 않는 게 목표)
```
교육생 파일 선택
  → (권장) 교육생 본인 토큰 + drive.file 로 본인 Drive에 직접 업로드
  → 서버는 결과 fileId·이름·종류만 받아 {tenant}_자료 탭에 "참조 ID" 기록
  → 오원트 서버·Firebase·디스크에 원본 바이트 0 보관, 학습 0
```
- **무보존·비학습:** 원본은 교육생 Drive에만. 우리는 "어디 있다"는 포인터(fileId)만 안다. 끊으면(토큰 폐기) 우리 쪽엔 포인터만 남고 접근 불가.
- 참조 시점에만 본인 토큰으로 잠깐 열어 읽음(RAG·OCR 등은 그때 일시 처리, 결과만 본인 tenant에).

### 3-2. ★검토포인트 B — 업로드 경로 2안
- **B-1 (권장) 브라우저 직행:** 교육생 브라우저가 본인 토큰으로 Drive에 직접 PUT. **서버에 바이트 0** = "서버 미저장" 가장 깨끗. (구현 난도↑: 프론트 OAuth 토큰 취급)
- **B-2 서버 경유(비저장):** 파일이 서버 메모리를 잠깐 스쳐 본인 Drive로 흘려보내고 **즉시 폐기**(디스크·Firebase 미기록). 구현 쉬우나 "바이트가 서버를 스친다"는 점에서 B4 원칙(서버 미저장)과의 거리감 → 코치 판단 필요.

---

## 4. 발행·자동발송 0접촉 / 회귀 0 (PROTECT)

- 5c/5d는 **읽기·본인저장**만. 발행 파이프라인(60초 시계·발행함수·`solapi.send`·자동발송) **0접촉.**
- 교육생 토큰엔 **발행·발송 스코프 없음**(youtube.upload·gmail.send 미요청) → 구조적으로 발행·발송 불가.
- 기존 OWNER 경로(유튜브·Gmail·캘린더·드라이브 SA)·발행대장·스케줄러 **diff 0**(순수 가산).

---

## 5. ★★ 5c/5d 누수·안전 체크리스트 (B4 합격 기준 — 5b 15문항 위에 추가)

**계정:** A=교육생A · B=교육생B · OWNER=대표. **전부 O 전엔 다음 단계 X.**

| # | 시나리오 | 합격 기준 |
|---|---|---|
| G1 | A세션 `/me/google/status` | A 연결만(B·대표 토큰 0노출) |
| G2 | A세션 `/me/calendar` | A 본인 일정만(대표 SA캘린더 0) |
| G3 | **쿼리주입** `?tenant=B` 로 B 토큰 사용 시도 | 무시(세션 tenant만) |
| G4 | **쿠키 위조**로 B 토큰 호출 | HMAC 불일치→거부 |
| G5 | 시트 토큰 탭 직접 열람 | **암호문만**(평문·refresh_token 안 보임) |
| G6 | A가 disconnect 후 재호출 | A 토큰 폐기됨→거부/재동의 요구 |
| G7 | Gmail **발송** 시도(코드·스코프) | send 스코프 없음→구조적 불가 |
| G8 | 5d 업로드 후 서버·Firebase·디스크 검사 | 원본 바이트 0(참조 ID만) |
| G9 | A 자료 fileId를 B세션이 조회 | A 범위 밖→거부 |
| G10 | OWNER 세션 기존 `/youtube·/calendar` | 기존대로 정상 = **회귀 0** |
| G11 | 토큰 암호화 키(`GOOGLE_TOKEN_KEY`) 로그·깃·응답 | 0노출(이름만) |
| G12 | 만료/철회된 토큰 | graceful(빈/재동의 안내, 크래시 0) |

---

## 6. 착수 순서 (코치 승인 후 — 각 단계 롤백태그→가산→announce→승인→실측)

- **5c-0:** 롤백 태그
- **5c-1:** 암호화 유틸(AES-256-GCM) + `{tenant}_구글토큰` 저장 골격 + `/me/google/status`(읽기, 토큰값 0노출)
- **5c-2:** 점진 동의 1종 먼저(캘린더 readonly) — connect→callback→암호화저장→`/me/calendar` 실독 1건
- **5c-3:** Gmail readonly·시트·드라이브 readonly 순차 추가(같은 패턴)
- **5d-1:** 본인 Drive 업로드(경로 B-1/B-2는 4절 검토 결과대로) + `{tenant}_자료` 참조ID 기록
- **5c/5d-검증:** ★★ 위 G1~G12 누수 테스트(A·B·OWNER 3계정) → 전부 O 후에만 다음
- 발행·자동발송 0접촉 유지

---

## 7. ✅ 확정 결정 (2026-06-20 코치 답)

1. **시트 권한 = 읽기(`readonly`)만 1단계.** 본인 시트 쓰기는 필요성 확인 후 다음.
2. **5d 업로드 = 브라우저 직행(B-1, 서버 바이트 0).** zero data ingress 원칙 — "잠깐 스침"도 회피. 본인 브라우저→본인 Drive 직행, 오원트는 `fileId`만.
3. **OAuth = 5a와 같은 클라이언트 + 점진 동의(incremental).** ★단 **신원 로그인(online)과 데이터 연결(offline·refresh_token AES 암호화 저장)은 흐름 분리.**
4. **연결 카드 = 온보딩(s-infra) 화면**(BL-1 온보딩 신설과 함께). ★단 **엔진은 연결 엔드포인트 + `/me/google/status` 먼저**, UI는 그 다음.
5. **점진 동의 순서 = 캘린더 readonly → 드라이브 → Gmail → 시트.**

### 7-1. #3 흐름 분리 (online 로그인 / offline 데이터연결)
- **신원 로그인(5a, online):** access_type=online, 최소(email/profile). 세션 쿠키(HMAC)만 — 기존 5a 그대로.
- **데이터 연결(5c, offline):** `/me/google/connect?svc=` 가 access_type=offline·prompt=consent·**해당 서비스 스코프만** 추가 동의 → 콜백에서 **refresh_token만 AES-256-GCM 암호화**해 `{tenant}_구글토큰`에 보관. 신원 로그인과 별도 트리거.
- 효과: 로그인은 가볍게(승인율↑), 데이터 권한은 쓸 때 하나씩(최소권한·점진).

### 7-2. #2 브라우저 직행 업로드 — 구현 방식·난이도 (코치 검토용)
**방식(권장):** 프론트(교육생 브라우저)에서 **본인 access_token**으로 Google Drive **resumable upload**를 직접 호출.
```
① 프론트가 엔진에 "업로드용 단기 access_token" 요청
   → 엔진: 저장된 본인 refresh_token(AES 복호) 로 access_token 발급(drive.file)해 *프론트에 단기 토큰만* 전달
     (refresh_token은 서버 밖으로 안 나감, access_token은 1시간 만료)
② 프론트: POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable
   → 받은 업로드 URL로 파일 바이트를 *브라우저→구글* 직접 PUT (서버 경유 0)
③ 완료 후 프론트가 fileId만 엔진에 보고 → 엔진은 {tenant}_자료에 fileId·이름·종류만 기록
```
**난이도/리스크 (정직):**
- 중상(中上). 핵심 난점 = **프론트에 access_token을 잠깐 쥐어주는 부분**(절대 refresh_token은 안 줌, access_token도 짧게·`drive.file`로 최소권한·HTTPS만).
- resumable PUT 진행률·재시도·CORS는 Google 공식 지원(브라우저 업로드 정식 경로)이라 표준대로 하면 됨.
- 대안(쉬움) = B-2 서버 무저장 경유였으나 **코치가 zero ingress로 B-1 확정** → 이 방식 채택.
- ★ 이 부분은 5d 단계라 5c(캘린더 readonly 등) 다 된 뒤 별도로 설계·실증. 지금은 방향만 확정.

---

## 8. 착수 진행상황 (각 단계 롤백태그→가산→announce→승인→실측·회귀0)

- **5c-0:** 롤백 태그 `rollback-before-5c` ✅
- **5c-1 ✅ (커밋 77c90cf):** AES-256-GCM 유틸(`encToken`/`decToken`, 키=`GOOGLE_TOKEN_KEY`) + `{tenant}_구글토큰` 저장 골격(`gtokenRows`/`gtokenStatus`) + `GET /me/google/status`(읽기·토큰값0). OAuth 미연결=연결0. 실측: node --check·AES라운드트립(평문미포함)·status·발행/AI손 회귀0.
- **5c-2 (다음):** 점진 동의 캘린더 readonly — `/me/google/connect?svc=calendar`→`/me/google/oauth2callback`→AES 저장→`/me/calendar` 실독 1건. (대표 1회 셋업: GCP 콘솔 calendar.readonly 스코프 등록·동의화면.)
- **5c-3:** 드라이브→Gmail→시트 readonly 순차(같은 패턴).
- **5d-1:** 브라우저 직행 업로드(7-2 방식) + `{tenant}_자료` fileId 기록.
- **검증:** ★★ G1~G12(A·B·OWNER 3계정) 전부 O 후 다음.

---

> **다음 = 5c-2(캘린더 readonly 점진 동의) 구현.** 발행 PROTECT·회귀0·토큰 평문 0 유지. 5d 브라우저 직행은 5c 완료 후 별도 실증.
