import { MomentumService } from '../../src/routing/momentum.service';

describe('MomentumService — shared state backend', () => {
  it('should write session tier assignments to shared sorted state', () => {
    const state = {
      isRedisConfigured: jest.fn().mockReturnValue(true),
      addSortedJson: jest.fn().mockResolvedValue(undefined),
      getSortedJson: jest.fn().mockResolvedValue([]),
    };
    const momentum = new MomentumService(state as any);

    momentum.apply('simple', 0.1, 'session-1');

    expect(state.addSortedJson).toHaveBeenCalledWith(
      'momentum',
      'session-1',
      expect.objectContaining({ tier: 'simple', timestamp: expect.any(Number) }),
      expect.any(Number),
      10,
      30 * 60 * 1000,
    );
    momentum.onModuleDestroy();
  });
});
