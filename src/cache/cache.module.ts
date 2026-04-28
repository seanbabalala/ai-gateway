import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PromptCacheService } from './prompt-cache.service';

@Module({
  imports: [ConfigModule],
  providers: [PromptCacheService],
  exports: [PromptCacheService],
})
export class CacheModule {}
