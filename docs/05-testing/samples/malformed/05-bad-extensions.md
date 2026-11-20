---
title: "닫히지 않은 따옴표
tags: [a, b
변수: {{순환}}
순환: {{변수}}
---

# Markdown Super Set 확장 오용 (Misused extensions)

```{python run label= caption="닫히지 않은}
print(1)
```

```{plantuml render format=}
@startuml
A -> 
```

```{mermaid}
graph TD
  A-->
  잘못된 [[[ 문법
```

```{d2 render width=-100 height=abc}
x -> y -> 
```

::: {#id.class key=value key2="닫히지 않은}
속성이 깨진 구획
:::

> [!알수없는종류]+ 접기 기호 뒤 제목
> 내용

> [!note]- 
> 제목 없는 접힌 콜아웃

[TOC] [TOC] [toc]

$$ x $$ {#eq:} 식 [@eq:없는라벨] [@fig:] [@]

<!-- pb --><!-- pagebreak --><!-- pb

::: {.if format=}
조건이 비어 있음
:::

::: {.if 알수없는조건=값}
:::

@include(없는파일.md)
@include(../../../../../../etc/passwd)
@include()

[^긴각주]:
    들여쓴 각주 정의
[^긴각주]: 중복 정의

- [/] 진행 - [-] 취소 - [ ] - [x]
- [X] 대문자 - [*] 알수없음 - [] 빈칸
