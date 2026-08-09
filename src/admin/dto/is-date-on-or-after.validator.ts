import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * Cross-field validator for ISO date strings: ensures the decorated
 * property is on or after another property on the same object.
 *
 * Used to reject inverted rate date ranges (`validTo < validFrom`) at the
 * DTO layer with a 400, instead of letting them reach the Postgres
 * `daterange(valid_from, valid_to, '[]')` EXCLUDE constraint, which raises
 * a 500 when `valid_to < valid_from`.
 *
 * Skips (returns true) when the decorated value is undefined/null/'' —
 * an empty `validTo` means open-ended — or when the related property is
 * absent or not a string; other decorators (e.g. `@IsISO8601`) are
 * responsible for type/presence validation.
 */
export function IsDateOnOrAfter(
  property: string,
  options?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDateOnOrAfter',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value === undefined || value === null || value === '') {
            return true;
          }
          if (typeof value !== 'string') {
            return true;
          }
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedPropertyName
          ];
          if (typeof relatedValue !== 'string' || relatedValue === '') {
            return true;
          }
          const date = new Date(value.slice(0, 10));
          const relatedDate = new Date(relatedValue.slice(0, 10));
          return date >= relatedDate;
        },
        defaultMessage(args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          return `${args.property} must be on or after ${relatedPropertyName}`;
        },
      },
    });
  };
}
