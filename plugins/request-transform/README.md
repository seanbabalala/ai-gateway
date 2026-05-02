# request-transform

Official SiftGate runtime plugin for local request rewriting before routing.

## Example

```yaml
plugins:
  - path: plugins/request-transform
    required: false
    config:
      enabled: true
      rules:
        - name: deterministic-json
          when:
            source_format: chat_completions
          set:
            temperature: 0
          prepend_system: Respond concisely and follow the requested schema.
```

## Safety

- Disabled by default.
- Transformations are local only and do not send prompt or response content to external systems.
- Rules must be explicitly configured; with no rules the plugin is a no-op.
- Regex replacement failures are ignored rather than failing the gateway request.
