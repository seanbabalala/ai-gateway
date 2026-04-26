import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BudgetService } from './budget.service';
import { BudgetRule } from '../database/entities/budget-rule.entity';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([BudgetRule])],
  providers: [BudgetService],
  exports: [BudgetService],
})
export class BudgetModule {}
