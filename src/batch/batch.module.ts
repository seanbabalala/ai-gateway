import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BudgetModule } from '../budget/budget.module';
import { ConfigModule } from '../config/config.module';
import { CallLog, BatchJob } from '../database/entities';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { BatchApiProxyService } from './batch-api-proxy.service';
import { BatchController } from './batch.controller';
import { BatchJobStoreService } from './batch-job-store.service';
import { BatchProviderAdapterService } from './batch-provider-adapter.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    BudgetModule,
    TelemetryModule,
    TypeOrmModule.forFeature([BatchJob, CallLog]),
  ],
  controllers: [BatchController],
  providers: [
    BatchApiProxyService,
    BatchJobStoreService,
    BatchProviderAdapterService,
  ],
  exports: [BatchJobStoreService],
})
export class BatchModule {}
