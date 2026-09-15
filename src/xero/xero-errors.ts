/** The stored connection can't be used: never connected, disconnected, or refresh rejected. Don't retry. */
export class XeroReconnectRequiredError extends Error {
  constructor(message = 'Xero needs to be reconnected') {
    super(message);
    this.name = 'XeroReconnectRequiredError';
  }
}

/** identity.xero.com answered `invalid_grant`: the refresh token is revoked or expired. */
export class XeroInvalidGrantError extends Error {
  constructor(message = 'invalid_grant') {
    super(message);
    this.name = 'XeroInvalidGrantError';
  }
}

/** Fewer than DAY_BUDGET_FLOOR calls remain today. The run stops cleanly and the next one resumes. */
export class XeroRateBudgetExhaustedError extends Error {
  constructor(public readonly remaining: number) {
    super(`Xero daily call budget nearly exhausted (${remaining} left)`);
    this.name = 'XeroRateBudgetExhaustedError';
  }
}
