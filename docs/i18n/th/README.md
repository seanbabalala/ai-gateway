# เอกสาร SiftGate

[หน้าหลักเอกสาร](../../README.md) · [README ของโปรเจกต์](../../../README.md)

SiftGate คือ AI traffic gateway แบบ self-hosted สำหรับทีมที่ใช้งาน agent,
แอปพลิเคชัน และผู้ให้บริการ AI หลายราย ระบบเก็บ routing, policy, budget, audit
และ metadata evidence ไว้ในสภาพแวดล้อมของคุณเอง และโดยค่าเริ่มต้นจะไม่บันทึก
prompt, response, raw header, provider key, tool payload, media bytes,
hidden reasoning หรือ secret ที่ resolve แล้ว

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

เปิด `http://localhost:2099/dashboard` เพิ่ม Provider Node หนึ่งรายการ สร้าง
Gateway API Key แล้วส่ง request แรกไปที่
`http://localhost:2099/v1/chat/completions`

## เส้นทางตั้งค่าครั้งแรก

1. ตรวจสอบ Workspace ที่ใช้งานอยู่
2. เพิ่ม Provider Node
3. สร้าง Gateway API Key
4. ผูก Policy Namespace เมื่อจำเป็น
5. ตรวจสอบ daily Budget scope และ source of truth
6. ส่ง request แรก
7. ตรวจสอบ Logs และ Route Explanation
8. ตั้งค่า Semantic Controls, Traffic Experiments, Evals, Shadow Traffic หรือ MCP Tool Gateway เฉพาะเมื่อจำเป็น

## แนวคิดหลัก

| แนวคิด | ความหมาย |
| --- | --- |
| Workspace | ขอบเขตของ Dashboard และ metadata ในเครื่อง |
| Provider Node | upstream account, deployment, proxy หรือ local runtime ที่ตั้งค่าไว้ |
| Gateway API Key | key สำหรับ client ที่ SiftGate สร้างขึ้น ไม่ใช่ provider key |
| Policy Namespace | label policy ใน config สำหรับ API Key, Team, budget, rate limit และ allow-list ของ node/model |
| MCP Tool Gateway | governance และ proxy สำหรับ MCP tool-call ไม่ใช่ model routing |

## แผนที่เอกสาร

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
