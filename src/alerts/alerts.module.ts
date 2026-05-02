import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { AlertService } from './alert.service';
import { AlertsController } from './alerts.controller';

@Global()
@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [AlertsController],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertsModule {}
