import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetClickupUserDto } from './set-clickup-user.dto';

describe('SetClickupUserDto', () => {
  it('rejects a missing clickupUserId ({} would otherwise silently clear the link)', async () => {
    const dto = plainToInstance(SetClickupUserDto, {});
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'clickupUserId')).toBeDefined();
  });

  it('rejects an empty string (would be stored as an identity on the @unique column)', async () => {
    const dto = plainToInstance(SetClickupUserDto, { clickupUserId: '' });
    const errors = await validate(dto);
    expect(errors.find((e) => e.property === 'clickupUserId')).toBeDefined();
  });

  it('accepts an explicit null — clears the link', async () => {
    const dto = plainToInstance(SetClickupUserDto, { clickupUserId: null });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts a non-empty string', async () => {
    const dto = plainToInstance(SetClickupUserDto, { clickupUserId: 'cu1' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
