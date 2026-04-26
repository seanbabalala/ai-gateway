import { Module } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}
