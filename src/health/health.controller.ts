import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService, private readonly db: PrismaHealthIndicator, private readonly prisma: PrismaService) {}
  @Get()
  @HealthCheck()
  check() { return this.health.check([() => this.db.pingCheck('postgres', this.prisma)]); }
}
