# 잘못된 입력 샘플 (Malformed samples)

렌더러와 에디터의 강건성을 확인하기 위한 일부러 깨진 마크다운 파일이다. 앱에서 열었을 때 멈추거나 오류가 나지 않고, 스크립트가 실행되지 않으면 된다. 깨진 모양으로 보이는 것은 정상이다.

| 파일 | 내용 |
| --- | --- |
| `01-unclosed-blocks.md` | 닫히지 않은 펜스, 구획, 콜아웃, 수식, 주석, HTML 태그 |
| `02-broken-inline.md` | 닫히지 않은 강조, 깨진 링크와 이미지, 각주, 위키링크, 키, 수식, 변수 |
| `03-bad-tables.md` | 열 개수 불일치, 헤더 없는 표, 병합 기호만 있는 표, 잘못된 체크박스 |
| `04-hostile-html.md` | 스크립트, 이벤트 속성, `javascript:`/`data:` 링크 등 위험한 입력 |
| `05-bad-extensions.md` | 깨진 front matter, 실행·다이어그램 청크 옵션, 순환 변수, 없는 파일 포함 |
| `06-encoding-and-whitespace.md` | BOM, LF·CRLF·CR 혼합, 제어 문자, 제로폭·방향 제어 문자, 결합 문자, 이모지 |

자동 테스트(`packages/core-editor/test/robustness.test.ts`)가 이 파일들과 코드로 만든 극단적인 입력(아주 깊은 중첩, 아주 긴 줄, 무작위 바이트 등)을 모든 렌더러에 넣어 본다.
