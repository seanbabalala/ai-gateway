import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ActionResponseDto,
  AnthropicMessagesRequestDto,
  AudioSpeechRequestDto,
  AudioTranscriptionRequestDto,
  AudioTranslationRequestDto,
  AuthStatusResponseDto,
  ChatCompletionsRequestDto,
  ErrorEnvelopeDto,
  EmbeddingsRequestDto,
  GatewayApiKeyCreatedResponseDto,
  GatewayApiKeyListResponseDto,
  GatewayApiKeyMutationResponseDto,
  HealthModelCircuitDto,
  HealthRealtimeDto,
  HealthResponseDto,
  ImageEditRequestDto,
  ImageGenerationRequestDto,
  ImageVariationRequestDto,
  LoginRequestDto,
  LoginResponseDto,
  ModelListResponseDto,
  RerankRequestDto,
  ResponsesRequestDto,
  SanitizedConfigResponseDto,
} from './openapi.dto';

export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('SiftGate Data Plane API')
    .setDescription(
      'OpenAPI documentation for the MIT open-source SiftGate data plane, local dashboard API, and provider-compatible ingress endpoints.',
    )
    .setVersion('1.8.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Gateway API key',
        description: 'Use a Dashboard-generated Gateway API key for /v1 proxy endpoints.',
      },
      'gatewayApiKey',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Dashboard JWT',
        description: 'Use the Dashboard session JWT when dashboard auth is enabled.',
      },
      'dashboardSession',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
    extraModels: [
      ActionResponseDto,
      AnthropicMessagesRequestDto,
      AudioSpeechRequestDto,
      AudioTranscriptionRequestDto,
      AudioTranslationRequestDto,
      AuthStatusResponseDto,
      ChatCompletionsRequestDto,
      ErrorEnvelopeDto,
      EmbeddingsRequestDto,
      GatewayApiKeyCreatedResponseDto,
      GatewayApiKeyListResponseDto,
      GatewayApiKeyMutationResponseDto,
      HealthModelCircuitDto,
      HealthRealtimeDto,
      HealthResponseDto,
      ImageEditRequestDto,
      ImageGenerationRequestDto,
      ImageVariationRequestDto,
      LoginRequestDto,
      LoginResponseDto,
      ModelListResponseDto,
      RerankRequestDto,
      ResponsesRequestDto,
      SanitizedConfigResponseDto,
    ],
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'SiftGate API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  });

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get('/openapi.json', (_req: Request, res: Response) => {
    res.type('application/json').send(document);
  });
}
