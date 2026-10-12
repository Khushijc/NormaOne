import { useMemo, useSyncExternalStore } from 'react';
import type { Permission } from '../domain/permissions';
import { getLang, subscribeLang, type Lang } from '../i18n';
import type { Database } from '../domain/types';
import { getCtx, type Ctx } from '../services/context';
import { getDb, getSession, subscribe, type Session } from './db';
import { getTheme, subscribeTheme, toggleTheme, setTheme, type Theme } from './theme';

export function useDb(): Database {
  return useSyncExternalStore(subscribe, getDb, getDb);
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

/** Current user/company context. Re-renders whenever data, the session or the interface language changes. */
export function useCtx(): UiCtx {
  const db = useDb();
  const lang = useLang();
  return useMemo(() => {
    const ctx = getCtx();
    return { ...ctx, session: getSession(), can: (p: Permission) => ctx.perms.has(p), lang };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, lang]);
}

