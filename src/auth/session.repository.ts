import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { userId: string; tokenHash: string; expiresAt: Date; ip?: string | null; userAgent?: string | null }) {
    return this.prisma.session.create({ data });
  }

  findByTokenHash(tokenHash: string) {
    return this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  }

  touch(id: string) {
    return this.prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  deleteByTokenHash(tokenHash: string) {
    return this.prisma.session.deleteMany({ where: { tokenHash } });
  }

  deleteAllForUser(userId: string) {
    return this.prisma.session.deleteMany({ where: { userId } });
  }

  deleteExpired(now = new Date()) {
    return this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  }
}
