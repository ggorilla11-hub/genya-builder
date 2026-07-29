// ═══════════════════════════════════════════════════════════════════
// promo_utm.js · 홍보마케팅비서 · UTM 채널별 자동 분기 (스펙 B-3)
//
//   무엇을·왜: 1차 실측에서 12종 원고가 전부 utm_source=blog 로 나갔다.
//              그대로 발행하면 "어느 채널이 결제를 만들었나"를 영원히 알 수 없다.
//              종류마다 다른 꼬리표를 붙여야 4단계 분석이 의미를 갖는다.
//
//   ★개인정보는 UTM에 절대 넣지 않는다(CLAUDE.md 6-7). 이름·연락처·이메일 금지.
//   ★캠페인키는 시트가 진실의 출처. 여기에 하드코딩하지 않는다.
// ═══════════════════════════════════════════════════════════════════
'use strict';

// 원고 종류 → utm_source / utm_medium (팀장 승인분 · 실측 검증 완료)
const KIND_UTM = {
  blog:        { source: 'blog',        medium: 'organic'   },
  cafe:        { source: 'cafe',        medium: 'community' },
  brunch:      { source: 'brunch',      medium: 'organic'   },
  linkedin:    { source: 'linkedin',    medium: 'social'    },
  shorts:      { source: 'shorts',      medium: 'video'     },
  longform:    { source: 'youtube',     medium: 'video'     },
  podcast:     { source: 'podcast',     medium: 'audio'     },
  cardnews:    { source: 'cardnews',    medium: 'image'     },
  infographic: { source: 'infographic', medium: 'image'     },
  image:       { source: 'image',       medium: 'image'     },
  threads:     { source: 'threads',     medium: 'social'    },
  newsletter:  { source: 'newsletter',  medium: 'email'     },
};

// 카피 번호는 1~60. 범위를 벗어나면 잘못된 링크가 나가므로 거부한다.
function _copyNo(no) {
  const n = Number(no);
  if (!Number.isInteger(n) || n < 1 || n > 60) {
    throw new Error(`카피 번호가 1~60 밖이에요 (받은 값: ${no})`);
  }
  return String(n).padStart(3, '0');
}

// 랜딩 주소에 이미 ? 가 있으면 & 로 이어붙인다.
function _join(url) { return String(url).includes('?') ? '&' : '?'; }

/**
 * 도착지 주소에 채널별 꼬리표를 붙인다.
 * @param {string} landing   진단 도착지(시트 「캠페인」 탭)
 * @param {string} kind      원고 종류 키(blog·cafe·…)
 * @param {string} campaign  캠페인키(시트가 진실의 출처)
 * @param {number} copyNo    카피 번호 1~60
 */
function buildUtm(landing, kind, campaign, copyNo) {
  const u = KIND_UTM[kind];
  if (!u) throw new Error(`모르는 원고 종류예요: ${kind}`);
  if (!landing) throw new Error('도착지 주소가 비어 있어요 — 시트 「캠페인」 탭을 확인해 주세요');
  if (!campaign) throw new Error('캠페인키가 비어 있어요 — 시트 「캠페인」 탭을 확인해 주세요');
  return String(landing) + _join(landing)
    + `utm_source=${encodeURIComponent(u.source)}`
    + `&utm_medium=${encodeURIComponent(u.medium)}`
    + `&utm_campaign=${encodeURIComponent(campaign)}`
    + `&utm_content=${_copyNo(copyNo)}`;
}

// 12종 전부의 꼬리표를 한 번에(화면 확인·검증용)
function buildAll(landing, campaign, copyNo) {
  const out = {};
  Object.keys(KIND_UTM).forEach((k) => { out[k] = buildUtm(landing, k, campaign, copyNo); });
  return out;
}

module.exports = { KIND_UTM, buildUtm, buildAll };
