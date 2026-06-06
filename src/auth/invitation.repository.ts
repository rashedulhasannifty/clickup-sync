import { Injectable } from '@nestjs/common';
import { InvitationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.InvitationUncheckedCreateInput) {
    return this.prisma.invitation.create({ data });
  }

  findById(id: string) {
    return this.prisma.invitation.findUnique({ where: { id } });
  }

  findByTokenHash(tokenHash: string) {
    return this.prisma.invitation.findUnique({ where: { tokenHash }, include: { org: true } });
  }

  findPendingByEmail(orgId: string, email: string) {
    return this.prisma.invitation.findFirst({
      where: { orgId, email: email.toLowerCase(), status: InvitationStatus.PENDING },
    });
  }

  listByOrg(orgId: string, status?: InvitationStatus) {
    return this.prisma.invitation.findMany({
      where: { orgId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, data: Prisma.InvitationUpdateInput) {
    return this.prisma.invitation.update({ where: { id }, data });
  }
}
