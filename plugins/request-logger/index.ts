// ===================================================================
// Request Logger Plugin — Example plugin for request log forwarding
// ===================================================================
// Subscribes to 'log' events and forwards them to a webhook URL.
// Fire-and-forget — errors are silently ignored.
//
// Config:
//   webhook_url: string — URL to POST log events to
//
// Usage in gateway.config.yaml:
//   plugins:
//     - path: plugins/request-logger
//       config:
//         webhook_url: https://your-logging-service.com/ingest
// ===================================================================

import type { GatewayPlugin } from '../../src/plugins/types';

export default class RequestLoggerPlugin implements GatewayPlugin {
  meta = {
    name: 'request-logger',
    version: '1.0.0',
    priority: 200,
    configSchema: {
      type: 'object',
      properties: {
        webhook_url: { type: 'string', format: 'uri' },
      },
      required: ['webhook_url'],
    },
  };

  private webhookUrl = '';

  async onLoad(config: Readonly<Record<string, unknown>>): Promise<void> {
    this.webhookUrl = config.webhook_url as string;
  }

  events = [
    {
      event: 'log',
      handler: async (payload: unknown): Promise<void> => {
        if (!this.webhookUrl) return;

        fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {}); // fire-and-forget
      },
    },
  ];
}
