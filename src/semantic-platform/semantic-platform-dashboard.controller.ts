import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { DashboardGuard } from '../auth/dashboard.guard';
import { DashboardRbacGuard } from '../auth/dashboard-rbac.guard';
import { RequireDashboardRole } from '../auth/dashboard-rbac';
import {
  CreatePromptTemplateInput,
  SemanticPlatformService,
} from './semantic-platform.service';

@Controller('api/dashboard/semantic-platform')
@UseGuards(DashboardGuard, DashboardRbacGuard)
@RequireDashboardRole('viewer')
@ApiTags('Semantic Platform')
@ApiBearerAuth('dashboardSession')
export class SemanticPlatformDashboardController {
  constructor(private readonly semanticPlatform: SemanticPlatformService) {}

  @Get()
  @ApiOperation({
    summary: 'Get metadata-only Semantic Platform summary',
  })
  @ApiQuery({ name: 'period', required: false, example: '7d' })
  @ApiOkResponse({
    description:
      'Semantic cache, prompt registry, context optimizer, intent classification, and Guardrails v2 metadata without prompts, responses, raw headers, provider keys, media bytes, or tool payloads.',
  })
  getSummary(@Query('period') period: string = '7d') {
    return this.semanticPlatform.getDashboardSummary(period);
  }

  @Get('prompt-templates')
  @ApiOperation({ summary: 'List workspace prompt template metadata' })
  @ApiOkResponse({
    description:
      'Prompt template metadata and hashes. Template body content is not returned.',
  })
  listPromptTemplates() {
    return this.semanticPlatform.listPromptTemplates();
  }

  @Post('prompt-templates')
  @RequireDashboardRole('operator')
  @ApiOperation({ summary: 'Create a workspace prompt template version' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['prompt_key', 'template'],
      properties: {
        prompt_key: { type: 'string', example: 'support-summary' },
        name: { type: 'string', example: 'Support Summary' },
        template: { type: 'string', example: 'Summarize {{ticket}}.' },
        variables: { type: 'array', items: { type: 'string' } },
        route_policy_id: { type: 'string' },
        ab_metadata: { type: 'object' },
        metadata: { type: 'object' },
      },
    },
  })
  createPromptTemplate(@Body() body: CreatePromptTemplateInput) {
    return this.semanticPlatform.createPromptTemplate(body);
  }

  @Delete('prompt-templates/:id')
  @RequireDashboardRole('operator')
  @ApiOperation({ summary: 'Archive a workspace prompt template version' })
  archivePromptTemplate(@Param('id') id: string) {
    return this.semanticPlatform.archivePromptTemplate(id);
  }

  @Post('semantic-cache/invalidate')
  @RequireDashboardRole('operator')
  @ApiOperation({ summary: 'Invalidate Semantic Cache v2 entries' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['workspace', 'all'], example: 'workspace' },
      },
    },
  })
  invalidateSemanticCache(@Body() body: { scope?: 'workspace' | 'all' }) {
    return this.semanticPlatform.invalidateSemanticCache(body?.scope || 'workspace');
  }
}
