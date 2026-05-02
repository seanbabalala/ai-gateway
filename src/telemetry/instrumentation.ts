// ===================================================================
// OpenTelemetry SDK Initialization
// ===================================================================
// This file MUST be imported at the very top of main.ts (before NestJS)
// so that HTTP auto-instrumentation can monkey-patch http/https modules.
//
// Reads gateway.config.yaml directly (no NestJS DI available yet).
// When telemetry.enabled is false or absent, nothing happens — all
// @opentelemetry/api calls degrade to no-op automatically.
// ===================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Lightweight read of the telemetry section from config YAML
const configPath =
  process.env.GATEWAY_CONFIG_PATH ||
  path.resolve(process.cwd(), 'gateway.config.yaml');

interface TelemetryCfg {
  enabled?: boolean;
  service_name?: string;
  traces?: { endpoint?: string; sample_rate?: number };
  metrics?: { prometheus_port?: number; otlp_endpoint?: string };
}

let telemetryCfg: TelemetryCfg | null = null;
try {
  if (fs.existsSync(configPath)) {
    const raw = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    telemetryCfg = (raw?.telemetry as TelemetryCfg) || null;
  }
} catch {
  /* config read failure is non-fatal — telemetry stays disabled */
}

if (telemetryCfg?.enabled) {
  // Dynamic requires so the packages are only loaded when telemetry is enabled.
  // This also means if the packages are not installed, the gateway still boots.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');

    const traceEndpoint = telemetryCfg.traces?.endpoint || 'http://localhost:4318/v1/traces';
    const prometheusPort = telemetryCfg.metrics?.prometheus_port || 9464;
    const sampleRate = telemetryCfg.traces?.sample_rate;

    // Build optional sampler when sample_rate < 1
    const samplerOpts: Record<string, unknown> = {};
    if (sampleRate != null && sampleRate < 1) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base');
      samplerOpts.sampler = new TraceIdRatioBasedSampler(sampleRate);
    }

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: telemetryCfg.service_name || 'siftgate',
        [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.1.0',
      }),
      traceExporter: new OTLPTraceExporter({ url: traceEndpoint }),
      metricReader: new PrometheusExporter({ port: prometheusPort }),
      instrumentations: [new HttpInstrumentation()],
      ...samplerOpts,
    });

    sdk.start();

    // Graceful shutdown
    const shutdown = async () => {
      await sdk.shutdown();
      process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // eslint-disable-next-line no-console
    console.log(
      `[Telemetry] SDK started — traces -> ${traceEndpoint}, metrics -> :${prometheusPort}/metrics`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[Telemetry] Failed to initialize SDK: ${(err as Error).message}. Continuing without telemetry.`,
    );
  }
}
