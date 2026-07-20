import { Injectable, Logger } from '@nestjs/common';

/**
 * Verifies that ClickUp's delivery path to our public webhook endpoint is up
 * (DNS + TLS + reverse proxy + app), by issuing an outbound GET to the same URL
 * ClickUp POSTs to. The route is POST-only and signature-guarded, so a GET
 * returns 401/404/405 — any HTTP response below 500 still proves the path works.
 */
@Injectable()
export class EndpointProbe {
  private readonly logger = new Logger(EndpointProbe.name);

  async probe(url: string, timeoutMs = 5000): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      return res.status < 500;
    } catch (err) {
      this.logger.warn(`Endpoint probe failed for ${url}: ${(err as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
