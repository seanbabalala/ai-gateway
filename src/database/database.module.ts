import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '../config/config.service';
import {
  BudgetRule,
  CallLog,
  ConfigAuditEvent,
  ConfigVersion,
  GatewayApiKey,
  NodeStatus,
  ProviderCompatibilityResult,
  RouteDecisionLog,
  ShadowTrafficResult,
  BatchJob,
  VideoJob,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const shared = {
          entities: [
            CallLog,
            ConfigAuditEvent,
            ConfigVersion,
            BudgetRule,
            NodeStatus,
            GatewayApiKey,
            ShadowTrafficResult,
            RouteDecisionLog,
            ProviderCompatibilityResult,
            BatchJob,
            VideoJob,
          ],
          // Default remains true for the OSS single-node SQLite/dev path.
          // Production PostgreSQL deployments should set database.synchronize=false.
          synchronize: config.database.synchronize ?? true,
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
    TypeOrmModule.forFeature([
      CallLog,
      ConfigAuditEvent,
      ConfigVersion,
      BudgetRule,
      NodeStatus,
      ShadowTrafficResult,
      RouteDecisionLog,
      ProviderCompatibilityResult,
      BatchJob,
      VideoJob,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
