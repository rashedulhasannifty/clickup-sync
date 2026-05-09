import { Module } from '@nestjs/common';
import { JobLogsRepository } from './job-logs.repository';
import { DeadLetterRepository } from './dead-letter.repository';

@Module({ providers: [JobLogsRepository, DeadLetterRepository], exports: [JobLogsRepository, DeadLetterRepository] })
export class JobsModule {}
