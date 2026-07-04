# 지니야빌더 배포 가이드 (Render)

> 이 `deploy/` 폴더는 배포 전용으로 이식된 자립 실행판입니다.
> 로컬 절대경로·다른 폴더 의존성을 전부 npm/상대경로로 바꿔, `npm install` 후 `node main_server.js`만으로 부팅됩니다.
> **로컬 배포구조 부팅 실측 통과**(포트 8091, /login·/api/skills = HTTP 200).

## 대원칙 (유지됨)
- 회원 데이터 서버 저장 0 — 세션=메모리, 파일=브라우저 직행, 데이터=회원 구글
- 박수근 개인 라우트 무접촉 (이 폴더에 포함 안 됨)

---

## 1) 대표님 — Render에 올리기
1. GitHub에 `deploy/` 내용을 새 저장소(또는 genya-builder 레포의 배포 브랜치)로 push
   - `.gitignore`가 `node_modules`·`.env`를 제외합니다 (키·용량 안전)
2. render.com → **New → Web Service** → 그 저장소 연결
3. 설정:
   - **Build Command**: `npm install`
   - **Start Command**: `node main_server.js`
   - **Environment**: Node
4. **Environment 탭**에 환경변수 입력 (`.env.example` 참고 — 실제 키는 여기에만):
   - `OPENAI_API_KEY` ★필수 (없으면 서버 부팅 실패)
   - `PINECONE_API_KEY` ★필수
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT` = `https://<배포도메인>/auth/google/callback`
   - `GOOGLE_SA_JSON` = google-key.json 내용 전체(한 줄 JSON)
   - `CAL_ID` = `primary`
   - (카카오 쓰면) `KAKAO_REST_KEY`, `KAKAO_REDIRECT`
5. 배포 → **접속 URL 확보** (예: `https://genya-builder.onrender.com`)

> HTTPS·PORT·`RENDER` 환경변수는 Render가 자동 제공 → Secure 쿠키 자동 활성화

## 2) 대표님 — GCP OAuth 설정 (배포 도메인 + 교육생 8명)
1. console.cloud.google.com → API·서비스 → **사용자 인증 정보**
2. OAuth 2.0 클라이언트 → **승인된 리디렉션 URI** 추가:
   `https://<배포도메인>/auth/google/callback`
3. **승인된 JavaScript 원본** 추가: `https://<배포도메인>`
4. **OAuth 동의 화면 → 테스트 사용자**에 교육생 8명 이메일 추가 (테스트 모드 유지 시)
   - 또는 **게시(Production)** 전환 (심사 필요할 수 있음)
5. 스코프 확인: `openid·email·profile·calendar.readonly·spreadsheets·drive.readonly·drive.file`

## 3) URL 나오면 — OG·카톡 (엄마가 완성)
- 배포 URL 알려주시면 OG 태그(제목·설명·썸네일) 심고 카톡 공유 문구 완성

---

## 파일 구성
- `main_server.js` — 통합 서버 (로그인·온보딩·홈·작업공간·API)
- `onboarding.html·home.html·main.html` — 화면 (login은 서버 인라인)
- `yakgwan_module.js` — 약관 RAG (Pinecone)
- `memory_module.js` — 기억 (회원 구글시트)
- `skills_index.js` + `pdf/excel/ppt/doc_skill.js` — 문서 생성
- `connectors_index.js` + 커넥터들 — 구글·발굴·리스닝·웹조사·gmail
- `yakgwan_pages.json` — 약관 데이터(276p)
- `package.json` — 의존성

## 알려진 제약 (정직)
- **발굴 브라우저 수집(playwright)은 배포에서 비활성** — 무거워서 제외. 발굴 "분류·안내" 로직은 유지, 실제 유튜브 댓글 수집은 로컬에서만. (leads_connector가 playwright를 지연 로딩 try/catch로 감싸 부팅엔 지장 없음)
- **OPENAI/PINECONE 키는 필수** — 없으면 부팅 실패(web_research·yakgwan이 시작 시 클라이언트 생성)
