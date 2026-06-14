import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TagAssigneeMapRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByTagName(tagName: string) {
    return this.prisma.tagAssigneeMap.findUnique({ where: { tagName } });
  }

  findAll() {
    return this.prisma.tagAssigneeMap.findMany({ orderBy: { tagName: 'asc' } });
  }

  findAllActive() {
    return this.prisma.tagAssigneeMap.findMany({ where: { active: true }, orderBy: { tagName: 'asc' } });
  }

  create(data: { tagName: string; clickupUserId: string; clickupUserName?: string; clickupEmail?: string; active?: boolean }) {
    return this.prisma.tagAssigneeMap.create({ data });
  }

  update(id: bigint, data: { tagName?: string; clickupUserId?: string; clickupUserName?: string; clickupEmail?: string; active?: boolean }) {
    return this.prisma.tagAssigneeMap.update({ where: { id }, data });
  }

  async remove(id: bigint) {
    await this.prisma.tagAssigneeMap.delete({ where: { id } });
  }
}
