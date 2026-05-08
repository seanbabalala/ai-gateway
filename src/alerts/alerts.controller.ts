import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DashboardGuard } from '../auth/dashboard.guard';
import { DashboardRbacGuard } from '../auth/dashboard-rbac.guard';
import { ErrorEnvelopeDto } from '../openapi/openapi.dto';
import { AlertService } from './alert.service';

@Controller('api/dashboard/alerts')
@UseGuards(DashboardGuard, DashboardRbacGuard)
@ApiTags('Dashboard')
@ApiBearerAuth('dashboardSession')
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
export class AlertsController {
  constructor(private readonly alerts: AlertService) {}

  @Get()
  @ApiOperation({ summary: 'Get recent local alert delivery status' })
  @ApiOkResponse({ description: 'Configured alert channels and recent delivery results.' })
  getAlerts() {
    return this.alerts.getDashboardSnapshot();
  }
}
