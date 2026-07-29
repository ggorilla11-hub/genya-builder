# 스펙 B-3 · UTM 12종 채널별 자동 분기

> 상태: **스펙 · 코드 미작성** · 팀장 검수용
> 작성: 2026-07-29 · 2차 재실측에서 12개 URL 전부 다르게 생성됨을 확인

## 왜 필요한가

**1차 실측에서는 12종 전부 `utm_source=blog` 였습니다.**

카페 글에도, 브런치에도, 링크드인에도, 팟캐스트에도 전부 `blog` 가 붙었습니다.
그대로 발행하면 **"어느 채널이 결제를 만들었는지"를 영원히 알 수 없습니다.**

분기해야 4단계 분석 대시보드의 **채널별 유입·전환·결제 전환율**이 의미를 갖습니다.

---

## 1. 채널별 매핑표 (팀장 승인분 · 실측 검증 완료)

| # | 종류 | `utm_source` | `utm_medium` |
|---|---|---|---|
| 1 | 블로그 롱폼 | `blog` | `organic` |
| 2 | 카페 글 | `cafe` | `community` |
| 3 | 브런치 | `brunch` | `organic` |
| 4 | 링크드인 | `linkedin` | `social` |
| 5 | 쇼츠 | `shorts` | `video` |
| 6 | 롱폼 10분 | `youtube` | `video` |
| 7 | 팟캐스트 | `podcast` | `audio` |
| 8 | 카드뉴스 | `cardnews` | `image` |
| 9 | 인포그래픽 | `infographic` | `image` |
| 10 | 이미지 프롬프트 | `image` | `image` |
| 11 | 스레드 | `threads` | `social` |
| 12 | 뉴스레터 | `newsletter` | `email` |

**실측 검증:** 2차 재실측에서 12개 URL이 **전부 다르게** 생성되는 것을 확인했습니다.
(`재실측결과_v2.md` 의 "UTM 채널별 분기 검증" 표 참조)

---

## 2. 자동 생성 로직

```js
function utm(랜딩URL, source, medium, 캠페인ID, 카피번호) {
  return `${랜딩URL}?utm_source=${source}`
       + `&utm_medium=${medium}`
       + `&utm_campaign=${캠페인ID}`
       + `&utm_content=${String(카피번호).padStart(3, '0')}`;
}
```

| 파라미터 | 값 출처 | 예 |
|---|---|---|
| `utm_source` | 원고 종류 12종 **고정 매핑** | `blog` |
| `utm_medium` | 콘텐츠 유형 (위 표) | `organic` |
| `utm_campaign` | 시트 「캠페인」 탭의 **캠페인키** | `bootcamp_desire` |
| `utm_content` | 카피 번호 **001~060** (3자리 0채움) | `001` |

### 생성 예시 (실측에서 나온 실제 URL)

```
https://ohwant-class.netlify.app/desire.html?utm_source=blog&utm_medium=organic&utm_campaign=bootcamp_desire&utm_content=001

https://ohwant-class.netlify.app/desire.html?utm_source=cafe&utm_medium=community&utm_campaign=bootcamp_desire&utm_content=001

https://ohwant-class.netlify.app/desire.html?utm_source=podcast&utm_medium=audio&utm_campaign=bootcamp_desire&utm_content=001

https://ohwant-class.netlify.app/desire.html?utm_source=newsletter&utm_medium=email&utm_campaign=bootcamp_desire&utm_content=001
```

---

## 3. 규칙

| # | 규칙 | 이유 |
|---|---|---|
| 1 | **캠페인키는 시트가 진실의 출처.** 코드에 하드코딩하지 않음 | 회장님이 시트에서 고치면 즉시 반영 |
| 2 | 카피번호는 **1~60 범위 밖이면 거부** | 잘못된 링크 방지 |
| 3 | 랜딩 URL에 이미 `?` 가 있으면 `&` 로 이어붙임 | 구현 시 주의 |
| 4 | **개인정보는 UTM에 절대 넣지 않음** | CLAUDE.md 6-7 · 이름·연락처·이메일 금지 |

---

## 4. 4단계 분석 대시보드와의 연결

「분석」 탭 컬럼과 1:1로 이어집니다.

```
날짜 · 캠페인키 · 채널 · utm_source · 노출 · 클릭 · 진단시작 · 진단완료 · 결제
                          ↑
                    이 값으로 채널을 구분
```

**대시보드에서 볼 수 있게 되는 것**

- 채널별 유입 수 (blog vs cafe vs podcast …)
- 채널별 **진단 완료율**
- 채널별 **결제 전환율**
- 카피 번호(`utm_content`)별 성과 → **어떤 카피가 잘 먹혔나**

**★`utm_content` 를 카피 번호로 쓴 이유:** 60개 카피 중 어느 것이 결제를 만들었는지 추적하기 위해서입니다. 이게 있어야 다음 캠페인 카피를 개선할 수 있습니다.

*문서 상태: 스펙 · 코드 미작성 · 파일 수정 0*
