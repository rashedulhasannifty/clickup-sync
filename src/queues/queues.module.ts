import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from './queue.constants';
import { QueueService } from './queue.service';

@Module({
  imports: Object.values(QUEUES).map((name) => BullModule.registerQueue({ name })),
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueuesModule {}
