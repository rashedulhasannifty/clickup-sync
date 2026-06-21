import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BackfillDto } from '../src/admin/dto/backfill.dto';

async function errorsFor(payload: Record<string, unknown>) {
  const dto = plainToInstance(BackfillDto, payload);
  return validate(dto);
}

describe('BackfillDto.lookbackDays — hard backstop', () => {
  // The DTO only enforces the absolute 3650-day (10y) backstop; the actual
  // user-configurable cap is enforced at runtime in the controller against
  // SettingsService.getBackfillMaxLookbackDays().
  it('accepts a 3-year (1095 day) lookback', async () => {
    const errors = await errorsFor({ spaceId: '3577824', lookbackDays: 1095 });
    expect(errors).toHaveLength(0);
  });

  it('accepts a value above 1095 but within the backstop (the controller enforces the configured cap)', async () => {
    const errors = await errorsFor({ spaceId: '3577824', lookbackDays: 1825 });
    expect(errors).toHaveLength(0);
  });

  it('accepts the 3650-day backstop exactly', async () => {
    const errors = await errorsFor({ spaceId: '3577824', lookbackDays: 3650 });
    expect(errors).toHaveLength(0);
  });

  it('rejects a lookback beyond the 3650-day backstop', async () => {
    const errors = await errorsFor({ spaceId: '3577824', lookbackDays: 3651 });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('still rejects a zero/negative lookback', async () => {
    const errors = await errorsFor({ spaceId: '3577824', lookbackDays: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('min');
  });
});
