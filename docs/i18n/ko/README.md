# SiftGate 문서

[문서 홈](../../README.md) · [프로젝트 README](../../../README.md)

SiftGate는 여러 AI provider, agent, 애플리케이션을 운영하는 팀을 위한
self-hosted AI 트래픽 게이트웨이입니다. 라우팅, 정책, 예산, 감사, 메타데이터
근거를 로컬에 두며 기본적으로 prompt, response, 원본 헤더, provider key,
tool payload, media bytes, hidden reasoning, 해석된 secret을 저장하지 않습니다.

## 빠른 시작

```bash
git clone https://github.com/seanbabalala/ai-gateway.git
cd ai-gateway
npm install
cd frontend && npm install && cd ..
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
npm run build
npm start
```

`http://localhost:2099/dashboard` 를 열고 Provider Node를 추가한 뒤 Gateway API Key를
만들고 `http://localhost:2099/v1/chat/completions` 로 첫 요청을 보내세요.

## 최초 설정 경로

1. 활성 Workspace를 확인합니다.
2. Provider Node를 추가합니다.
3. Gateway API Key를 생성합니다.
4. 필요한 경우 Policy Namespace를 연결합니다.
5. 일일 Budget scope와 source of truth를 확인합니다.
6. 첫 요청을 보냅니다.
7. Logs와 Route Explanation을 확인합니다.
8. 필요한 경우에만 Semantic Controls, Traffic Experiments, Evals, Shadow Traffic, MCP Tool Gateway를 설정합니다.

## 핵심 개념

| 개념 | 의미 |
| --- | --- |
| Workspace | 로컬 Dashboard와 메타데이터 경계입니다. |
| Provider Node | 설정된 upstream 계정, 배포, proxy, 또는 로컬 runtime입니다. |
| Gateway API Key | SiftGate가 생성하는 client-facing key이며 provider key와 다릅니다. |
| Policy Namespace | API Key, Team, budget, rate limit, node/model allow-list를 위한 config-backed 로컬 정책 라벨입니다. |
| MCP Tool Gateway | MCP tool-call 거버넌스와 proxy이며 모델 라우팅이 아닙니다. |

## 문서 지도

- [Quickstart](../../QUICKSTART.md)
- [Docker Quickstart](../../DOCKER_QUICKSTART.md)
- [Dashboard](../../DASHBOARD.md)
- [OSS Concepts](../../OSS_CONCEPTS.md)
- [Provider Catalog](../../PROVIDER_CATALOG.md)
- [MCP Tool Gateway](../../MCP_GATEWAY.md)
- [Semantic Controls](../../SEMANTIC_PLATFORM.md)
- [Evaluation Framework](../../EVALUATION_FRAMEWORK.md)
- [API Reference](../../API_REFERENCE.md)
- [Production](../../PRODUCTION.md)
- [Security](../../SECURITY.md)
