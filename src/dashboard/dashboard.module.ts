import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { DashboardController } from './dashboard.controller';
import { LogEventBus } from './log-event-bus';
import { ConfigAuditService } from './config-audit.service';
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
  RouteDecisionLog,
} from '../database/entities';

@Module({
  imports: [
    ConfigModule,
    RoutingModule,
    BudgetModule,
    CacheModule,
    AuthModule,
    ShadowModule,
    TypeOrmModule.forFeature([
      CallLog,
      RouteDecisionLog,
      ConfigVersion,
      ConfigAuditEvent,
    ]),
  ],
  controllers: [HealthController, DashboardController],
  providers: [LogEventBus, ConfigAuditService],
  exports: [LogEventBus],
})
export class DashboardModule {}
