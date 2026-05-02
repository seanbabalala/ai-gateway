import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineService } from './pipeline.service';
import { EmbeddingBatchingService } from './embedding-batching.service';
import { ProvidersModule } from '../providers/providers.module';
import { ScoringModule } from '../scoring/scoring.module';
import { RoutingModule } from '../routing/routing.module';
import { BudgetModule } from '../budget/budget.module';
import { CacheModule } from '../cache/cache.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ControlPlaneModule } from '../control-plane/control-plane.module';
import { AlertsModule } from '../alerts/alerts.module';
import { LogSinksModule } from '../log-sinks/log-sinks.module';
import { ShadowModule } from '../shadow/shadow.module';
import { CallLog, RouteDecisionLog } from '../database/entities';

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
    LogSinksModule,
    ShadowModule,
    TypeOrmModule.forFeature([CallLog, RouteDecisionLog]),
  ],
  providers: [PipelineService, EmbeddingBatchingService],
  exports: [PipelineService, EmbeddingBatchingService],
})
export class PipelineModule {}
