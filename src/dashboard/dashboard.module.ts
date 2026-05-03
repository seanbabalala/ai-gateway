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
  ProviderCompatibilityResult,
  RouteDecisionLog,
} from '../database/entities';
import { ProviderCompatibilityService } from './provider-compatibility.service';

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
      ProviderCompatibilityResult,
    ]),
  ],
  controllers: [HealthController, DashboardController],
  providers: [LogEventBus, ProviderCompatibilityService],
  exports: [LogEventBus],
})
export class DashboardModule {}
