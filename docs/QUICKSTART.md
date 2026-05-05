# Quickstart

This guide starts the open-source SiftGate Data Plane on one machine with memory state and SQLite.

## 1. Install

```bash
git clone https://github.com/seanbabalala/ai-gateway.git
cd ai-gateway
npm install
cd frontend && npm install && cd ..
```

## 2. Configure

```bash
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
```

Edit `gateway.config.yaml` and add one upstream node. Use environment references such as `${env:OPENAI_API_KEY}` or `${OPENAI_API_KEY}` instead of committing secrets.
From v1.5 onward, `${OPENAI_API_KEY}` style references are required at startup and reload time. Use `${OPENAI_API_KEY:-dummy}` only when you intentionally want a fallback value.

## 3. Build And Run

```bash
npm run build
npm start
```

Open:

- Dashboard: `http://localhost:2099/dashboard`
- API docs: `http://localhost:2099/docs`
- Health: `http://localhost:2099/health`

## 4. Send A Request

```bash
curl http://localhost:2099/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer ${SIFTGATE_API_KEY}" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "Say hello from SiftGate."}]
  }'
```

## 5. Validate Before Production

```bash
npm run validate:config
npm run docs:check
npm test -- --runInBand
```

Next reads:

- [Production](PRODUCTION.md)
- [Provider Catalog](PROVIDER_CATALOG.md)
- [Dashboard](DASHBOARD.md)
- [Security](SECURITY.md)
