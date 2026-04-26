import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineService } from './pipeline.service';
import { ProvidersModule } from '../providers/providers.module';
import { ScoringModule } from '../scoring/scoring.module';
import { RoutingModule } from '../routing/routing.module';
import { BudgetModule } from '../budget/budget.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { CallLog } from '../database/entities/call-log.entity';

@Module({
  imports: [
    ProvidersModule,
    ScoringModule,
    RoutingModule,
    BudgetModule,
    DashboardModule,
    TypeOrmModule.forFeature([CallLog]),
  ],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
