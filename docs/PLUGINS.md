# SiftGate Plugin Manager

SiftGate plugins run inside the open-source Data Plane. They can add pipeline hooks, scoring dimensions, and event subscriptions without requiring SiftGate Cloud.

## Commands

After building, use the executable CLI:

```bash
npm run build
node dist/cli/siftgate.js plugin install ./plugins/my-plugin
node dist/cli/siftgate.js plugin install @siftgate/plugin-guardrails
node dist/cli/siftgate.js plugin list
node dist/cli/siftgate.js plugin remove @siftgate/plugin-guardrails
```

During local development, the same command is available through `ts-node`:

```bash
npx ts-node src/cli/siftgate.ts plugin list
```

## Declaration File

`plugin install` writes `plugins.config.yaml` by default. It does not rewrite `gateway.config.yaml`, so operators can keep provider, routing, and secret-bearing config separate from plugin package declarations.

```yaml
plugins:
  - name: '@siftgate/plugin-guardrails'
    source: npm
    package: '@siftgate/plugin-guardrails'
    path: '@siftgate/plugin-guardrails'
    version: 1.0.0
    required: true
    gateway:
      required: ^0.4.0
      checked_with: 0.4.0
    installed_at: '2026-05-02T00:00:00.000Z'
```

The runtime loader merges entries from `gateway.config.yaml` `plugins:` and `plugins.config.yaml`. Existing local `plugins/` directory discovery still works.

Set `SIFTGATE_PLUGINS_CONFIG=/path/to/plugins.config.yaml` to point the runtime loader at a non-default declaration file. The CLI equivalent is `--config <path>`.

## Package Sources

Local plugins:

```bash
node dist/cli/siftgate.js plugin install ./plugins/pii-filter
```

The path can be a plugin file or directory. When a nearby `package.json` exists, the manager records the plugin version and checks compatibility.

NPM plugins:

```bash
node dist/cli/siftgate.js plugin install @siftgate/plugin-redis-cache
```

The first registry mode is intentionally narrow: npm package names must match `@siftgate/plugin-*`. The CLI reads metadata with `npm view`, checks compatibility, runs `npm install --save`, then records the package path in `plugins.config.yaml`.

Use `--no-npm-install` when the package is already installed and only the declaration should be written.

## Compatibility Metadata

Plugins should declare the supported gateway range in one of these package metadata locations:

```json
{
  "name": "@siftgate/plugin-example",
  "version": "1.0.0",
  "peerDependencies": {
    "siftgate": "^0.4.0"
  },
  "siftgate": {
    "gateway": "^0.4.0"
  }
}
```

The manager supports exact versions, `^`, `~`, wildcard `*`, and simple comparator ranges such as `>=0.4.0 <0.5.0`. Missing compatibility metadata is allowed with a warning; incompatible ranges fail before the declaration is written.

## Safety

- `plugin install` refuses duplicate declarations unless `--force` is supplied.
- `plugin remove` removes declarations from `plugins.config.yaml`; it does not edit `gateway.config.yaml`.
- Provider API keys, dashboard passwords, prompts, and responses are never written to plugin declarations.
- SiftGate Cloud is not required for plugin installation or loading.
