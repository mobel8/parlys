/**
 * i18n context for the promo video.
 *
 * A composition wraps its children in `<LangProvider lang="en">` so
 * every nested scene can call `const t = useT()` and get the right
 * localisation without prop-drilling.
 */
import React, { createContext, useContext } from 'react';
import { STRINGS, type Lang, type Strings } from './strings';

const LangContext = createContext<Strings>(STRINGS.en);

export const LangProvider: React.FC<{ lang: Lang; children: React.ReactNode }> = ({ lang, children }) => (
  <LangContext.Provider value={STRINGS[lang]}>{children}</LangContext.Provider>
);

export const useT = (): Strings => useContext(LangContext);
