# VS Code Extension Marketplace 배포 가이드

## 1. Publisher 생성

VS Code Extension을 Marketplace에 배포하려면 Publisher 계정이 필요합니다.

접속:

```text
https://marketplace.visualstudio.com/manage
```

Microsoft 계정으로 로그인한 후 Publisher를 생성합니다.

예시:

```text
Publisher Name: dreamtour
Display Name: Hyundai Dream Tour
```

---

## 2. Extension 프로젝트 준비

기본 구조 예시

```text
my-extension/
├── package.json
├── extension.js
├── README.md
├── CHANGELOG.md
└── icon.png
```

### package.json 예시

```json
{
  "name": "my-extension",
  "displayName": "My Extension",
  "description": "My VS Code Extension",
  "version": "0.0.1",
  "publisher": "dreamtour",
  "engines": {
    "vscode": "^1.90.0"
  },
  "main": "./extension.js",
  "activationEvents": [
    "onCommand:my-extension.hello"
  ],
  "contributes": {
    "commands": [
      {
        "command": "my-extension.hello",
        "title": "Hello Extension"
      }
    ]
  }
}
```

### 주의사항

```json
"publisher": "dreamtour"
```

값은 Marketplace에서 생성한 Publisher 이름과 반드시 동일해야 합니다.

---

## 3. VSCE 설치

VS Code Extension 공식 배포 도구 설치

```bash
npm install -g @vscode/vsce
```

설치 확인

```bash
vsce --version
```

---

## 4. VSIX 패키지 생성

배포 전에 로컬 테스트용 패키지를 생성합니다.

```bash
vsce package
```

생성 결과

```text
my-extension-0.0.1.vsix
```

---

## 5. 로컬 설치 테스트

VSIX 파일 직접 설치

```bash
code --install-extension my-extension-0.0.1.vsix
```

또는 VS Code에서

```text
Extensions
→ More Actions (...)
→ Install from VSIX...
```

선택

---

## 6. Personal Access Token(PAT) 생성

Marketplace 업로드를 위해 PAT를 생성합니다.

접속

```text
https://dev.azure.com
```

프로필 메뉴 →

```text
Personal Access Tokens
```

새 토큰 생성

권한 설정

```text
Marketplace
└─ Manage
```

---

## 7. Publisher 로그인

터미널에서 실행

```bash
vsce login dreamtour
```

입력창이 표시되면 생성한 PAT를 입력합니다.

---

## 8. Marketplace 배포

최초 배포

```bash
vsce publish
```

배포 완료 후 Marketplace에 등록됩니다.

---

## 9. 버전 업데이트 후 배포

### Patch

```bash
vsce publish patch
```

예시

```text
0.0.1
↓
0.0.2
```

### Minor

```bash
vsce publish minor
```

예시

```text
0.0.1
↓
0.1.0
```

### Major

```bash
vsce publish major
```

예시

```text
0.1.0
↓
1.0.0
```

---

## 10. Marketplace 확인

배포 후 Extension URL 형식

```text
https://marketplace.visualstudio.com/items?itemName={publisher}.{extension-name}
```

예시

```text
https://marketplace.visualstudio.com/items?itemName=dreamtour.my-extension
```

---

# 배포 전 권장 준비사항

## README.md

Extension 소개 문서

```text
소개
기능
설치 방법
사용 방법
스크린샷
FAQ
```

---

## CHANGELOG.md

버전 변경 이력 관리

예시

```markdown
# Changelog

## 0.0.2

- 검색 기능 추가
- 설정 화면 개선

## 0.0.1

- 최초 배포
```

---

## icon.png

Marketplace 표시용 아이콘

권장 크기

```text
128 × 128 px
```

---

# 자주 사용하는 명령어

```bash
# 패키지 생성
vsce package

# 로그인
vsce login dreamtour

# 최초 배포
vsce publish

# Patch 버전 배포
vsce publish patch

# Minor 버전 배포
vsce publish minor

# Major 버전 배포
vsce publish major
```

---

# 배포 체크리스트

```text
□ Publisher 생성
□ package.json 설정
□ README 작성
□ CHANGELOG 작성
□ icon.png 추가
□ vsce 설치
□ VSIX 생성
□ 로컬 테스트
□ PAT 생성
□ 로그인
□ Marketplace 배포
```