import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBusService } from '../plugins/event-bus.service';
import { ConfigService } from './config.service';

@Injectable()
export class ConfigEventBridgeService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.config.setEventBus(this.eventBus);
  }
}
