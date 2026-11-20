# 닫히지 않은 블록 (Unclosed blocks)

이 파일은 렌더러 강건성 테스트용이다. 깨지거나 어색하게 보이는 것은 정상이며, 앱이 멈추거나 오류 없이 표시되면 된다.

```python
def never_closed():
    return "펜스가 닫히지 않았다"

~~~
틸드 펜스 안의 ``` 백틱

````markdown
```js
안쪽 펜스만 닫힘
```

:::{.warning title=닫히지 않은 구획}
내용

::::{.tabset}
:::{.tab title=하나}
탭 하나만, 바깥 구획은 열린 채로

> [!note] 콜아웃
> 줄이 끊긴 콜아웃
계속되는 게으른 줄

$$
\int_0^1 x \, dx
닫히지 않은 수식 블록

<!-- 닫히지 않은 HTML 주석

<div class="open">
<span>닫히지 않은 태그
