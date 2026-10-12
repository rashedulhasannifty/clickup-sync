import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddClearanceItemDto, UpdateClearanceItemDto } from './exit.dto';

const fieldsWithErrors = async <T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
) =>
  (await validate(plainToInstance(cls, payload))).map((e) => e.property);

describe('AddClearanceItemDto', () => {
  it('accepts a label with no group (the service defaults to PROCESS) or either group', async () => {
    expect(await fieldsWithErrors(AddClearanceItemDto, { label: 'Badge' })).toEqual([]);
    expect(
      await fieldsWithErrors(AddClearanceItemDto, { label: 'Badge', group: 'ASSETS' }),
    ).toEqual([]);
    expect(
      await fieldsWithErrors(AddClearanceItemDto, { label: 'Call', group: 'PROCESS' }),
    ).toEqual([]);
  });

  it('rejects an unknown group', async () => {
    expect(
      await fieldsWithErrors(AddClearanceItemDto, { label: 'Badge', group: 'assets' }),
    ).toEqual(['group']);
  });
});

describe('UpdateClearanceItemDto', () => {
  it('accepts notApplicable as a boolean', async () => {
    expect(await fieldsWithErrors(UpdateClearanceItemDto, { notApplicable: true })).toEqual([]);
    expect(await fieldsWithErrors(UpdateClearanceItemDto, { notApplicable: false })).toEqual([]);
  });

  it('rejects a non-boolean notApplicable', async () => {
    expect(await fieldsWithErrors(UpdateClearanceItemDto, { notApplicable: 'yes' })).toEqual([
      'notApplicable',
    ]);
    expect(await fieldsWithErrors(UpdateClearanceItemDto, { notApplicable: 1 })).toEqual([
      'notApplicable',
    ]);
  });
});
