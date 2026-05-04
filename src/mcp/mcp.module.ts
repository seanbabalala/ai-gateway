import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ConfigModule } from '../config/config.module'
import { McpGatewayController } from './mcp-gateway.controller'
import { McpGatewayService } from './mcp-gateway.service'

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [McpGatewayController],
  providers: [McpGatewayService],
  exports: [McpGatewayService],
})
export class McpModule {}
