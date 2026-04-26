import { Module } from '@nestjs/common';
import { RoutingService } from './routing.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MomentumService } from './momentum.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [RoutingService, CircuitBreakerService, MomentumService],
  exports: [RoutingService, CircuitBreakerService, MomentumService],
})
export class RoutingModule {}
