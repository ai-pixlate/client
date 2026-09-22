
# pix/ate 명칭 표기 규칙

이 문서는 pix/ate 프로젝트에서 사용하는 서비스명과 기술 식별자의 표기 규칙을 정의한다.

명칭 관련 판단이 필요한 경우 이 문서를 정본으로 사용한다.

---

## 1. 공식 브랜드명

사용자에게 노출되는 공식 서비스명은 다음과 같다.

`pix/ate`

다음과 같은 곳에서는 반드시 `pix/ate`를 사용한다.

- 화면에 노출되는 서비스명
- 로고 및 워드마크
- 페이지 제목
- 서비스 소개 문구
- README 및 일반 문서에서 브랜드를 지칭할 때
- 발표자료
- 디자인 파일
- 이미지/GIF 안의 브랜드 표기

예:

```text
pix/ate에 오신 것을 환영합니다.
pix/ate Frontend
```

---

## 2. 기술 식별자

슬래시(`/`)를 사용할 수 없거나 사용하면 문제가 발생하는 기술적 문맥에서는
반드시 다음 이름을 사용한다.

`pixlate`

사용 예:

- 파일명
- 폴더명
- 변수명
- 함수명
- 객체명
- import path
- package name
- React Query key
- HTTP header
- repository slug
- Docker service/container name
- hostname
- URL-safe identifier
- 데이터베이스 및 스토리지의 기술 식별자

예:

```text
lib/api/pixlate.ts
lib/queries/pixlate.ts

pixlateKeys

'x-pixlate-api-proxy'

pixlate-api

"name": "pixlate"
```

---

## 3. 대문자 식별자가 필요한 경우

환경변수 prefix나 상수명처럼 대문자가 필요한 경우에는 다음을 사용한다.

`PIXLATE`

예:

```text
PIXLATE_API_URL
PIXLATE_ENV
```

---

## 4. 사용하지 않는 표기

다음 표기는 사용하지 않는다.

- `Pix/ate`
- `pixate`
- `Pixate`
- `PIXATE`
- `pix_ate`
- `Pix_ate`
- `PIX_ATE`
- `pix-ate`

브랜드명에서 `/`를 제거해야 하는 경우
`pixate`로 줄이지 않고 반드시 `pixlate`를 사용한다.

잘못된 예:

```text
pixateKeys
lib/api/pixate.ts
x-pixate-api-proxy
Pix_ate
```

올바른 예:

```text
pixlateKeys
lib/api/pixlate.ts
x-pixlate-api-proxy
pix/ate
```

---

## 5. 판단 기준

새로운 이름을 만들 때는 아래 기준을 따른다.

### 사람이 읽는 브랜드 표현인가?

그렇다면:

`pix/ate`

### 코드나 시스템이 사용하는 식별자인가?

그렇다면:

`pixlate`

### 대문자 prefix가 필요한 기술 식별자인가?

그렇다면:

`PIXLATE`

---

## 6. 기존 외부 리소스 예외

기존 외부 시스템, 원본 문서, API 계약, 서버 hostname 등에서
이미 잘못된 이름이 식별자로 사용되고 있을 수 있다.

이 경우 이름만 임의로 변경하지 않는다.

예:

```text
http://pixate-api:8000
```

이 값이 실제 Docker service name과 연결되어 있다면
FE 코드만 `pixlate-api`로 변경하면 안 된다.

외부 참조가 있는 기존 식별자는
관련 시스템을 함께 변경할 수 있을 때 마이그레이션한다.

---

## 7. 개발 작업 시 확인 규칙

새 파일, 변수, API header, query key, package name,
Docker service name 등을 만들기 전에 이 문서를 확인한다.

PR 리뷰 시 다음 문자열이 새로 추가되지 않았는지 확인한다.

- pixate
- pix_ate
- pix-ate
- Pixate
- Pix_ate
- PIXATE

단, 외부 레거시 식별자를 그대로 참조해야 하는 경우는 예외이며
그 이유를 코드 또는 PR에서 명확히 남긴다.

---

## 한 줄 원칙

> 사용자에게 보이는 이름은 `pix/ate`, 코드와 시스템이 사용하는 이름은 `pixlate`다.
```

그리고 **이 문서만 만들어두면 AI가 항상 읽는다는 보장은 없습니다.** 그래서 프로젝트 진입점에도 한 줄짜리 규칙을 넣는 게 좋습니다.

`README.md` 상단에는:

```md
> Naming rule: 사용자 노출 브랜드명은 `pix/ate`, 코드·파일·시스템 식별자는 `pixlate`를 사용한다. 자세한 기준은 `docs/pixlate-naming-convention.md`를 따른다.
```

그리고 Claude/Codex 같은 코딩 에이전트가 항상 읽는 루트 지침 파일이 있다면 거기에도 **설명 전체를 복붙하지 말고 링크와 한 줄 원칙만** 넣는 게 좋습니다.

예를 들어 `CLAUDE.md` 또는 `AGENTS.md`에:

```md
## Naming

- 브랜드 표기: `pix/ate`
- 코드/시스템 식별자: `pixlate`
- `pixate`, `pix_ate`, `pix-ate` 등의 변형을 새로 만들지 않는다.
- 상세 정본: `docs/pixlate-naming-convention.md`