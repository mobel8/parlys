/**
 * React hook — `useLang()` — returns the current UI language and
 * re-renders the island when it changes.
 *
 * Source of truth: `<html data-lang>`. The inline pre-paint script in
 * `BaseLayout.astro` is responsible for setting this attribute on boot
 * (reading localStorage, falling back to DEFAULT_LANG). The
 * `LangToggle.astro` component mutates it on click AND dispatches the
 * `voiceink:langchange` custom event, which this hook subscribes to.
 *
 * We avoid touching localStorage from the hook itself — keeping side
 * effects in exactly one place (the toggle and the pre-paint script)
 * makes the data flow easier to reason about.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_LANG, LANG_CHANGE_EVENT, type Lang } from './lang';

function readLangFromDom(): Lang {
  if (typeof document === 'undefined') return DEFAULT_LANG;
  const attr = document.documentElement.getAttribute('data-lang');
  return attr === 'en' ? 'en' : 'fr';
}

export function useLang(): Lang {
  // SSR-safe initial value: the DEFAULT_LANG. Once mounted in the
  // browser we reconcile with whatever the pre-paint script decided.
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    setLang(readLangFromDom());
    const onChange = () => setLang(readLangFromDom());
    window.addEventListener(LANG_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LANG_CHANGE_EVENT, onChange);
  }, []);

  return lang;
}
