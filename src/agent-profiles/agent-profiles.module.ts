import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '../config/config.module';
import { AgentProfile } from '../database/entities/agent-profile.entity';
import { AgentProfileService } from './agent-profile.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    TypeOrmModule.forFeature([AgentProfile]),
  ],
  providers: [AgentProfileService],
  exports: [AgentProfileService],
})
export class AgentProfilesModule {}
