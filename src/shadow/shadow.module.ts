import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '../config/config.module';
import { ProvidersModule } from '../providers/providers.module';
import { ShadowTrafficResult } from '../database/entities/shadow-traffic-result.entity';
import { ShadowTrafficService } from './shadow-traffic.service';

@Module({
  imports: [
    ConfigModule,
    ProvidersModule,
    TypeOrmModule.forFeature([ShadowTrafficResult]),
  ],
  providers: [ShadowTrafficService],
  exports: [ShadowTrafficService],
})
export class ShadowModule {}
