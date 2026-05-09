import {
  Controller,
  Get,
  Header,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DashboardGuard } from '../auth/dashboard.guard';
import { DashboardRbacGuard } from '../auth/dashboard-rbac.guard';
import { RequireDashboardRole } from '../auth/dashboard-rbac';
import {
  ChargebackGroupBy,
  CostPlatformService,
  ExportFormat,
} from './cost-platform.service';

@Controller('api/dashboard/cost-platform')
@UseGuards(DashboardGuard, DashboardRbacGuard)
@RequireDashboardRole('viewer')
@ApiTags('Cost Platform')
@ApiBearerAuth('dashboardSession')
export class CostPlatformDashboardController {
  constructor(private readonly costPlatform: CostPlatformService) {}

  @Get()
  @ApiOperation({
    summary: 'Get internal chargeback, anomaly, pricing, and feedback metadata',
  })
  @ApiQuery({ name: 'period', required: false, example: '30d' })
  @ApiQuery({
    name: 'group_by',
    required: false,
    enum: ['workspace', 'team', 'project', 'api_key', 'model', 'node'],
  })
  @ApiQuery({ name: 'team_id', required: false })
  @ApiQuery({ name: 'project', required: false })
  @ApiQuery({ name: 'api_key_id', required: false })
  @ApiOkResponse({
    description:
      'Metadata-only internal chargeback and cost governance summary. No prompts, responses, provider keys, raw headers, media bytes, or tool payloads are returned.',
  })
  getSummary(
    @Query('period') period: string = '30d',
    @Query('group_by') groupBy: ChargebackGroupBy = 'team',
    @Query('team_id') teamId?: string,
    @Query('project') project?: string,
    @Query('api_key_id') apiKeyId?: string,
  ): Promise<Record<string, unknown>> {
    return this.costPlatform.getDashboardSummary({
      period,
      group_by: groupBy,
      team_id: teamId,
      project,
      api_key_id: apiKeyId,
    });
  }

  @Get('export')
  @ApiOperation({
    summary: 'Export internal chargeback report as CSV or JSON',
  })
  @ApiQuery({ name: 'format', required: false, enum: ['csv', 'json'] })
  @ApiQuery({ name: 'period', required: false, example: '30d' })
  @ApiQuery({
    name: 'group_by',
    required: false,
    enum: ['workspace', 'team', 'project', 'api_key', 'model', 'node'],
  })
  @Header('X-SiftGate-Privacy', 'metadata-only')
  async exportChargeback(
    @Res() res: Response,
    @Query('format') format: ExportFormat = 'csv',
    @Query('period') period: string = '30d',
    @Query('group_by') groupBy: ChargebackGroupBy = 'team',
    @Query('team_id') teamId?: string,
    @Query('project') project?: string,
    @Query('api_key_id') apiKeyId?: string,
  ): Promise<void> {
    const exportFile = await this.costPlatform.exportChargeback(
      format === 'json' ? 'json' : 'csv',
      {
        period,
        group_by: groupBy,
        team_id: teamId,
        project,
        api_key_id: apiKeyId,
      },
    );
    res.setHeader('Content-Type', exportFile.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFile.filename}"`,
    );
    res.send(exportFile.body);
  }
}
