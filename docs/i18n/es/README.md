# Documentación de SiftGate

[Inicio de documentación](../../README.md) · [README del proyecto](../../../README.md)

Versión actual: **v2.11.2**.

SiftGate es el AI traffic data plane self-hosted para equipos que ya superaron
las claves directas de proveedor, los proxies puntuales y el routing de modelos
opaco. Reúne apps, Coding Agents, herramientas MCP, credenciales de proveedor,
políticas de routing, presupuestos, evidencia de caché y operaciones de
producción en un único plano de control local.

<p align="center">
  <img src="../../assets/homepage/siftgate-hero.svg" alt="SiftGate AI traffic data plane" width="100%" />
</p>

## Mensaje De Producto Actualizado

| Fortaleza de SiftGate | Por qué importa |
| --- | --- |
| AI traffic data plane | Política, routing, selección de credenciales, presupuestos, coste, caché, auditoría y evidencia viven en una ruta self-hosted. |
| Gobierno de Agent y MCP | Cursor, Cline, Roo Code, Continue, Codex, Claude Code, OpenCode, agents OpenAI/Anthropic genéricos y herramientas MCP pueden usar un solo ingreso gobernado. |
| Credential pools conscientes de caché | Un Provider Node puede tener varias claves upstream con `cache_aware`, least-in-flight, weighted rotation, sticky affinity, cooldown y retry failover. |
| Route Explanation | Los operadores ven por qué un modelo/nodo fue elegido, omitido, reintentado, degradado o rechazado sin guardar prompts/responses por defecto. |
| Metadata-only por defecto | Por defecto no guarda prompts, responses, raw headers, provider keys, tool payloads, media bytes, source, diffs, hidden reasoning ni resolved secrets. |
| Camino a producción | Empieza con SQLite y memory state, y crece a PostgreSQL, Redis, Docker, Kubernetes, Helm, OIDC, secret references, log sinks y OpenTelemetry. |

## Pitch De 30 Segundos

La mayoría de gateways se queda en "a qué modelo envío esta solicitud".
SiftGate convierte el tráfico de IA en un control loop gobernado y explicable:

1. Autentica una Gateway API Key y resuelve Workspace, Team y Policy Namespace.
2. Comprueba permisos de endpoint, modality, model, node, budget y rate limit.
3. Enruta por compatibilidad, coste, latencia, salud, evidencia de caché y reglas de fallback.
4. Selecciona la credencial upstream correcta, incluyendo cache-aware affinity.
5. Devuelve una respuesta compatible con el proveedor y guarda evidencia operativa export-safe.

## Provider Credential Pools

Un Provider Node puede usar una sola `api_key` o un pool first-class
`credentials[]`. El pool rota y reintenta claves upstream dentro del mismo nodo
lógico antes de pasar al fallback entre nodos.

```yaml
credential_pool:
  enabled: true
  strategy: cache_aware
  sticky_by: agent_session
  cooldown_ms: 60000
  max_failures: 3
  retry_on_status: [429, 500, 502, 503, 504]
```

Usa `cache_aware` cuando un coding plan o workload de Agent tenga varias claves
para el mismo proveedor/cuenta/superficie de modelo. SiftGate mantiene el
tráfico que crea o lee provider prompt cache en la misma clave upstream cuando
puede, y cambia de clave ante 429/5xx/timeouts.

## Posicionamiento Competitivo

SiftGate no es solo un router barato de modelos ni un panel de reventa de API.
Es un AI traffic data plane self-hosted para gobierno BYOK, evidencia de rutas,
control Agent/MCP, pools de claves cache-aware y operaciones de producción.

<p align="center">
  <img src="../../assets/comparison/competitive-matrix.svg" alt="SiftGate competitive matrix" width="100%" />
</p>

Consulta [Comparison](../../COMPARISON.md) para el posicionamiento completo.

## Inicio Rápido

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
Gateway API Key y envía una solicitud a `http://localhost:2099/v1/chat/completions`.

## Primer Recorrido

1. Confirma o crea el Workspace activo.
2. Agrega un Provider Node.
3. Crea una Gateway API Key administrada por Dashboard.
4. Vincula la key a un Policy Namespace o Team si lo necesitas.
5. Revisa el alcance diario de Budget y su source of truth.
6. Envía la primera solicitud desde Playground, SDK o un cliente OpenAI-compatible.
7. Revisa Logs, Sessions y Route Explanation.
8. Configura Semantic Controls, Traffic Experiments, Evals, Shadow Traffic o MCP Tool Gateway solo cuando los necesites.

## Mapa De Documentos

| Área | Entradas |
| --- | --- |
| Evaluación local | [Quickstart](../../QUICKSTART.md), [Dashboard](../../DASHBOARD.md), [OSS Concepts](../../OSS_CONCEPTS.md) |
| Contenedores y producción | [Docker Quickstart](../../DOCKER_QUICKSTART.md), [Production](../../PRODUCTION.md), [Kubernetes and Helm](../../KUBERNETES.md), [State Backends](../../STATE_BACKEND.md) |
| Proveedores y modelos | [Provider Catalog](../../PROVIDER_CATALOG.md), [Adding Providers](../../ADDING_PROVIDERS.md), [Provider Compatibility](../../PROVIDER_COMPATIBILITY.md) |
| Routing y gobierno | [Routing Recommendations](../../ROUTING_RECOMMENDATIONS.md), [Policy Namespaces and Shadow Traffic](../../NAMESPACES_AND_SHADOW.md), [Cost Platform](../../COST_CHARGEBACK_PLATFORM.md) |
| Agents y herramientas | [Coding Agent Gateway](../../CODING_AGENT_GATEWAY.md), [Agent Integrations](../../AGENT_INTEGRATIONS.md), [MCP Tool Gateway](../../MCP_GATEWAY.md) |
| Controles avanzados | [Semantic Controls](../../SEMANTIC_PLATFORM.md), [Caching](../../CACHING.md), [Intelligence Loop](../../INTELLIGENCE_LOOP.md), [Evaluation Framework](../../EVALUATION_FRAMEWORK.md) |
| Desarrollo | [Architecture](../../ARCHITECTURE.md), [API Reference](../../API_REFERENCE.md), [SDKs](../../SDKS.md), [Plugins](../../PLUGINS.md), [Release Checklist](../../RELEASE_CHECKLIST.md) |
