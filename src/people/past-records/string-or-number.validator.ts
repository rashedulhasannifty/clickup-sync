import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * A spreadsheet cell: a string of at most `maxLength` characters or a finite
 * number. Anything else (objects, arrays, booleans) is refused, so the loose
 * row DTO still cannot smuggle structures into the normalizer.
 */
export function IsStringOrNumber(
  maxLength: number,
  options?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isStringOrNumber',
      target: target.constructor,
      propertyName: String(propertyName),
      options: {
        message: `${String(propertyName)} must be text (at most ${maxLength} characters) or a number`,
        ...options,
      },
      validator: {
        validate: (v: unknown) =>
          (typeof v === 'string' && v.length <= maxLength) ||
          (typeof v === 'number' && Number.isFinite(v)),
      },
    });
  };
}
