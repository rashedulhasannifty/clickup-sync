import { Injectable, Logger } from '@nestjs/common';
import { ClientOptionsRepository } from './client-options.repository';

/** How long a loaded catalog snapshot is reused. Renames are rare and a
 *  catalog sync invalidates explicitly, so this only bounds the staleness of a
 *  rename made directly in ClickUp between syncs. */
const CACHE_TTL_MS = 60_000;

/**
 * The canonical client NAME for a ClickUp Client-dropdown option id.
 *
 * Every task payload carries its own snapshot of the Client field definition,
 * so a task not edited since an option was renamed still reports the OLD label
 * while a task edited afterwards reports the new one — same `option_id`, two
 * names. Every report that groups by name then splits one client in two.
 *
 * `clickup_client_options` is populated from ClickUp's field definitions rather
 * than from tasks, so it is the only place that knows an option's current name.
 * Resolving through it on every write keeps one option id to exactly one name.
 *
 * Never throws: an unreachable catalog falls back to the payload's own label,
 * which is what we stored before this existed. A sync must not fail because the
 * name might be slightly stale.
 */
@Injectable()
export class ClientNameResolver {
  private readonly logger = new Logger(ClientNameResolver.name);
  private cache: Map<string, string> | null = null;
  private loadedAt = 0;
  private inflight: Promise<Map<string, string>> | null = null;

  constructor(private readonly repo: ClientOptionsRepository) {}

  /** The catalog's current name for `optionId`, or `fallback` if it knows none. */
  async canonical(optionId: string | null, fallback: string | null): Promise<string | null> {
    if (!optionId) return fallback;
    const map = await this.load();
    return map?.get(optionId) ?? fallback;
  }

  /** Drop the snapshot so the next resolve re-reads — called after a catalog sync. */
  invalidate() {
    this.cache = null;
    this.loadedAt = 0;
  }

  /**
   * One shared load per TTL. A space backfill normalizes tasks in a tight loop,
   * so without single-flight the first page would fire a hundred identical
   * queries before any of them resolved.
   */
  private async load(): Promise<Map<string, string> | null> {
    if (this.cache && Date.now() - this.loadedAt < CACHE_TTL_MS) return this.cache;
    if (!this.inflight) {
      this.inflight = this.repo
        .nameByOptionId()
        .then((map) => {
          this.cache = map;
          this.loadedAt = Date.now();
          return map;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    try {
      return await this.inflight;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Client option catalog unavailable, keeping payload names: ${message}`);
      return null;
    }
  }
}
