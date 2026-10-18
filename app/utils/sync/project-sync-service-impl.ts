import type { ProjectStore } from '~/utils/persistence/project-store';
import type { RemoteClient, RemoteProjectHead } from '~/utils/sync/remote-api';
import type { ProjectSyncService } from '~/utils/sync/project-sync-service';
import { getOpenSyncEngine } from '~/utils/sync/open-sync-engine';
import { mirrorHeadless, pushHeadless } from '~/utils/sync/project-mirror';

/**
 * Implementation of the `ProjectSyncService` contract (ADR 0004 D13, D15, D16).
 * The open project is always handled by its own `SyncEngine`; closed projects
 * use the headless steps of `project-mirror.ts`.
 */

export interface ProjectSyncServiceDeps {
  client: RemoteClient;
  store: () => Promise<ProjectStore>;
}

/** Build the service. */
export function createProjectSyncService(deps: ProjectSyncServiceDeps): ProjectSyncService {
  return {
    async mirrorProject(head: RemoteProjectHead, userId: string): Promise<boolean> {
      try {
        const open = getOpenSyncEngine(head.id);
        if (open) {
          // Never touch the open project's store data behind its engine.
          if (open.boundUserId === userId) await open.requestSync();
          return true;
        }
        return await mirrorHeadless(await deps.store(), deps.client, head, userId);
      }
      catch (err) {
        console.warn(`[sync] mirrorProject(${head.id}) failed:`, err);
        return false;
      }
    },

    async flushAll(userId: string): Promise<number> {
      const store = await deps.store();
      const projects = (await store.listProjects()).filter(m =>
        m.origin === 'cloud' && m.ownerUserId === userId && !m.remoteDeletedAt);
      for (const meta of projects) {
        try {
          const open = getOpenSyncEngine(meta.id);
          if (open) {
            if (open.boundUserId === userId) await open.flushNow();
          }
          else if (await store.countPending(meta.id) > 0) {
            await pushHeadless(store, deps.client, meta.id);
          }
        }
        catch (err) {
          console.warn(`[sync] flushing ${meta.id} failed:`, err);
        }
      }
      // Everything bound to this account that is still pending (deleted ones included).
      const bound = (await store.listProjects()).filter(m => m.origin === 'cloud' && m.ownerUserId === userId);
      const counts = await Promise.all(bound.map(m => store.countPending(m.id)));
      return counts.reduce((a, b) => a + b, 0);
    },

    async countPending(projectId?: string): Promise<number> {
      return (await deps.store()).countPending(projectId);
    },
  };
}
