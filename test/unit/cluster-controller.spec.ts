import { NotFoundException } from '@nestjs/common';
import { ClusterController } from '../../src/cluster/cluster.controller';

describe('ClusterController', () => {
  it('returns cluster status when cluster mode is enabled', async () => {
    const status = {
      enabled: true,
      mode: 'redis_pubsub',
      leader_election: false,
      instances: [],
      instance_count: 0,
    };
    const service = {
      isEnabled: jest.fn().mockReturnValue(true),
      getStatus: jest.fn().mockResolvedValue(status),
    };
    const controller = new ClusterController(service as any);

    await expect(controller.status()).resolves.toBe(status);
    expect(service.getStatus).toHaveBeenCalled();
  });

  it('returns 404 when cluster mode is disabled', async () => {
    const service = {
      isEnabled: jest.fn().mockReturnValue(false),
      getStatus: jest.fn(),
    };
    const controller = new ClusterController(service as any);

    await expect(controller.status()).rejects.toBeInstanceOf(NotFoundException);
    expect(service.getStatus).not.toHaveBeenCalled();
  });
});
