import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '../config/config.service';
import { CallLog, BudgetRule, NodeStatus } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const shared = {
          entities: [CallLog, BudgetRule, NodeStatus],
          synchronize: true, // Auto-create tables in dev; use migrations in prod
          logging: false,
        };

        if (config.database.type === 'postgres') {
          return {
            type: 'postgres' as const,
            url: config.database.url,
            ...shared,
          };
        }

        return {
          type: 'better-sqlite3' as const,
          database: config.database.path || './data/gateway.db',
          ...shared,
        };
      },
    }),
    TypeOrmModule.forFeature([CallLog, BudgetRule, NodeStatus]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
