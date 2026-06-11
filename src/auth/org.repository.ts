import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export const SEED_ORG_ID = 'org_seed';

@Injectable()
export class OrgRepository {
  constructor(private readonly prisma: PrismaService) {}

  get(id = SEED_ORG_ID) {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  rename(id: string, name: string) {
    return this.prisma.organization.update({ where: { id }, data: { name } });
  }
}
