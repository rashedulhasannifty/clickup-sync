import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetAssigneeChargeableDto } from './set-assignee-chargeable.dto';

function basePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'u1',
    chargeable: true,
    ...overrides,
  };
}

describe('SetAssigneeChargeableDto', () => {
  it('accepts chargeable: true', async () => {
    const dto = plainToInstance(SetAssigneeChargeableDto, basePayload({ chargeable: true }));
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'chargeable')).toBeUndefined();
  });

  it('accepts chargeable: false', async () => {
    const dto = plainToInstance(SetAssigneeChargeableDto, basePayload({ chargeable: false }));
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'chargeable')).toBeUndefined();
  });

  it('accepts chargeable: null (clears the rule)', async () => {
    const dto = plainToInstance(SetAssigneeChargeableDto, basePayload({ chargeable: null }));
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'chargeable')).toBeUndefined();
  });

  it('rejects a non-boolean, non-null chargeable value', async () => {
    const dto = plainToInstance(SetAssigneeChargeableDto, basePayload({ chargeable: 'true' }));
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'chargeable')).toBeDefined();
  });

  // `@IsOptional()` would also accept a wholly omitted field (it skips validation
  // for undefined, not just null). `chargeable` is required — only `null` is a
  // valid way to opt out — so an omitted field must be rejected.
  it('rejects an omitted chargeable field', async () => {
    const dto = plainToInstance(SetAssigneeChargeableDto, { userId: 'u1' });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'chargeable')).toBeDefined();
  });

  it('accepts an omitted note (optional)', async () => {
    const dto = plainToInstance(SetAssigneeChargeableDto, basePayload());
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'note')).toBeUndefined();
  });

  it('rejects a note over 500 characters', async () => {
    const dto = plainToInstance(SetAssigneeChargeableDto, basePayload({ note: 'x'.repeat(501) }));
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'note')).toBeDefined();
  });
});
