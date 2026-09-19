import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PasswordResetRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.PasswordResetUncheckedCreateInput) {
    return this.prisma.passwordReset.create({ data });
  }

  findByTokenHash(tokenHash: string) {
    return this.prisma.passwordReset.findUnique({ where: { tokenHash }, include: { user: true } });
  }

  markUsed(id: string) {
    return this.prisma.passwordReset.update({ where: { id }, data: { usedAt: new Date() } });
  }

  /** Drop every unused link for a user, so only the newest email ever works. */
  deleteActiveForUser(userId: string) {
    return this.prisma.passwordReset.deleteMany({ where: { userId, usedAt: null } });
  }
}
