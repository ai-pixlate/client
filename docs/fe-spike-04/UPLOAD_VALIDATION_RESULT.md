# FE Spike ④ — 업로드 파일 사전 검증 결과

## 목적

N1에서 사용자가 선택한 이미지 파일을
실제 업로드/API 전송 전에 브라우저에서 사전 판독할 수 있는지 검증했다.

사용 기술:

- File API
- File.slice()
- ArrayBuffer
- magic bytes
- createImageBitmap()
- URL.createObjectURL()

이번 Spike의 핵심은
파일명/확장자/MIME만 믿지 않고
실제 파일 내용을 브라우저에서 검증할 수 있는지 확인하는 것이다.

## 9월 기준 정책

지원:

- JPEG
- PNG

차단:

- 기타 포맷

측정만 하고 차단하지 않음:

- width
- height
- file size
- decode time

검사하지 않음:

- 색공간

해상도/용량에 대해 임의의 최소/최대 기준을 새로 만들지 않았다.

## 검증 방식

1. File 객체 수신
2. extension 확인
3. File.type 확인
4. File.slice().arrayBuffer()로 magic bytes 판독
5. JPEG/PNG signature인지 확인
6. 지원 포맷이면 createImageBitmap(file) 실행
7. width/height 확인
8. bitmap.close() 호출
9. 파일별 결과를 독립적으로 반환

JPEG signature:

```
FF D8 FF
```

PNG signature:

```
89 50 4E 47 0D 0A 1A 0A
```

## 판정 코드

**PASS**

- 실제 signature가 JPEG/PNG
- createImageBitmap decode 성공

**UNSUPPORTED_FORMAT**

- 실제 파일 포맷이 지원 대상 JPG/PNG가 아님
- 예: GIF, WEBP

**SIGNATURE_MISMATCH**

- 파일명/확장자 또는 MIME은 JPG/PNG를 주장하지만
  실제 signature는 JPG/PNG가 아님

**DECODE_FAILED**

- JPEG/PNG signature는 맞지만
  createImageBitmap에서 실제 decode 실패

## 실제 브라우저 검증 결과

| Case | 입력 | 결과 |
|---|---|---|
| 정상 JPG | detail_*.jpg | PASS |
| 정상 PNG | typo_dot.png | PASS |
| GIF | detail_013.gif | UNSUPPORTED_FORMAT |
| WEBP | webp-test.webp | UNSUPPORTED_FORMAT |
| 확장자 불일치 | 실제 PNG + .jpeg 파일명 | PASS + extension/MIME 불일치 표시 |
| 손상 JPEG | JPEG signature + 손상 payload | DECODE_FAILED |
| 위장 JPG | 실제 WEBP + fake_jpg.jpg | SIGNATURE_MISMATCH |
| 초장축 JPEG | 1000×14000px | PASS |

초장축 JPEG 결과:

- width: 1000px
- height: 14000px
- createImageBitmap decode 성공
- 브라우저 멈춤 없음

## Batch 처리

여러 파일을 동시에 선택했을 때:

- PASS
- UNSUPPORTED_FORMAT
- DECODE_FAILED
- SIGNATURE_MISMATCH

파일이 한 batch 안에 섞여 있어도
각 파일 결과가 독립적으로 출력됨을 확인했다.

한 파일 실패가 전체 Promise 처리를 중단하지 않았다.

판정: PASS

## 메모리 정리

createImageBitmap 성공 후:

```
bitmap.close()
```

호출 확인.

preview용:

```
URL.createObjectURL(file)
```

사용 시:

- 개별 삭제 시 URL.revokeObjectURL()
- 컴포넌트 unmount 시 남은 URL 전체 revoke

확인.

## 색공간

이번 Spike에서는 색공간을 검사하지 않았다.

File API/createImageBitmap만으로는
원본 ICC profile / CMYK 여부 등을
신뢰성 있는 제품 정책 판정값으로 사용하기 어렵기 때문에
별도 검증 방식이 필요하다.

## 기존 N1 확인 결과

현재 N1: `app/jobs/new/page.tsx`

구조:

- LocalImage에 File 객체 자체 보관
- input type=file multiple
- accept="image/\*"
- validation 없음
- preview 없음
- drag & drop 없음
- 실제 파일 업로드 API 미구현
- submit 시 mock fileId 사용

이번 Spike에서는 기존 N1을 수정하지 않았다.

## 최종 판정

Day 4 PASS

브라우저 단계에서 다음이 가능함을 확인:

- JPG/PNG 실제 signature 판별
- MIME/확장자 위장 탐지
- 손상 파일 decode 실패 탐지
- 대형/초장축 이미지 width/height 판독
- 다중 파일 독립 처리
- bitmap/objectURL 메모리 정리

따라서 향후 N1 구현 시 Spike의 순수 validation 로직을 재사용할 수 있다.

단 다음은 아직 확정/구현하지 않는다.

- 실제 업로드 API
- presigned URL
- 파일 크기 차단 기준
- 최소/최대 해상도 차단
- 색공간 검사
- thumbnail/detail 처리 정책
- 백엔드 계약
