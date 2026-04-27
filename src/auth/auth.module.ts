import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { DashboardGuard } from './dashboard.guard';
import { ApiKeyGuard } from './api-key.guard';

@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [AuthService, DashboardGuard, ApiKeyGuard],
  exports: [AuthService, DashboardGuard, ApiKeyGuard],
})
export class AuthModule {}
