import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../cache/cache.module';
import { ConfigModule } from '../config/config.module';
import { CallLog, PromptTemplate, RouteDecisionLog } from '../database/entities';
import { SemanticPlatformDashboardController } from './semantic-platform-dashboard.controller';
import { SemanticPlatformService } from './semantic-platform.service';

@Global()
@Module({
  imports: [
    AuthModule,
    CacheModule,
    ConfigModule,
    TypeOrmModule.forFeature([PromptTemplate, CallLog, RouteDecisionLog]),
  ],
  controllers: [SemanticPlatformDashboardController],
  providers: [SemanticPlatformService],
  exports: [SemanticPlatformService],
})
export class SemanticPlatformModule {}
