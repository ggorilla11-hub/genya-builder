// 🔑 서비스 계정 인증 (구글 시트 접근 전용)
//   역할 분리: 구글 로그인(OAuth) = 사용자 인증(누구인지) / 서비스 계정 = 시트 데이터 접근(읽기·쓰기)
//   Render 환경변수 GOOGLE_SERVICE_ACCOUNT_JSON 에 서비스 계정 키(JSON)를 등록해 사용.
//   ★주의(다회원 격리): SA는 '공유된 시트'만 본다. 회원이 여럿이 되면 loadTable을 '이름 검색'이 아니라
//   '회원별 시트ID 지정'으로 바꿔야 남의 명단이 섞이지 않는다. (온보딩 확장 전 필수)
const { google } = require('googleapis');

let _auth = null;
async function getServiceAuth() {
  if (_auth) return _auth;
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  _auth = await auth.getClient();
  // 확인용 로그(1회): 어떤 서비스 계정으로 붙었는지. ★키(private_key) 등 시크릿은 절대 안 찍음 — 이메일만.
  console.log('[🔑SA] 서비스계정 인증 준비 완료 · ' + (creds.client_email || '(client_email 없음)'));
  return _auth;
}

module.exports = { getServiceAuth };
