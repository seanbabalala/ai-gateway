import { Controller, Get, NotFoundException } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClusterService } from './cluster.service';

@Controller('cluster')
@ApiTags('Cluster')
export class ClusterController {
  constructor(private readonly cluster: ClusterService) {}

  @Get('status')
  @ApiOperation({
    summary:
      'Multi-instance cluster status when Redis-backed cluster mode is enabled',
  })
  @ApiOkResponse({
    description:
      'Cluster instance inventory, local heartbeat, and Redis Pub/Sub status.',
  })
  @ApiNotFoundResponse({
    description:
      'Cluster mode is disabled for this single-instance data plane.',
  })
  async status() {
    if (!this.cluster.isEnabled()) {
      throw new NotFoundException('Cluster mode is disabled.');
    }
    return this.cluster.getStatus();
  }
}
