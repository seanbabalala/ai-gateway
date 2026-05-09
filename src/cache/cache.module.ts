import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { StateModule } from '../state/state.module';
import { PromptCacheService } from './prompt-cache.service';

@Module({
  imports: [ConfigModule, StateModule],
  providers: [PromptCacheService],
  exports: [PromptCacheService],
})
export class CacheModule {}
