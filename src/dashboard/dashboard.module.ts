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
import { CallLog } from '../database/entities/call-log.entity';

@Module({
  imports: [
    ConfigModule,
    RoutingModule,
    BudgetModule,
    CacheModule,
    AuthModule,
    TypeOrmModule.forFeature([CallLog]),
  ],
  controllers: [HealthController, DashboardController],
  providers: [LogEventBus],
  exports: [LogEventBus],
})
export class DashboardModule {}
