import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ConfigModule } from '../config/config.module';
import {
  CallLog,
  RouteDecisionLog,
  RouteFeedback,
} from '../database/entities';
import { CostPlatformDashboardController } from './cost-platform-dashboard.controller';
import { CostPlatformFeedbackController } from './cost-platform-feedback.controller';
import { CostPlatformService } from './cost-platform.service';

@Module({
  imports: [
    AuthModule,
    CatalogModule,
    ConfigModule,
    TypeOrmModule.forFeature([CallLog, RouteDecisionLog, RouteFeedback]),
  ],
  controllers: [CostPlatformDashboardController, CostPlatformFeedbackController],
  providers: [CostPlatformService],
  exports: [CostPlatformService],
})
export class CostPlatformModule {}
