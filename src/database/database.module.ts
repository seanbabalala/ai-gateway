import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '../config/config.service';
import { CallLog, BudgetRule, NodeStatus } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'better-sqlite3',
        database: config.database.path || './data/gateway.db',
        entities: [CallLog, BudgetRule, NodeStatus],
        synchronize: true, // Auto-create tables in dev; use migrations in prod
        logging: false,
      }),
    }),
    TypeOrmModule.forFeature([CallLog, BudgetRule, NodeStatus]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
