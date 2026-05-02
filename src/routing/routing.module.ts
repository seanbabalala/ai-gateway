import { Module } from '@nestjs/common';
import { RoutingService } from './routing.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MomentumService } from './momentum.service';
import { ConcurrencyLimiterService } from './concurrency-limiter.service';
import { ActiveHealthProbeService } from './active-health-probe.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [
    RoutingService,
    CircuitBreakerService,
    MomentumService,
    ConcurrencyLimiterService,
    ActiveHealthProbeService,
  ],
  exports: [
    RoutingService,
    CircuitBreakerService,
    MomentumService,
    ConcurrencyLimiterService,
    ActiveHealthProbeService,
  ],
})
export class RoutingModule {}
