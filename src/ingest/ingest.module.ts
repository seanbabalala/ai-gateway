import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatCompletionsController } from './chat-completions.controller';
import { ResponsesController } from './responses.controller';
import { MessagesController } from './messages.controller';
import { ModelsController } from './models.controller';
import { EmbeddingsController } from './embeddings.controller';
import { RerankController } from './rerank.controller';
import { MediaController } from './media.controller';
import { VideoController } from './video.controller';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ConfigModule } from '../config/config.module';
import { AuthModule } from '../auth/auth.module';
import { VideoJob } from '../database/entities';

@Module({
  imports: [PipelineModule, ConfigModule, AuthModule, TypeOrmModule.forFeature([VideoJob])],
  controllers: [
    ChatCompletionsController,
    ResponsesController,
    MessagesController,
    EmbeddingsController,
    RerankController,
    MediaController,
    VideoController,
    ModelsController,
  ],
})
export class IngestModule {}
