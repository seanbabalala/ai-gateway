import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { DashboardController } from './dashboard.controller';
import { LogEventBus } from './log-event-bus';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
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
  ShadowTrafficResult,
  WorkspaceInvitation,
} from '../database/entities';
import { ProviderCompatibilityService } from './provider-compatibility.service';
import { CatalogModule } from '../catalog/catalog.module';
import { ConfigAuditService } from './config-audit.service';
import { BenchmarkReportService } from './benchmark-report.service';
import { CacheSavingsService } from './cache-savings.service';
import { McpModule } from '../mcp/mcp.module';
import { BatchModule } from '../batch/batch.module';
import { AgentProfilesModule } from '../agent-profiles/agent-profiles.module';
import { ClusterModule } from '../cluster/cluster.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RoutingModule,
    BudgetModule,
    CacheModule,
    AuthModule,
    ShadowModule,
    CatalogModule,
    McpModule,
    BatchModule,
    AgentProfilesModule,
    ClusterModule,
    TypeOrmModule.forFeature([
      CallLog,
      ConfigAuditEvent,
      ConfigVersion,
      RouteDecisionLog,
      ShadowTrafficResult,
      ProviderCompatibilityResult,
      WorkspaceInvitation,
    ]),
  ],
  controllers: [HealthController, DashboardController],
  providers: [
    LogEventBus,
    ProviderCompatibilityService,
    ConfigAuditService,
    BenchmarkReportService,
    CacheSavingsService,
  ],
  exports: [LogEventBus],
})
export class DashboardModule {}
