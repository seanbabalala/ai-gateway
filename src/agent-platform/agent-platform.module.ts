import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentProfilesModule } from '../agent-profiles/agent-profiles.module';
import { AuthModule } from '../auth/auth.module';
import { CallLog } from '../database/entities/call-log.entity';
import { McpModule } from '../mcp/mcp.module';
import { AgentPlatformService } from './agent-platform.service';

@Module({
  imports: [
    AgentProfilesModule,
    AuthModule,
    McpModule,
    TypeOrmModule.forFeature([CallLog]),
  ],
  providers: [AgentPlatformService],
  exports: [AgentPlatformService],
})
export class AgentPlatformModule {}
