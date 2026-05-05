import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import {
  CallLog,
  EvalDataset,
  EvalExperimentRun,
  EvalSampleResult,
} from '../database/entities';
import { PipelineModule } from '../pipeline/pipeline.module';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    PipelineModule,
    TypeOrmModule.forFeature([
      CallLog,
      EvalDataset,
      EvalExperimentRun,
      EvalSampleResult,
    ]),
  ],
  controllers: [EvaluationController],
  providers: [EvaluationService],
  exports: [EvaluationService],
})
export class EvaluationModule {}
