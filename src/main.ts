import './telemetry/instrumentation'; // OTel SDK — must be first import
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

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

  // Enable CORS for frontend dashboard
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // SPA fallback: for any GET that doesn't match API/v1/health/static-asset,
  // serve index.html so client-side routing works on page refresh
  const expressApp = app.getHttpAdapter().getInstance();
  const indexPath = join(__dirname, '..', 'frontend', 'dist', 'index.html');
  const apiPrefixes = ['/api', '/v1', '/health'];

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
  await app.listen(port, host);

  logger.log(`AI Gateway running on http://${host}:${port}`);
  logger.log(`Nodes configured: ${config.nodes.map((n) => n.id).join(', ')}`);
}

bootstrap();
