import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BackfillDto } from '../src/admin/dto/backfill.dto';

async function errorsFor(payload: Record<string, unknown>) {
  const dto = plainToInstance(BackfillDto, payload);
  return validate(dto);
}

describe('BackfillDto.lookbackDays — multi-year cap', () => {
  it('accepts a 3-year (1095 day) lookback', async () => {
    const errors = await errorsFor({ spaceId: '3577824', lookbackDays: 1095 });
    expect(errors).toHaveLength(0);
  });

  it('accepts a 2-year (730 day) lookback', async () => {
    const errors = await errorsFor({ spaceId: '3577824', lookbackDays: 730 });
    expect(errors).toHaveLength(0);
  });

  it('rejects a lookback beyond the 1095-day ceiling', async () => {
    const errors = await errorsFor({ spaceId: '3577824', lookbackDays: 1096 });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('max');
  });

  it('still rejects a zero/negative lookback', async () => {
    const errors = await errorsFor({ spaceId: '3577824', lookbackDays: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('min');
  });
});
