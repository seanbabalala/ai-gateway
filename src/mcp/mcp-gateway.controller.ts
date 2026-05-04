import { Body, Controller, Param, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ApiKeyGuard } from '../auth/api-key.guard'
import { RateLimitGuard } from '../auth/rate-limit.guard'
import { gatewayApiKeyFromRequest } from '../auth/gateway-api-key-metadata'
import { ErrorEnvelopeDto } from '../openapi/openapi.dto'
import { McpGatewayService } from './mcp-gateway.service'

@Controller('mcp')
@UseGuards(ApiKeyGuard, RateLimitGuard)
@ApiTags('MCP Gateway')
@ApiBearerAuth('gatewayApiKey')
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
export class McpGatewayController {
  constructor(private readonly mcp: McpGatewayService) {}

  @Post(':serverId')
  @ApiOperation({
    summary: 'Proxy a JSON-RPC MCP request to a configured local MCP server',
  })
  async proxy(@Param('serverId') serverId: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const result = await this.mcp.proxy({
      serverId,
      body,
      apiKey: gatewayApiKeyFromRequest(req),
    })

    res.status(result.statusCode)
    res.type(result.contentType)
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value)
    }
    return res.send(result.bodyText)
  }
}
