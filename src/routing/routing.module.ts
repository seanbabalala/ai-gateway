import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoutingService } from './routing.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MomentumService } from './momentum.service';
import { AdaptiveRoutingStatsService } from './adaptive-routing-stats.service';
import { RoutingRecommendationService } from './routing-recommendation.service';
import { ConfigModule } from '../config/config.module';
import { CallLog } from '../database/entities/call-log.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([CallLog])],
  providers: [
    RoutingService,
    CircuitBreakerService,
    MomentumService,
    AdaptiveRoutingStatsService,
    RoutingRecommendationService,
  ],
  exports: [
    RoutingService,
    CircuitBreakerService,
    MomentumService,
    AdaptiveRoutingStatsService,
    RoutingRecommendationService,
  ],
})
export class RoutingModule {}
