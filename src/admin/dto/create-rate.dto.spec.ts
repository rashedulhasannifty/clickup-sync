import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRateDto } from './create-rate.dto';

function basePayload(overrides: Partial<CreateRateDto> = {}) {
  return {
    assigneeId: 'user-1',
    currency: 'USD',
    hourlyRateCents: 15000,
    validFrom: '2026-06-01',
    ...overrides,
  };
}

describe('CreateRateDto', () => {
  it('rejects an inverted date range (validTo before validFrom)', async () => {
    const dto = plainToInstance(
      CreateRateDto,
      basePayload({ validTo: '2026-05-01' }),
    );
    const errors = await validate(dto);
    const validToError = errors.find((e) => e.property === 'validTo');
    expect(validToError).toBeDefined();
  });

  it('accepts a valid range (validTo on or after validFrom)', async () => {
    const dto = plainToInstance(
      CreateRateDto,
      basePayload({ validTo: '2026-12-31' }),
    );
    const errors = await validate(dto);
    const validToError = errors.find((e) => e.property === 'validTo');
    expect(validToError).toBeUndefined();
  });

  it('accepts an omitted validTo (open-ended)', async () => {
    const dto = plainToInstance(CreateRateDto, basePayload());
    const errors = await validate(dto);
    const validToError = errors.find((e) => e.property === 'validTo');
    expect(validToError).toBeUndefined();
  });
});
