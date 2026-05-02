import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { RealtimeProxyService } from './realtime-proxy.service';

@Global()
@Module({
  imports: [ConfigModule, AuthModule],
  providers: [RealtimeProxyService],
  exports: [RealtimeProxyService],
})
export class RealtimeModule {}
