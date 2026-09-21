import { xeroErrorDetail, DETAIL_MAX_LEN } from './xero-errors';

const AXIOS_FALLBACK = 'Request failed with status code 403';

describe('xeroErrorDetail', () => {
  it('prefers Message, the shape most Xero accounting errors use', () => {
    expect(xeroErrorDetail({ Message: 'The requested resource was not found' }, AXIOS_FALLBACK)).toBe(
      'The requested resource was not found',
    );
  });

  it('falls through Detail and Title for problem-style bodies', () => {
    expect(xeroErrorDetail({ Type: null, Title: 'Forbidden', Status: 403 }, AXIOS_FALLBACK)).toBe('Forbidden');
    expect(xeroErrorDetail({ Title: 'Forbidden', Detail: 'Token has expired' }, AXIOS_FALLBACK)).toBe('Token has expired');
  });

  it('reads a bare string body — the shape that hid the September 2026 outage', () => {
    // Xero answers a rejected tenant with plain text and no JSON at all, so
    // reading only `data.Message` logged axios's own useless sentence instead.
    expect(xeroErrorDetail('AuthenticationUnsuccessful', AXIOS_FALLBACK)).toBe('AuthenticationUnsuccessful');
  });

  it('falls back to the axios message when the body says nothing', () => {
    expect(xeroErrorDetail(undefined, AXIOS_FALLBACK)).toBe(AXIOS_FALLBACK);
    expect(xeroErrorDetail({}, AXIOS_FALLBACK)).toBe(AXIOS_FALLBACK);
    expect(xeroErrorDetail({ Message: '   ' }, AXIOS_FALLBACK)).toBe(AXIOS_FALLBACK);
  });

  it('ignores a binary body rather than spraying bytes into the logs', () => {
    // An attachment request sets responseType:'arraybuffer', so a failed one
    // hands back raw bytes.
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    expect(xeroErrorDetail(binary, AXIOS_FALLBACK)).toBe(AXIOS_FALLBACK);
  });

  it('still reads a text body that arrived as a Buffer', () => {
    expect(xeroErrorDetail(Buffer.from('AuthenticationUnsuccessful', 'utf8'), AXIOS_FALLBACK)).toBe(
      'AuthenticationUnsuccessful',
    );
  });

  it('strips HTML so a gateway error page does not become a log line', () => {
    const html = '<html><head><style>b{color:red}</style></head><body><h1>502 Bad Gateway</h1></body></html>';
    expect(xeroErrorDetail(html, 'network')).toBe('502 Bad Gateway');
  });

  it('collapses whitespace and truncates to the detail budget', () => {
    expect(xeroErrorDetail({ Message: 'line one\n\n   line two' }, '')).toBe('line one line two');
    const long = 'x'.repeat(DETAIL_MAX_LEN + 50);
    expect(xeroErrorDetail({ Message: long }, '')).toHaveLength(DETAIL_MAX_LEN);
  });

  it('returns an empty string when there is neither body nor fallback', () => {
    expect(xeroErrorDetail(null, '')).toBe('');
  });
});
