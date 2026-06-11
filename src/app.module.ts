import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { validateEnv } from './config/env.validation';
import { buildBullConnection } from './config/connection.config';
import { DatabaseModule } from './database/database.module';
import { SettingsModule } from './settings/settings.module';
import { ClickupModule } from './clickup/clickup.module';
import { QueuesModule } from './queues/queues.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TasksModule } from './tasks/tasks.module';
import { TimeEntriesModule } from './time-entries/time-entries.module';
import { RatesModule } from './rates/rates.module';
import { SyncModule } from './sync/sync.module';
import { WorkersModule } from './workers/workers.module';
import { AdminModule } from './admin/admin.module';
import { ReportsModule } from './reports/reports.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'apps', 'web', 'dist'),
      exclude: ['/api/(.*)', '/docs(.*)', '/webhooks/(.*)', '/admin/(.*)', '/reports/(.*)'],
    }),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      useFactory: () => ({ connection: buildBullConnection(process.env.REDIS_URL ?? '') }),
    }),
    DatabaseModule,
    SettingsModule,
    ClickupModule,
    QueuesModule,
    WebhooksModule,
    TasksModule,
    TimeEntriesModule,
    RatesModule,
    SyncModule,
    WorkersModule,
    AdminModule,
    ReportsModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }]),
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}
