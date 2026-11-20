# 위험한 입력 (Hostile input)

미리보기에서 스크립트가 실행되거나 외부로 이동하면 안 된다. 모두 글자로 보이거나 무시되어야 한다.

<script>window.__pwned = 1; alert('xss')</script>

<img src=x onerror="window.__pwned = 2">

<svg onload="window.__pwned = 3"><circle r="5"/></svg>

<iframe src="javascript:window.__pwned = 4"></iframe>

<a href="javascript:window.__pwned = 5">자바스크립트 링크</a>

[마크다운 자바스크립트 링크](javascript:window.__pwned=6)

[대소문자 섞기](JaVaScRiPt:window.__pwned=7) [공백 끼우기](java	script:window.__pwned=8)

[데이터 URL](data:text/html,<script>window.__pwned=9</script>)

![이미지 자바스크립트](javascript:window.__pwned=10)

<style>body { display: none !important; }</style>

<div style="background:url(javascript:window.__pwned=11)">스타일 URL</div>

<object data="javascript:window.__pwned=12"></object><embed src="javascript:window.__pwned=13">

<form action="javascript:window.__pwned=14"><button>보내기</button></form>

<math><mtext><table><mglyph><style><img src=x onerror="window.__pwned=15">

```{=html}
<script>window.__pwned = 16</script>
```

<details open ontoggle="window.__pwned = 17"><summary>토글</summary></details>
