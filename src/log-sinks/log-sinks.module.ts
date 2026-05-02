import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { LogSinkService } from './log-sink.service';

@Module({
  imports: [ConfigModule],
  providers: [LogSinkService],
  exports: [LogSinkService],
})
export class LogSinksModule {}
