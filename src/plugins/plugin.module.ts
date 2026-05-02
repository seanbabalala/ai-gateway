// ===================================================================
// PluginModule — Global NestJS module for the plugin system
// ===================================================================

import { Global, Module } from '@nestjs/common';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginLoaderService } from './plugin-loader.service';
import { HookExecutorService } from './hook-executor.service';
import { EventBusService } from './event-bus.service';
import { ConfigEventBridgeService } from '../config/config-event-bridge.service';

@Global()
@Module({
  providers: [
    PluginRegistryService,
    PluginLoaderService,
    HookExecutorService,
    EventBusService,
    ConfigEventBridgeService,
  ],
  exports: [
    PluginRegistryService,
    HookExecutorService,
    EventBusService,
  ],
})
export class PluginModule {}
