# Claude Dispatch

핸드폰에서 [Claude Code](https://claude.com/claude-code) CLI를 원격으로 제어하는 모바일 웹 인터페이스.

Claude 공식 Dispatch의 DIY 대안 — 외부 의존성 없이 로컬 머신에서 완전히 동작합니다.

```
[핸드폰 브라우저/PWA] ←WebSocket→ [Mac의 Node.js 서버] ←spawn→ [claude -p --stream-json]
```

## 기능

- **실시간 스트리밍** — Claude가 생각하는 대로 토큰이 나타남
- **세션 관리** — 여러 대화를 컨텍스트 유지하며 관리
- **모바일 PWA** — 홈 화면에 추가하면 앱처럼 사용
- **토큰 인증** — 자동 생성된 토큰으로 안전하게 접속
- **원격 접속** — Tailscale로 어디서든 접속 가능
- **원클릭 설치** — `setup.sh` 한 번이면 자동 실행, Mac 재부팅해도 OK

## 요구 사항

- [Claude Code CLI](https://docs.claude.com/en/docs/getting-started) 설치 및 인증 완료
- Node.js 18+
- [Tailscale](https://tailscale.com/) (무료) — 외부 네트워크에서 접속 시 필요

## 빠른 시작

### macOS

```bash
git clone https://github.com/nangman98/claude-dispatch.git
cd claude-dispatch
bash setup.sh
```

### Windows

```powershell
git clone https://github.com/nangman98/claude-dispatch.git
cd claude-dispatch
setup.bat
```

> 자동 시작 등록을 위해 관리자 권한으로 실행하세요.

끝입니다. 스크립트가 알아서:
- 의존성 설치
- 백그라운드 서비스 등록 (macOS LaunchAgent / Windows Task Scheduler)
- 서버 자동 시작 (크래시 시 자동 재시작)
- 핸드폰에서 열 URL 출력

**로그인 시 자동 실행** — 설치 후 수동 조작 불필요.

### 외부 접속 설정 (Tailscale)

외부 네트워크에서 접속하려면:

1. **Mac/PC**: [Tailscale](https://tailscale.com/download) 설치 후 로그인
2. **핸드폰**: [App Store](https://apps.apple.com/app/tailscale/id1470499037) 또는 [Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn)에서 Tailscale 설치 → 같은 계정으로 로그인
3. `setup.sh`가 출력한 Tailscale URL 사용

### 핸드폰에서 접속

| 접속 방식 | 열 URL |
|-----------|--------|
| 같은 Wi-Fi | `http://<로컬IP>:3456?token=<토큰>` |
| 외부 (Tailscale) | `http://<tailscale-ip>:3456?token=<토큰>` |

인증 토큰은 첫 접속 후 핸드폰 브라우저에 자동 저장됩니다.

### 홈 화면에 추가 (PWA)

브라우저 주소창 없이 앱처럼 사용하려면:

- **iPhone (Safari)**: **공유** (□↑) → **홈 화면에 추가**
- **Android (Chrome)**: **메뉴** (⋮) → **홈 화면에 추가**

### 서비스 관리

**macOS:**
```bash
# 중지
launchctl unload ~/Library/LaunchAgents/com.claude-dispatch.plist

# 재시작
launchctl unload ~/Library/LaunchAgents/com.claude-dispatch.plist && launchctl load ~/Library/LaunchAgents/com.claude-dispatch.plist

# 로그 확인
tail -f ~/claude-dispatch/dispatch.log
```

**Windows (관리자 권한으로 실행):**
```powershell
# 중지
schtasks /end /tn "ClaudeDispatch"

# 자동 시작 제거
schtasks /delete /tn "ClaudeDispatch" /f

# 로그 확인
type dispatch.log
```

## 사용법

### 세션 만들기

1. 상단 바에서 **+ New** 탭하여 새 채팅 세션 생성
2. 메시지 입력 후 **Send** 탭 (또는 Enter)
3. Claude 응답이 실시간으로 토큰 단위 스트리밍

### 세션 관리

- **세션 전환**: 상단 드롭다운 사용
- **세션 삭제**: 선택 후 **Del** 탭
- 세션은 재접속해도 유지됨 (Claude Code 네이티브 세션 저장소 활용)

### 상태 표시등

좌측 상단의 점은 연결 상태를 나타냅니다:

| 색상 | 의미 |
|------|------|
| 빨간색 | 연결 끊김 — 자동 재연결 시도 중 |
| 초록색 | 연결됨, 준비 완료 |
| 파란색 (깜빡임) | Claude가 생각 중 |

### 팁

- **Shift+Enter**로 여러 줄 메시지 입력
- **중단**: Claude가 너무 오래 걸리면 세션 삭제 후 새로 생성
- 앱이 작동하려면 Mac에서 서버가 실행 중이어야 함
- 안정적인 접속을 위해 Mac 절전 모드 해제 권장

## 작동 원리

```
핸드폰 (PWA)                   Mac (server.js)                  Claude Code CLI
    │                              │                                │
    ├── WebSocket 연결 ───────────►│                                │
    ├── { type: "prompt" } ──────►│── claude -p 실행 ──────────────►│
    │                              │◄── stream-json (토큰) ─────────┤
    │◄── { type: "token" } ───────┤                                │
    │◄── { type: "token" } ───────┤◄── stream-json (토큰) ─────────┤
    │◄── { type: "complete" } ────┤◄── 결과 ────────────────────────┤
    │                              │                                │
```

1. Node.js 서버가 Claude Code CLI (`claude -p`)를 래핑
2. 핸드폰이 WebSocket으로 연결하여 실시간 스트리밍
3. Claude Code 네이티브 세션 지속성 (`--session-id` / `--resume`)으로 대화 히스토리 유지
4. 스트리밍 JSON 출력을 파싱하여 토큰 단위로 브라우저에 전달

## 설정

| 환경 변수 | 기본값 | 설명 |
|-----------|--------|------|
| `PORT` | `3456` | 서버 포트 |

## 보안

- 인증 토큰은 첫 실행 시 자동 생성되어 `~/.claude-dispatch-token`에 저장
- 모든 HTTP, WebSocket 연결에 토큰 필요
- 서버는 `0.0.0.0`에 바인딩 (모든 인터페이스에서 접근 가능)
- Tailscale 사용 시 암호화된 원격 접속 — 퍼블릭 인터넷에 포트 노출 없음
- Claude CLI는 사용자 권한으로 실행

## 문제 해결

| 문제 | 해결 방법 |
|------|-----------|
| 빨간 점 (연결 끊김) | Mac에서 서버 실행 중인지 확인 (`npm start`) |
| 외부에서 접속 안 됨 | 양쪽 기기 모두 Tailscale 활성화 확인 |
| "Unauthorized" 에러 | 토큰 불일치 — 터미널 출력의 전체 URL로 다시 접속 |
| 세션 응답 없음 | 세션 삭제 후 새로 생성 |
| 서버 시작 실패 | 포트 사용 중인지 확인: `lsof -i :3456` |

## 라이센스

MIT
