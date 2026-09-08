import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateNodeDto, UpdateNodeDto } from '../../src/dashboard/dto/node.dto';

describe('node credential DTO validation', () => {
  it.each([undefined, '', '   ', 'replacement-key'])(
    'accepts an update credential whose api_key is %p for controller-side resolution',
    (apiKey) => {
      const dto = plainToInstance(UpdateNodeDto, {
        models: ['claude-kr-claude-opus-5[1M]', 'claude-kr-claude-sonnet-5[1M]'],
        credentials: [{ id: 'primary', api_key: apiKey, weight: 1, enabled: true }],
      });

      expect(validateSync(dto, { whitelist: true })).toEqual([]);
      expect(dto.models).toEqual([
        'claude-kr-claude-opus-5[1M]',
        'claude-kr-claude-sonnet-5[1M]',
      ]);
    },
  );

  it.each([123, false, {}, []])('rejects non-string update secrets (%p)', (apiKey) => {
    const dto = plainToInstance(UpdateNodeDto, {
      credentials: [{ id: 'primary', api_key: apiKey }],
    });

    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it.each([undefined, ''])('still requires a secret on node creation (%p)', (apiKey) => {
    const dto = plainToInstance(CreateNodeDto, {
      id: 'new-provider',
      name: 'New Provider',
      protocol: 'messages',
      base_url: 'https://provider.example',
      endpoint: '/v1/messages',
      models: ['test-model'],
      timeout_ms: 30000,
      credentials: [{ id: 'primary', api_key: apiKey }],
    });

    expect(validateSync(dto).some((error) => error.property === 'credentials')).toBe(true);
  });

  it('continues validating update credential metadata', () => {
    const dto = plainToInstance(UpdateNodeDto, {
      credentials: [{ id: '', weight: 0, enabled: 'yes' }],
    });

    const errors = validateSync(dto);
    const fields = errors[0].children?.[0].children?.map((error) => error.property);
    expect(fields).toEqual(expect.arrayContaining(['id', 'weight', 'enabled']));
  });
});
