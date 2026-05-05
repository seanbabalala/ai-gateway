import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '../config/config.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { DashboardGuard } from './dashboard.guard';
import { ApiKeyGuard } from './api-key.guard';
import { RateLimitGuard } from './rate-limit.guard';
import { GatewayApiKeyService } from './gateway-api-key.service';
import { GatewayApiKey } from '../database/entities/gateway-api-key.entity';
import { LocalTeam } from '../database/entities/local-team.entity';
import { BudgetRule } from '../database/entities/budget-rule.entity';
import { CallLog } from '../database/entities/call-log.entity';
import { TeamService } from './team.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([GatewayApiKey, LocalTeam, BudgetRule, CallLog])],
  controllers: [AuthController],
  providers: [AuthService, GatewayApiKeyService, TeamService, DashboardGuard, ApiKeyGuard, RateLimitGuard],
  exports: [AuthService, GatewayApiKeyService, TeamService, DashboardGuard, ApiKeyGuard, RateLimitGuard],
})
export class AuthModule {}
