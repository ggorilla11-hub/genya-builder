// gmail_connector.js — 🔌커넥터창고: Gmail 커넥터 (정직 상태 + 초안). ★발송 0.
// SA 불가(개인 Gmail 도메인위임 안됨) → claude.ai Gmail MCP(OAuth, /mcp)만. 이 CLI 세션 미인증.
'use strict';
function status() {
  return { id: 'gmail', connected: false, method: 'claude.ai Gmail MCP (OAuth · /mcp에서 인증)', note: 'SA 불가(개인@gmail 도메인위임 X) · 이 세션 미인증 → 받은편지 읽기 대기' };
}
/** 만기 안내 등 메일 초안(발송 안 함, 사람 확인 게이트). */
function draftMail(to, topic) {
  const t = topic || '자동차보험 만기 안내';
  return {
    to: to || '고객님', subject: `${to || '고객'}님, ${t}드려요`,
    body: `${to || '고객'}님 안녕하세요 😊\n가입해두신 보험 만기가 다가와 미리 연락드려요.\n지금 조건 그대로 갈지, 요즘에 맞게 조금 손볼지 편하게 봐드릴게요.\n부담 갖지 마시고 편하실 때 알려주시면 알기 쉽게 정리해 드리겠습니다.`,
    sent: false, gate: '발송은 사람 확인 후에만',
  };
}
module.exports = { status, draftMail };
