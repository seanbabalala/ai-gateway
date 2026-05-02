import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineService } from './pipeline.service';
import { ProvidersModule } from '../providers/providers.module';
import { ScoringModule } from '../scoring/scoring.module';
import { RoutingModule } from '../routing/routing.module';
import { BudgetModule } from '../budget/budget.module';
import { CacheModule } from '../cache/cache.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ControlPlaneModule } from '../control-plane/control-plane.module';
import { AlertsModule } from '../alerts/alerts.module';
import { CallLog } from '../database/entities/call-log.entity';

@Module({
  imports: [
    ProvidersModule,
    ScoringModule,
    RoutingModule,
    BudgetModule,
    CacheModule,
    DashboardModule,
    ControlPlaneModule,
    AlertsModule,
    TypeOrmModule.forFeature([CallLog]),
  ],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
