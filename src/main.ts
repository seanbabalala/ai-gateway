import './telemetry/instrumentation'; // OTel SDK — must be first import
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { json, raw, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { setupOpenApi } from './openapi/setup-openapi';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService);

  // Enable global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  setupOpenApi(app);

  // Helmet — standard security response headers
  if (config.server.helmet !== false) {
    app.use(helmet());
  }

  // Configurable CORS
  const corsConfig = config.server.cors ?? { origin: true };
  app.enableCors({
    origin: corsConfig.origin,
    credentials: corsConfig.credentials ?? true,
  });

  // Body size limit
  const bodyLimit = config.server.body_limit ?? '1mb';
  const mediaBodyTypes = [
    'multipart/form-data',
    'application/octet-stream',
    'audio/*',
    'image/*',
  ];
  for (const route of [
    '/v1/images/generations',
    '/v1/images/edits',
    '/v1/images/variations',
    '/v1/audio/transcriptions',
    '/v1/audio/translations',
    '/v1/audio/speech',
  ]) {
    app.use(route, raw({ type: mediaBodyTypes, limit: bodyLimit }));
  }
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  // Trust proxy — required to get real client IP behind reverse proxies
  if (config.server.trust_proxy) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', config.server.trust_proxy);
  }

  // SPA fallback: for any GET that doesn't match API/v1/health/ready/cluster/static-asset,
  // serve index.html so client-side routing works on page refresh
  const expressApp = app.getHttpAdapter().getInstance();
  const indexPath = join(__dirname, '..', 'frontend', 'dist', 'index.html');
  const apiPrefixes = ['/api', '/v1', '/health', '/ready', '/cluster'];

  expressApp.use(
    (
      req: { method: string; url: string; path: string },
      res: { sendFile: (path: string) => void },
      next: () => void,
    ) => {
      // Only intercept GET requests
      if (req.method !== 'GET') return next();
      // Skip API routes
      if (apiPrefixes.some((p) => req.path.startsWith(p))) return next();
      // Skip static assets (files with extensions)
      if (/\.\w+$/.test(req.path)) return next();
      // SPA fallback — serve index.html
      res.sendFile(indexPath);
    },
  );

  const { port, host } = config.server;

  // Graceful shutdown
  app.enableShutdownHooks();
  const shutdownTimeout = config.server.shutdown_timeout_ms ?? 5000;
  process.on('SIGTERM', async () => {
    logger.log(`Graceful shutdown initiated (timeout: ${shutdownTimeout}ms)...`);
    setTimeout(() => process.exit(1), shutdownTimeout);
    await app.close();
    process.exit(0);
  });

  await app.listen(port, host);

  logger.log(`SiftGate running on http://${host}:${port}`);
  logger.log(`Nodes configured: ${config.nodes.map((n) => n.id).join(', ')}`);
}

bootstrap();
