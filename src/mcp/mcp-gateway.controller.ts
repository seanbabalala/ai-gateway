import { Body, Controller, Logger, Param, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { RateLimitGuard } from '../auth/rate-limit.guard'
import { gatewayApiKeyFromRequest } from '../auth/gateway-api-key-metadata'
import {
  sendMappedPublicErrorResponse,
  sendPublicResponse,
} from '../http/public-error-handling'
import {
  MCP_REQUEST_ID_HEADER,
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
      if (!res.headersSent) {
        sendMappedPublicErrorResponse(res, req, error, {
          fallbackMessage: 'MCP proxy request failed.',
          extraHeaders: [MCP_REQUEST_ID_HEADER],
        })
      }
    }
  }
}
