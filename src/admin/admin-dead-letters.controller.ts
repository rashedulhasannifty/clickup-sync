import { Controller, Get, HttpCode, NotFoundException, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { QueueService } from '../queues/queue.service';
import { DeadLetterRepository } from '../jobs/dead-letter.repository';

/** Dead-letter inspection + retry/resolve actions under `/admin`. */
@ApiTags('admin')
@ApiSecurity('x-admin-key')
@Roles(Role.OWNER, Role.ADMIN)
@UseInterceptors(AuditLogInterceptor)
@Controller('admin')
export class AdminDeadLettersController {
  constructor(
    private readonly queues: QueueService,
    private readonly deadLetters: DeadLetterRepository,
  ) {}

  @Get('dead-letters')
  @ApiOperation({ summary: 'List unresolved dead-letter jobs' })
  async listDeadLetters(@Query('limit') limit = 50, @Query('offset') offset = 0) {
    const safeLimit = Math.min(Number(limit) || 50, 200);
    const safeOffset = Number(offset) || 0;
    return this.deadLetters.findPending(safeLimit, safeOffset);
  }

  @Post('dead-letters/:id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-queue a dead-letter job back onto its original queue' })
  async retryDeadLetter(@Param('id') id: string) {
    const record = await this.deadLetters.findById(BigInt(id));
    if (!record) throw new NotFoundException(`Dead-letter job ${id} not found`);
    await this.queues.get(record.queueName).add(record.jobName, record.payload, this.queues.defaultJobOptions());
    await this.deadLetters.markRetried(BigInt(id));
    return { requeued: true, id, queueName: record.queueName, jobName: record.jobName };
  }

  @Post('dead-letters/retry-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-queue every pending dead-letter job onto its original queue' })
  async retryAllDeadLetters() {
    // High limit so a single click clears the whole backlog, not just one page.
    const { items } = await this.deadLetters.findPending(1000, 0);
    let requeued = 0;
    for (const item of items) {
      // Per-item guard: one poison record (e.g. an unknown queue name) must not
      // abort the rest of the batch.
      try {
        const record = await this.deadLetters.findById(item.id);
        if (!record) continue;
        await this.queues.get(record.queueName).add(record.jobName, record.payload, this.queues.defaultJobOptions());
        await this.deadLetters.markRetried(record.id);
        requeued += 1;
      } catch {
        /* skip and continue */
      }
    }
    return { requeued, scanned: items.length };
  }

  @Post('dead-letters/:id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a dead-letter job resolved/won’t-fix (removes it from the pending list without re-queueing). For poison payloads that can never succeed.' })
  async resolveDeadLetter(@Param('id') id: string) {
    const record = await this.deadLetters.findById(BigInt(id));
    if (!record) throw new NotFoundException(`Dead-letter job ${id} not found`);
    await this.deadLetters.markResolved(BigInt(id));
    return { resolved: true, id };
  }
}
