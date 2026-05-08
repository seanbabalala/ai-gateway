import { Module } from '@nestjs/common';
import {
  CLUSTER_REDIS_CLIENT_FACTORY,
  ClusterRedisRuntimeConfig,
  ClusterService,
} from './cluster.service';
import { ClusterController } from './cluster.controller';
import { RespClusterRedisClient } from './redis-cluster.client';
import { StateModule } from '../state/state.module';

@Module({
  imports: [StateModule],
  controllers: [ClusterController],
  providers: [
    ClusterService,
    {
      provide: CLUSTER_REDIS_CLIENT_FACTORY,
      useValue: (config: ClusterRedisRuntimeConfig) =>
        new RespClusterRedisClient({ url: config.url }),
    },
  ],
  exports: [ClusterService],
})
export class ClusterModule {}
