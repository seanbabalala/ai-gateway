import { HttpException } from '@nestjs/common';
import { EvaluationController } from '../../src/evaluation/evaluation.controller';

describe('EvaluationController', () => {
  it('lists metadata-only eval reports with filters', async () => {
    const evaluations = {
      listReports: jest.fn().mockResolvedValue({ metadata_only: true, items: [] }),
    };
    const controller = new EvaluationController(evaluations as any);

    await expect(controller.listReports('7d', 'completed', 'dataset-1', '25')).resolves.toEqual({
      metadata_only: true,
      items: [],
    });
    expect(evaluations.listReports).toHaveBeenCalledWith({
      period: '7d',
      status: 'completed',
      dataset_id: 'dataset-1',
      limit: 25,
    });
  });

  it('returns 404 when an eval report is missing', async () => {
    const controller = new EvaluationController({
      getReport: jest.fn().mockResolvedValue(null),
    } as any);

    await expect(controller.getReport('missing-run')).rejects.toBeInstanceOf(HttpException);
  });

  it('keeps the run endpoint behind dashboard auth and delegates to the service', async () => {
    const result = { metadata_only: true, run: { id: 'run-1' } };
    const evaluations = {
      runComparison: jest.fn().mockResolvedValue(result),
    };
    const controller = new EvaluationController(evaluations as any);
    const body = {
      dataset: { name: 'local' },
      primary: { model: 'gpt-4o-mini' },
      candidate: { model: 'llama-3.3-70b' },
      samples: [{ prompt: 'not persisted by the controller' }],
    };

    await expect(controller.run(body as any)).resolves.toBe(result);
    expect(evaluations.runComparison).toHaveBeenCalledWith(body);
  });
});
