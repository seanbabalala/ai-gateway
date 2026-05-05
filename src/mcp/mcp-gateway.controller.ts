import { Body, Controller, HttpException, Logger, Param, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { RateLimitGuard } from '../auth/rate-limit.guard'
import { gatewayApiKeyFromRequest } from '../auth/gateway-api-key-metadata'
import {
  MCP_REQUEST_ID_HEADER,
  extractRequestIdFromHttpException,
  sendPublicErrorResponse,
  sendPublicResponse,
} from '../http/public-contract'
import { ErrorEnvelopeDto } from '../openapi/openapi.dto'
import { McpGatewayService } from './mcp-gateway.service'

@Controller('mcp')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('MCP Gateway')
@ApiBearerAuth('gatewayApiKey')
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
export class McpGatewayController {
  private readonly logger = new Logger(McpGatewayController.name)

  constructor(private readonly mcp: McpGatewayService) {}

  @Post(':serverId')
  @ApiOperation({
    summary: 'Proxy a JSON-RPC MCP request to a configured local MCP server',
  })
  async proxy(@Param('serverId') serverId: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    try {
      const result = await this.mcp.proxy({
        serverId,
        body,
        apiKey: gatewayApiKeyFromRequest(req),
      })

      for (const [key, value] of Object.entries(result.headers)) {
        res.setHeader(key, value)
      }
      sendPublicResponse(
        res,
        {
          statusCode: result.statusCode,
          body: result.bodyText,
          contentType: result.contentType,
          requestId: result.requestId,
        },
        [MCP_REQUEST_ID_HEADER],
      )
    } catch (error) {
      this.logger.warn(
        `mcp proxy failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      if (error instanceof HttpException) {
        const status = error.getStatus()
        const response = error.getResponse()
        const bodyRecord =
          typeof response === 'object' && response ? response as Record<string, unknown> : null
        const errorRecord =
          bodyRecord && typeof bodyRecord.error === 'object' && bodyRecord.error
            ? bodyRecord.error as Record<string, unknown>
            : null
        sendPublicErrorResponse(
          res,
          status,
          'openai',
          typeof response === 'string'
            ? response
            : typeof errorRecord?.message === 'string'
              ? errorRecord.message
              : typeof bodyRecord?.message === 'string'
                ? bodyRecord.message
                : error.message,
          {
            type:
              typeof errorRecord?.type === 'string'
                ? errorRecord.type
                : status === 404
                  ? 'not_found'
                  : status === 403
                    ? 'forbidden'
                    : status === 413
                      ? 'payload_too_large'
                      : 'mcp_proxy_error',
            code:
              typeof errorRecord?.code === 'string'
                ? errorRecord.code
                : typeof bodyRecord?.code === 'string'
                  ? bodyRecord.code
                  : undefined,
            details: errorRecord?.details ?? bodyRecord?.details,
            requestId: extractRequestIdFromHttpException(error),
            extraHeaders: [MCP_REQUEST_ID_HEADER],
          },
        )
        return
      }
      sendPublicErrorResponse(res, 500, 'openai', 'MCP proxy request failed.', {
        type: 'internal_error',
        extraHeaders: [MCP_REQUEST_ID_HEADER],
      })
    }
  }
}
