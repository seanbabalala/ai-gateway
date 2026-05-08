import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '../config/config.service';
import { CallLogSchemaPatchService } from './call-log-schema-patch.service';
import { WorkspaceSchemaPatchService } from './workspace-schema-patch.service';
import {
  BudgetRule,
  CallLog,
  ConfigAuditEvent,
  ConfigVersion,
  AgentProfile,
  GatewayApiKey,
  LocalTeam,
  NodeStatus,
  Organization,
  ProviderCompatibilityResult,
  RouteDecisionLog,
  ShadowTrafficResult,
  BatchJob,
  EvalDataset,
  EvalExperimentRun,
  EvalSampleResult,
  VideoJob,
  Workspace,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const shared = {
          entities: [
            CallLog,
            Organization,
            Workspace,
            ConfigAuditEvent,
            ConfigVersion,
            BudgetRule,
            NodeStatus,
            AgentProfile,
            GatewayApiKey,
            LocalTeam,
            ShadowTrafficResult,
            RouteDecisionLog,
            ProviderCompatibilityResult,
            BatchJob,
            EvalDataset,
            EvalExperimentRun,
            EvalSampleResult,
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
      Organization,
      Workspace,
      ConfigAuditEvent,
      ConfigVersion,
      BudgetRule,
      NodeStatus,
      AgentProfile,
      GatewayApiKey,
      LocalTeam,
      ShadowTrafficResult,
      RouteDecisionLog,
      ProviderCompatibilityResult,
      BatchJob,
      EvalDataset,
      EvalExperimentRun,
      EvalSampleResult,
      VideoJob,
    ]),
  ],
  providers: [CallLogSchemaPatchService, WorkspaceSchemaPatchService],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
