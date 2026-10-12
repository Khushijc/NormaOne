import { useMemo, useSyncExternalStore } from 'react';
import type { Permission } from '../domain/permissions';
import type { Database } from '../domain/types';
import { getLang, subscribeLang, type Lang } from '../i18n';
import { getCtx, type Ctx } from '../services/context';
import { getDb, getDemoSwitches, getSession, subscribe, type DemoSwitches, type Session } from './db';

export function useDb(): Database {
  return useSyncExternalStore(subscribe, getDb, getDb);
}

/** Current interface language. Components re-render when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

export interface UiCtx extends Ctx {
  can: (p: Permission) => boolean;
  session: Session;
  lang: Lang;
  switches: DemoSwitches;
}

/** Current user/company context. Re-renders whenever data, the session or the language changes. */
export function useCtx(): UiCtx {
  const db = useDb();
  const lang = useLang();
  return useMemo(() => {
    const ctx = getCtx(db);
    return { ...ctx, session: getSession(), can: (p: Permission) => ctx.perms.has(p), lang, switches: getDemoSwitches() };
  }, [db, lang]);
}
