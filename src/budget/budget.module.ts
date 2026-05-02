import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetService } from './budget.service';
import { BudgetRule } from '../database/entities/budget-rule.entity';
import { ConfigModule } from '../config/config.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [ConfigModule, AlertsModule, TypeOrmModule.forFeature([BudgetRule])],
  providers: [BudgetService],
  exports: [BudgetService],
})
export class BudgetModule {}
