import { Module } from '@nestjs/common';
import { ChatCompletionsController } from './chat-completions.controller';
import { ResponsesController } from './responses.controller';
import { MessagesController } from './messages.controller';
import { ModelsController } from './models.controller';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [PipelineModule, ConfigModule],
  controllers: [
    ChatCompletionsController,
    ResponsesController,
    MessagesController,
    ModelsController,
  ],
})
export class IngestModule {}
