import 'dotenv/config';
import 'reflect-metadata';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { SEED_ORG_ID } from '../src/auth/org.repository';

const SESSION_COOKIE = 'clickup_sync_sid';

/** Pull a cookie value out of a supertest response's set-cookie header. */
function readSetCookie(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'];
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const re = new RegExp(`${name}=([^;]+)`);
  for (const c of arr) {
    const m = re.exec(c);
    if (m) return m[1];
  }
  return undefined;
}

describe('Auth + RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    prisma = app.get(PrismaService);

    // Clean identity tables but keep the seed org (FK-safe order).
    await prisma.session.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('1. signup claims the org as OWNER and sets a session cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/signup').send({
      email: 'owner@x.com',
      password: 'ownerpass10',
      name: 'Owner',
      orgName: 'Acme Co',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('OWNER');
    expect(res.body.user.email).toBe('owner@x.com');

    const sid = readSetCookie(res, SESSION_COOKIE);
    expect(sid).toBeTruthy();
  });

  it('2. second signup is closed (409)', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/auth/signup').send({
      email: 'second@x.com',
      password: 'secondpass10',
      name: 'Second',
      orgName: 'Other Co',
    });

    expect(res.status).toBe(409);
  });

  it('3. login + me + logout lifecycle', async () => {
    const agent = request.agent(app.getHttpServer());

    const login = await agent.post('/api/auth/login').send({
      email: 'owner@x.com',
      password: 'ownerpass10',
    });
    expect(login.status).toBe(200);
    const csrf = readSetCookie(login, 'csrf');
    expect(csrf).toBeTruthy();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('owner@x.com');

    // logout is a mutating POST, so AuthGuard requires a matching CSRF header.
    const logout = await agent.post('/api/auth/logout').set('x-csrf-token', csrf as string);
    expect(logout.status).toBe(200);

    const meAfter = await agent.get('/api/auth/me');
    expect(meAfter.status).toBe(401);
  });

  describe('RBAC: a MEMBER cannot hit an admin write endpoint', () => {
    let memberAgent: request.Agent;
    let csrf: string | undefined;

    beforeAll(async () => {
      // Seed a MEMBER directly, with a password hash from the app's own scheme.
      const pw = new PasswordService();
      const hash = await pw.hash('memberpass10');
      await prisma.user.create({
        data: {
          email: 'member@x.com',
          passwordHash: hash,
          name: 'M',
          role: 'MEMBER',
          status: 'ACTIVE',
          org: { connect: { id: SEED_ORG_ID } },
        },
      });

      memberAgent = request.agent(app.getHttpServer());
      const login = await memberAgent.post('/api/auth/login').send({
        email: 'member@x.com',
        password: 'memberpass10',
      });
      expect(login.status).toBe(200);
      csrf = readSetCookie(login, 'csrf');
      expect(csrf).toBeTruthy();
    });

    it('4a. the member session works for a GET any role can reach (/api/auth/me)', async () => {
      const me = await memberAgent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe('member@x.com');
      expect(me.body.user.role).toBe('MEMBER');
    });

    it('4b. member POST to admin endpoint (CSRF valid) is rejected on ROLE (403)', async () => {
      const res = await memberAgent
        .post('/api/admin/tasks/sync')
        .set('x-csrf-token', csrf as string)
        .send({ taskId: 'x' });

      expect(res.status).toBe(403);
      // Distinguishes role-gating from CSRF: AuthGuard (incl. CSRF) passed,
      // RolesGuard rejected with this exact message (roles.guard.ts).
      expect(res.body.message).toBe('Insufficient role');
    });

    it('5. member POST without x-csrf-token is rejected on CSRF (403)', async () => {
      const res = await memberAgent.post('/api/admin/tasks/sync').send({ taskId: 'x' });

      expect(res.status).toBe(403);
      // AuthGuard CSRF check fires before RolesGuard (auth.guard.ts).
      expect(res.body.message).toBe('CSRF token mismatch');
    });
  });
});
