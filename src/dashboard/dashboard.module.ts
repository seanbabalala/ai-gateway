import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { DashboardController } from './dashboard.controller';
import { LogEventBus } from './log-event-bus';
import { ConfigModule } from '../config/config.module';
import { RoutingModule } from '../routing/routing.module';
import { BudgetModule } from '../budget/budget.module';
import { CacheModule } from '../cache/cache.module';
import { AuthModule } from '../auth/auth.module';
import { ShadowModule } from '../shadow/shadow.module';
import {
  CallLog,
  ConfigAuditEvent,
  ConfigVersion,
  ProviderCompatibilityResult,
  RouteDecisionLog,
} from '../database/entities';
import { ProviderCompatibilityService } from './provider-compatibility.service';
import { CatalogModule } from '../catalog/catalog.module';
import { ConfigAuditService } from './config-audit.service';
import { BenchmarkReportService } from './benchmark-report.service';

@Module({
  imports: [
    ConfigModule,
    RoutingModule,
    BudgetModule,
    CacheModule,
    AuthModule,
    ShadowModule,
    CatalogModule,
    TypeOrmModule.forFeature([
      CallLog,
      ConfigAuditEvent,
      ConfigVersion,
      RouteDecisionLog,
      ProviderCompatibilityResult,
    ]),
  ],
  controllers: [HealthController, DashboardController],
  providers: [
    LogEventBus,
    ProviderCompatibilityService,
    ConfigAuditService,
    BenchmarkReportService,
  ],
  exports: [LogEventBus],
})
export class DashboardModule {}
