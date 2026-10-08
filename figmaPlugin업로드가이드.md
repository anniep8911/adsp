# Figma Plugin 배포 가이드

## 1. Figma Plugin 프로젝트 준비

기본 구조 예시

```text
my-plugin/
├── manifest.json
├── code.js
├── ui.html
├── icon.png
└── assets/
```

### manifest.json 예시

```json
{
  "name": "My Plugin",
  "id": "com.company.my-plugin",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma"]
}
```

---

## 2. 로컬 개발 환경에서 테스트

Figma Desktop App 실행

```text
Plugins
→ Development
→ Import Plugin from Manifest...
```

선택

```text
manifest.json
```

불러오기

이후

```text
Plugins
→ Development
→ My Plugin
```

으로 실행 가능

---

## 3. 플러그인 정보 정리

배포 전 아래 항목 준비

### 플러그인 이름

```text
My Plugin
```

### 설명

```text
Custom tools for designers.
```

### 아이콘

권장 사이즈

```text
128 × 128 px
```

PNG 사용 권장

---

## 4. Figma Community 등록

접속

```text
https://www.figma.com/community
```

로그인 후

```text
Profile
→ Publish
```

선택

---

## 5. Community Publishing 권한 활성화

최초 배포 시

```text
Creator Profile
```

생성이 필요할 수 있음

설정 항목

```text
이름
사용자명
프로필 정보
프로필 이미지
```

---

## 6. Plugin 등록

Figma에서 플러그인을 연 상태에서

```text
Plugins
→ Development
→ Manage Plugins
```

또는

```text
Plugins
→ Development
→ Open Plugin Details
```

선택

---

## 7. Publish Plugin

플러그인 상세 화면에서

```text
Publish
```

선택

입력 항목

```text
Name
Description
Category
Icon
Cover Image
```

---

## 8. 카테고리 선택

예시

```text
Design System
Developer Tools
Icons
Productivity
Utilities
```

플러그인 성격에 맞는 카테고리 선택

---

## 9. 커버 이미지 추가

권장

```text
1920 × 960 px
```

포함하면 좋은 내용

```text
플러그인 화면
주요 기능
사용 예시
```

---

## 10. 스크린샷 등록

최소 2~3장 권장

예시

```text
메인 화면
검색 기능
적용 결과
```

---

## 11. 공개 범위 선택

### Public

```text
Community 전체 공개
```

### Unlisted

```text
링크를 아는 사용자만 접근 가능
```

### Organization

```text
특정 조직 내부만 사용
```

(Organization 플랜 필요)

---

## 12. 심사 제출

입력 내용 확인 후

```text
Submit for Review
```

선택

---

## 13. 심사 결과

승인 시

```text
Published
```

상태로 변경

Community에서 검색 가능

---

## 14. 업데이트 배포

code.js 수정

↓

버전 변경

```json
{
  "name": "My Plugin",
  "id": "com.company.my-plugin",
  "api": "1.0.0"
}
```

↓

다시 Publish

↓

기존 플러그인 업데이트

---

# 배포 전 체크리스트

```text
□ manifest.json 작성
□ code.js 작성
□ ui.html 작성
□ 아이콘 준비
□ 커버 이미지 준비
□ 스크린샷 준비
□ 로컬 테스트 완료
□ Creator Profile 생성
□ Community 등록
□ Publish 제출
```

---

# 회사 내부 배포 방법

Community 공개 없이 사용하려면

```text
manifest.json 공유
```

또는

```text
GitHub 저장소 공유
```

후 각 사용자가

Plugins
→ Development
→ Import Plugin from Manifest...
```

를 통해 설치할 수 있습니다.

이 방식은 사내 전용 플러그인 개발 시 가장 많이 사용됩니다.