# Contributing to SiftGate

Thanks for helping improve SiftGate. This project is an open-source AI traffic data plane for teams, with a future hosted control plane for fleet policy, governance, and router optimization.

## Development Setup

```bash
npm install
cd frontend && npm install && cd ..
cp gateway.config.example.yaml gateway.config.yaml
cp .env.example .env
```

Run the backend and frontend build checks:

```bash
npm test -- --runInBand
npm run test:e2e
cd frontend && npm run build && cd ..
```

For the Docker quickstart path:

```bash
npm run smoke:docker
```

## Pull Request Guidelines

- Keep changes focused and explain the user-visible behavior.
- Add tests for routing, protocol conversion, budget, auth, or control-plane behavior.
- Do not commit real provider keys, generated Gateway API keys, SQLite data, or local `gateway.config.yaml`.
- Preserve the default privacy boundary: prompts, responses, tool payloads, and provider secrets must not leave the customer data plane unless a future enterprise opt-in explicitly enables it.
- Keep self-hosted behavior working when `control_plane.enabled` is false.

## Project Boundaries

The open-source gateway should remain useful on its own. Hosted control-plane features should be additive and must not make local request handling depend on our cloud.

- Public/open-source repository: `https://github.com/seanbabalala/ai-gateway`
- Enterprise/cloud repository: `https://github.com/seanbabalala/siftgate-cloud`
- Do not commit `siftgate-cloud/`, Cloud dashboard code, website code, Cloud deployment secrets, or enterprise-only plans into this public repository.
- Shared behavior should cross the boundary through documented HTTP contracts, not private package imports.
