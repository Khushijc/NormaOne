import { useMemo, useSyncExternalStore } from 'react';
import type { Permission } from '../domain/permissions';
import type { Database } from '../domain/types';
import { getLang, subscribeLang, type Lang } from '../i18n';
import { localizeDb } from '../i18n/localizeDb';
import { getCtx, type Ctx } from '../services/context';
import { getDb, getSession, subscribe, type Session } from './db';
import { getTheme, subscribeTheme, toggleTheme, setTheme, type Theme } from './theme';

/**
 * Database for display. In English, product-defined reference texts are translated (see
 * i18n/localizeDb); the stored records and the services stay in Spanish.
 */
export function useDb(): Database {
  const raw = useSyncExternalStore(subscribe, getDb, getDb);
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang);
  return useMemo(() => (lang === 'en' ? localizeDb(raw) : raw), [raw, lang]);
}

/** Current interface language. Components re-render when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

/** Current interface theme ('light' | 'dark'). Re-renders when toggled. */
export function useTheme(): { theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void } {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'light' as Theme);
  return { theme, toggleTheme, setTheme };
}

export interface UiCtx extends Ctx {
  can: (p: Permission) => boolean;
  session: Session;
  lang: Lang;
}

/** Current user/company context. Re-renders whenever data, the session or the language changes. */
export function useCtx(): UiCtx {
  const db = useDb();
  const lang = useLang();
  return useMemo(() => {
    const ctx = getCtx(db);
    return { ...ctx, session: getSession(), can: (p: Permission) => ctx.perms.has(p), lang };
  }, [db, lang]);
}
