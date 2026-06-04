import { Test } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { SettingsModule } from '../src/settings/settings.module';
import { SettingsService } from '../src/settings/settings.service';
import { ClickupModule } from '../src/clickup/clickup.module';
import { ClickupClient } from '../src/clickup/clickup.client';
import { ClickupWebhooksService } from '../src/clickup/clickup-webhooks.service';
import { WorkspaceMembersService } from '../src/clickup/workspace-members.service';

// Validates the actual Nest DI graph (not just `new Service(...)`): the @Global
// SettingsModule must satisfy SettingsService for every ClickUp consumer that
// now depends on it. `.compile()` runs the real constructors; we mock only the
// DB. Does NOT cover AppModule's Redis/Bull/Admin wiring (needs live infra).
describe('Settings DI wiring', () => {
  it('resolves ClickUp consumers that depend on SettingsService, and loads the cache on init', async () => {
    const prismaMock = {
      appSettings: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, HttpModule, SettingsModule, ClickupModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    // Constructors already ran during compile() — getting them proves the graph.
    expect(moduleRef.get(SettingsService)).toBeDefined();
    expect(moduleRef.get(ClickupClient)).toBeDefined();
    expect(moduleRef.get(ClickupWebhooksService)).toBeDefined();
    expect(moduleRef.get(WorkspaceMembersService)).toBeDefined();

    // Exercise the new boot-time DB read against the mock.
    await moduleRef.get(SettingsService).onModuleInit();
    expect(prismaMock.appSettings.findUnique).toHaveBeenCalled();

    await moduleRef.close();
  });
});
