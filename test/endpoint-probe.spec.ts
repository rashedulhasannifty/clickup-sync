import { EndpointProbe } from '../src/clickup/endpoint-probe';

describe('EndpointProbe', () => {
  const probe = new EndpointProbe();
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns true for a <500 response (e.g. 405 from the POST-only route)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 405 }) as any;
    await expect(probe.probe('https://app.example.com/webhooks/clickup')).resolves.toBe(true);
  });

  it('returns false for a 5xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 503 }) as any;
    await expect(probe.probe('https://app.example.com/webhooks/clickup')).resolves.toBe(false);
  });

  it('returns false when fetch throws (network error / DNS / timeout)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    await expect(probe.probe('https://app.example.com/webhooks/clickup')).resolves.toBe(false);
  });

  it('issues a GET request to the given url', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 404 });
    global.fetch = fetchMock as any;
    await probe.probe('https://app.example.com/webhooks/clickup');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/webhooks/clickup',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
