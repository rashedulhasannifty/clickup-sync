import { Injectable } from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  // `teamMemberships` is included so UsersService.list() can surface each user's
  // teams (id, name, role) — the Users page team picker/chips (Task 18).
  // `passwordHash` is a credential, never fit for GET /users.
  listByOrg(orgId: string) {
    return this.prisma.user.findMany({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
      include: { teamMemberships: { include: { team: { select: { id: true, name: true } } } } },
      omit: { passwordHash: true },
    });
  }

  countOwners(orgId: string) {
    return this.prisma.user.count({ where: { orgId, role: Role.OWNER, status: UserStatus.ACTIVE } });
  }

  create(data: Prisma.UserCreateInput) {
    return this.prisma.user.create({ data });
  }

  update(id: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }

  touchLogin(id: string) {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }
}
