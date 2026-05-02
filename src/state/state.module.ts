import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { StateBackendService } from './state-backend.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [StateBackendService],
  exports: [StateBackendService],
})
export class StateModule {}
