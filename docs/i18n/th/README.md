# เอกสาร SiftGate

[หน้าหลักเอกสาร](../../README.md) · [README ของโปรเจกต์](../../../README.md)

รีลีสปัจจุบัน: **v2.11.3**

SiftGate คือ self-hosted AI traffic data plane สำหรับทีมที่ไม่ต้องการจบที่การแจก
provider key โดยตรง การตั้งค่า proxy เฉพาะหน้า หรือ model routing ที่ตรวจสอบไม่ได้
ระบบรวมแอป, Coding Agent, MCP tools, provider credentials, routing policy, budget,
cache evidence และ production operations ไว้ใน control plane ภายในเครื่องของคุณเอง

<p align="center">
  <img src="../../assets/homepage/siftgate-hero.svg" alt="SiftGate AI traffic data plane" width="100%" />
</p>

## เรื่องราวผลิตภัณฑ์ล่าสุด

| จุดแข็งของ SiftGate | ทำไมจึงสำคัญ |
| --- | --- |
| AI traffic data plane | policy, routing, credential selection, budget, cost, cache, audit และ evidence ทำงานใน self-hosted request path เดียว |
| Agent และ MCP governance | Cursor, Cline, Roo Code, Continue, Codex, Claude Code, OpenCode, OpenAI/Anthropic agent ทั่วไป และ MCP tools ใช้ ingress ที่ถูกควบคุมร่วมกันได้ |
| Cache-aware credential pools | Provider Node เดียวมีหลาย upstream key ได้ พร้อม `cache_aware`, least-in-flight, weighted rotation, sticky affinity, cooldown และ retry failover |
| Route Explanation | operator ตรวจสอบได้ว่า model/node ถูกเลือก ข้าม retry downgrade หรือ reject เพราะอะไร โดยไม่บันทึก prompt/response เป็นค่าเริ่มต้น |
| metadata-only by default | ค่าเริ่มต้นไม่บันทึก prompt, response, raw header, provider key, tool payload, media bytes, source, diff, hidden reasoning หรือ resolved secret |
| เส้นทาง production | เริ่มจาก SQLite และ memory state แล้วขยายไป PostgreSQL, Redis, Docker, Kubernetes, Helm, OIDC, secret references, log sinks และ OpenTelemetry ได้ |

## เข้าใจ SiftGate ใน 30 วินาที

gateway ส่วนใหญ่หยุดที่ "ส่ง request นี้ไป model ไหน" แต่ SiftGate เปลี่ยน AI traffic
ให้เป็น control loop ที่ governance ได้และอธิบายได้

1. ตรวจสอบ Gateway API Key และ resolve Workspace, Team, Policy Namespace
2. ตรวจ permission ของ endpoint, modality, model, node, budget และ rate limit
3. route ตาม compatibility, cost, latency, health, cache evidence และ fallback rule
4. เลือก upstream provider credential ที่เหมาะสม รวมถึง cache-aware affinity
5. ส่ง provider-compatible response กลับ และเก็บ operational evidence ที่ export ได้อย่างปลอดภัย

## Provider Credential Pools

Provider Node ใช้ `api_key` เดียวได้ หรือใช้ `credentials[]` pool แบบ first-class ได้
pool จะ rotate/retry upstream key ภายใน logical node เดียวก่อนเข้าสู่ node-level fallback

```yaml
credential_pool:
  enabled: true
  strategy: cache_aware
  sticky_by: agent_session
  cooldown_ms: 60000
  max_failures: 3
  retry_on_status: [429, 500, 502, 503, 504]
```

เมื่อ coding plan หรือ Agent workload มีหลาย key สำหรับ provider/account/model surface
เดียวกัน ให้ใช้ `cache_aware` ได้ดีเป็นพิเศษ SiftGate จะพยายามให้ traffic ที่สร้างหรืออ่าน
provider prompt cache อยู่กับ upstream key เดิม และยังสลับ key เมื่อเจอ 429/5xx/timeout

## ตำแหน่งเมื่อเทียบกับโปรเจกต์อื่น

SiftGate ไม่ใช่แค่ model router ราคาถูก และไม่ใช่ API resale panel จุดหลักคือ
self-hosted AI traffic data plane สำหรับ BYOK governance, route evidence,
Agent/MCP control, cache-aware key pool และ production operations

<p align="center">
  <img src="../../assets/comparison/competitive-matrix.svg" alt="SiftGate competitive matrix" width="100%" />
</p>

ดูรายละเอียดที่ [Comparison](../../COMPARISON.md)

## เริ่มต้นอย่างรวดเร็ว

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

เปิด `http://localhost:2099/dashboard` เพิ่ม Provider Node สร้าง Gateway API Key
แล้วส่ง request ไปที่ `http://localhost:2099/v1/chat/completions`

## เส้นทางตั้งค่าครั้งแรก

1. ตรวจสอบหรือสร้าง Workspace ที่ใช้งานอยู่
2. เพิ่ม Provider Node หนึ่งรายการ
3. สร้าง Dashboard-managed Gateway API Key
4. ผูก Policy Namespace หรือ Team หากจำเป็น
5. ตรวจสอบ daily Budget scope และ source of truth
6. ส่ง request แรกจาก Playground, SDK หรือ OpenAI-compatible client
7. ตรวจสอบ Logs, Sessions และ Route Explanation
8. ตั้งค่า Semantic Controls, Traffic Experiments, Evals, Shadow Traffic หรือ MCP Tool Gateway เฉพาะเมื่อจำเป็น

## แผนที่เอกสาร

| พื้นที่ | จุดเริ่มต้น |
| --- | --- |
| ทดลองในเครื่อง | [Quickstart](../../QUICKSTART.md), [Dashboard](../../DASHBOARD.md), [OSS Concepts](../../OSS_CONCEPTS.md) |
| Container และ production | [Docker Quickstart](../../DOCKER_QUICKSTART.md), [Production](../../PRODUCTION.md), [Kubernetes and Helm](../../KUBERNETES.md), [State Backends](../../STATE_BACKEND.md) |
| Provider และ model | [Provider Catalog](../../PROVIDER_CATALOG.md), [Adding Providers](../../ADDING_PROVIDERS.md), [Provider Compatibility](../../PROVIDER_COMPATIBILITY.md) |
| Routing และ governance | [Routing Recommendations](../../ROUTING_RECOMMENDATIONS.md), [Policy Namespaces and Shadow Traffic](../../NAMESPACES_AND_SHADOW.md), [Cost Platform](../../COST_CHARGEBACK_PLATFORM.md) |
| Agent และ tool traffic | [Coding Agent Gateway](../../CODING_AGENT_GATEWAY.md), [Agent Integrations](../../AGENT_INTEGRATIONS.md), [MCP Tool Gateway](../../MCP_GATEWAY.md) |
| Advanced controls | [Semantic Controls](../../SEMANTIC_PLATFORM.md), [Caching](../../CACHING.md), [Intelligence Loop](../../INTELLIGENCE_LOOP.md), [Evaluation Framework](../../EVALUATION_FRAMEWORK.md) |
| Development | [Architecture](../../ARCHITECTURE.md), [API Reference](../../API_REFERENCE.md), [SDKs](../../SDKS.md), [Plugins](../../PLUGINS.md), [Release Checklist](../../RELEASE_CHECKLIST.md) |
