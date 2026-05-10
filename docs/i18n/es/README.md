# Documentacion de SiftGate

[Inicio de documentacion](../../README.md) · [README del proyecto](../../../README.md)

SiftGate es una pasarela de trafico de IA self-hosted para equipos que ejecutan
agentes y aplicaciones con varios proveedores. Mantiene routing, politicas,
presupuestos, auditoria y evidencia de metadatos dentro de tu entorno. Por
defecto no guarda prompts, respuestas, headers crudos, claves de proveedor,
payloads de herramientas, bytes multimedia, razonamiento oculto ni secretos
resueltos.

## Inicio Rapido

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

Abre `http://localhost:2099/dashboard`, agrega un Provider Node, crea una
Gateway API Key y envia tu primera solicitud a
`http://localhost:2099/v1/chat/completions`.

## Primer Recorrido

1. Confirma el Workspace activo.
2. Agrega un Provider Node.
3. Crea una Gateway API Key.
4. Vincula un Policy Namespace si lo necesitas.
5. Revisa el alcance diario de Budget y su source of truth.
6. Envia la primera solicitud.
7. Revisa Logs y Route Explanation.
8. Configura Semantic Controls, Traffic Experiments, Evals, Shadow Traffic o MCP Tool Gateway solo cuando los necesites.

## Conceptos Clave

| Concepto | Significado |
| --- | --- |
| Workspace | Limite local para Dashboard y metadatos. |
| Provider Node | Cuenta upstream, deployment, proxy o runtime local configurado. |
| Gateway API Key | Clave para clientes generada por SiftGate, distinta de las claves del proveedor. |
| Policy Namespace | Etiqueta local respaldada por config para API Keys, Teams, presupuestos, rate limits y allow-lists de nodos/modelos. |
| MCP Tool Gateway | Gobierno y proxy de llamadas a herramientas MCP, no routing de modelos. |

## Mapa De Documentos

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
