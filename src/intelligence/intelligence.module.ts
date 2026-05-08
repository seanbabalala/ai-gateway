import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { BudgetModule } from '../budget/budget.module';
import { RoutingModule } from '../routing/routing.module';
import { AlertsModule } from '../alerts/alerts.module';
import { IntelligenceLoopService } from './intelligence-loop.service';

@Global()
@Module({
  imports: [ConfigModule, BudgetModule, RoutingModule, AlertsModule],
  providers: [IntelligenceLoopService],
  exports: [IntelligenceLoopService],
})
export class IntelligenceModule {}
