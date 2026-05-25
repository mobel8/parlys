/**
 * Renderer-side i18n helpers. Re-exports the shared `t()` from
 * `src/shared/i18n.ts` wrapped into a React hook that reads the
 * user's preferred UI language from the Zustand store.
 *
 * Why a hook instead of a context provider:
 *   - Our whole state already lives in Zustand. A `LangProvider`
 *     would be a second source of truth and encourage out-of-sync
 *     bugs. The hook below does a ~5 ns shallow read on re-render,
 *     zero overhead vs a context.
 *   - React 18's `useSyncExternalStore` (which Zustand uses under
 *     the hood) deduplicates identical state reads, so consumers
 *     don't rebuild when the language DIDN'T change.
 */
import { useStore } from '../stores/useStore';
import { t as sharedT, type UILanguage } from '../../shared/i18n';

/**
 * Returns a translation function bound to the current UI language.
 *
 * ```tsx
 * const t = useT();
 * return <h1>{t('main.title')}</h1>;
 * ```
 *
 * Components that call `useT()` automatically re-render when the
 * user picks a new language in Settings — the store's
 * `settings.uiLanguage` is a dependency of the selector.
 */
export function useT() {
  const lang = useStore((s) => s.settings.uiLanguage) as UILanguage | undefined;
  const effective: UILanguage = lang || 'auto';
  return (key: string, vars?: Record<string, string | number>) =>
    sharedT(effective, key, vars);
}

/** Non-hook variant for one-off translations outside React. */
export function tStatic(lang: UILanguage | undefined, key: string, vars?: Record<string, string | number>) {
  return sharedT(lang || 'auto', key, vars);
}
