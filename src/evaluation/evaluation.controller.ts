import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DashboardGuard } from '../auth/dashboard.guard';
import { ErrorEnvelopeDto } from '../openapi/openapi.dto';
import {
  EvalRunComparisonInput,
  EvaluationService,
} from './evaluation.service';

@Controller('api/dashboard/evals')
@UseGuards(DashboardGuard)
@ApiTags('Evaluations')
@ApiBearerAuth('dashboardSession')
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
export class EvaluationController {
  constructor(private readonly evaluations: EvaluationService) {}

  @Get('reports')
  @ApiOperation({ summary: 'List local evaluation experiment reports' })
  @ApiQuery({ name: 'period', required: false, example: '30d' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'dataset_id', required: false })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({
    description:
      'Metadata-only eval reports comparing primary vs candidate success, latency, cost, fallback, and judge score.',
  })
  listReports(
    @Query('period') period: string = '30d',
    @Query('status') status?: string,
    @Query('dataset_id') datasetId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.evaluations.listReports({
      period,
      status,
      dataset_id: datasetId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/:id')
  @ApiOperation({ summary: 'Get one local evaluation experiment report' })
  @ApiParam({ name: 'id', example: 'eval-run-uuid' })
  @ApiOkResponse({
    description:
      'One metadata-only eval report with sample-level request ids and scores but no prompt/response bodies.',
  })
  async getReport(@Param('id') id: string) {
    const report = await this.evaluations.getReport(id);
    if (!report) {
      throw new HttpException('Evaluation report not found', HttpStatus.NOT_FOUND);
    }
    return report;
  }

  @Post('runs')
  @ApiOperation({
    summary: 'Run a local primary-vs-candidate evaluation experiment',
    description:
      'Runs samples through normal SiftGate routing and uses a judge model through SiftGate as well. Dashboard UI remains read-only; this endpoint is for local automation.',
  })
  @ApiBody({ description: 'Dataset metadata, primary/candidate targets, judge config, and in-memory samples.' })
  @ApiOkResponse({
    description:
      'Completed metadata-only eval report. Prompt/response samples are not persisted unless explicitly enabled and redacted.',
  })
  run(@Body() body: EvalRunComparisonInput) {
    return this.evaluations.runComparison(body);
  }
}
