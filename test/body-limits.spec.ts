import { Body, Controller, HttpCode, INestApplication, Module, Post, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { applyBodyLimits } from '../src/config/body-limits';

@Controller()
class EchoController {
  @Post('people/past-records/preview')
  @HttpCode(200)
  preview(@Body() body: { rows: unknown[] }) {
    return { rows: body.rows.length };
  }

  @Post('people/employees')
  @HttpCode(200)
  other(@Body() body: { rows?: unknown[] }, @Req() req: { rawBody?: Buffer }) {
    // The webhook signature check needs the raw bytes on every other route.
    return { rows: body.rows?.length ?? 0, raw: Buffer.isBuffer(req.rawBody) };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

/** The import routes take a 2,000-row body; every other route keeps the 100kb default. */
describe('applyBodyLimits', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // As in main.ts: rawBody on, the global prefix, the limits before init.
    app = await NestFactory.create(EchoModule, { rawBody: true, logger: false });
    app.setGlobalPrefix('api');
    applyBodyLimits(app);
    await app.init();
  });
  afterAll(() => app?.close());

  const rows = Array.from({ length: 2000 }, (_, i) => ({
    row: i + 2,
    employee: `someone.with.a.long.name.${i}@example-company.test`,
    record: 'Appraisal',
    date: '2024-01-15',
    appraisalType: 'Half-yearly',
    actions: 'Increment, Promotion',
    outcome: 'Confirmed with an increment and a new designation',
    notes: 'Entered from the paper file kept by HR',
  }));

  it('accepts a 2,000-row import well past 100kb', async () => {
    expect(JSON.stringify({ rows }).length).toBeGreaterThan(300_000);
    const res = await request(app.getHttpServer()).post('/api/people/past-records/preview').send({ rows });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rows: 2000 });
  });

  it('keeps the default limit everywhere else', async () => {
    // Refused by the default 100kb parser. The server may stop reading before the client has
    // finished writing (EPIPE / reset): that is a refusal too.
    const status = await request(app.getHttpServer())
      .post('/api/people/employees')
      .send({ rows: rows.slice(0, 600) })
      .then(
        (r) => r.status,
        (e: { code?: string }) => (e.code === 'EPIPE' || e.code === 'ECONNRESET' ? 413 : Promise.reject(e)),
      );
    expect(status).toBeGreaterThanOrEqual(400);
    const small = await request(app.getHttpServer()).post('/api/people/employees').send({ rows: rows.slice(0, 2) });
    // Nest's own parser still runs for every other route (it skips mounting one when a
    // middleware named `jsonParser` is already there; see applyBodyLimits).
    expect(small.body).toEqual({ rows: 2, raw: true });
  });
});
