import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SyncCheckpointsRepository {
  constructor(private readonly prisma: PrismaService) {}
  markAttempt(source: string, scopeType: string, scopeId: string) {
    return this.prisma.syncCheckpoint.upsert({ where: { source_scopeType_scopeId: { source, scopeType, scopeId } }, create: { source, scopeType, scopeId, lastAttemptedSyncAt: new Date() }, update: { lastAttemptedSyncAt: new Date() } });
  }
  markSuccess(source: string, scopeType: string, scopeId: string, when = new Date()) {
    return this.prisma.syncCheckpoint.upsert({ where: { source_scopeType_scopeId: { source, scopeType, scopeId } }, create: { source, scopeType, scopeId, lastAttemptedSyncAt: when, lastSuccessfulSyncAt: when }, update: { lastSuccessfulSyncAt: when, lastAttemptedSyncAt: when } });
  }
}
