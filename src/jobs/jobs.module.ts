import { Module } from '@nestjs/common';
import { JobLogsRepository } from './job-logs.repository';
import { DeadLetterRepository } from './dead-letter.repository';
import { DeadLetterService } from './dead-letter.service';

@Module({
  providers: [JobLogsRepository, DeadLetterRepository, DeadLetterService],
  exports: [JobLogsRepository, DeadLetterRepository, DeadLetterService],
})
export class JobsModule {}
