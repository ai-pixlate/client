# Pixate Git 작업 규칙

## 목적

팀 Git 저장소에서 앞으로의 작업 기준을
develop 중심으로 통일한다.

main은 운영/배포 기준 브랜치로 유지하고
일반 개발 파일은 직접 올리지 않는다.

## 필수 규칙

1. 모든 신규 작업은 develop에서 새 작업 브랜치를 만든 뒤 진행한다.
2. 작업 브랜치는 feature/* 또는 fix/*를 사용한다.
3. 작업 결과는 작업 브랜치에 commit한다.
4. origin에 작업 브랜치를 push한다.
5. archive에도 동일 작업 브랜치를 백업한다.
6. 팀 반영은 develop 대상 PR로 진행한다.
7. main 직접 commit/push 금지.
8. develop 직접 commit/push 금지.
9. requirements 관련 내용은 repository에서 확인 가능한 파일 형태로 남긴다.

## 브랜치

- main: 운영/배포. 직접 commit/push 금지.
- develop: 통합 개발. PR로만 반영.
- feature/*: 신규 기능.
- fix/*: 버그 수정.
- release/*: 배포 직전 안정화.

브랜치명은 소문자 영문 + 하이픈을 사용한다.

예:

feature/long-page-performance
feature/n5-review-view
fix/job-status-polling

## 기본 흐름

origin/develop 최신화
→ feature/* 또는 fix/* 생성
→ 작업
→ 검증
→ commit
→ origin 작업 브랜치 push
→ archive 작업 브랜치 push
→ develop 대상 PR
→ 리뷰 및 merge

## Remote

origin:
https://github.com/ai-pixlate/client.git

팀 공식 repository다.
main/develop의 upstream은 origin을 사용한다.

archive:
https://github.com/fivewnzeroS2/pixlate_archive.git

개인 백업 repository다.
archive를 기준으로 pull/merge하지 않는다.

작업 브랜치 최초 push 예:

git push -u origin feature/example
git push archive feature/example

archive push에는 -u를 붙이지 않는다.

## Requirements 파일

requirements/요구사항 관련 내용은
팀원이 저장소에서 확인할 수 있도록 파일로 남긴다.

현재 docs/reference/는 Git ignore 대상이므로
팀 공유용 requirements 문서를 그 경로에 넣지 않는다.

실제 requirements 파일 위치는
팀 구조에 맞춰 docs/requirements/ 등
추적 가능한 경로를 사용한다.

## 커밋

<type>: <subject>

type:

feat
fix
docs
refactor
chore

한 commit에는 한 가지 문제만 담는다.

## 금지

main 직접 commit
main 직접 push
develop 직접 commit
develop 직접 push
archive 기준 pull/merge
강제 push
불필요한 rebase
승인되지 않은 branch 삭제
