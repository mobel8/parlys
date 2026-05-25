/**
 * Lightweight i18n scaffold for VoiceInk's UI.
 *
 * Why hand-rolled instead of i18next/react-intl:
 *   - We have ~150 UI strings total (not thousands). Pulling in a 40 KB
 *     runtime + a plugin ecosystem is overkill and would bloat the
 *     renderer bundle (currently 323 KB) by ~12 %.
 *   - No ICU message format needs yet — everything is simple passthrough
 *     strings or `{var}`-style interpolation which we implement in < 10
 *     lines of code below.
 *   - Keeps the "offline-first, no unnecessary network or async boot"
 *     character of the app — i18next's namespaced loader would either
 *     defer initial paint or require bundling every locale anyway.
 *
 * Adding a new language:
 *   1. Add `<code>: 'Native label'` to SUPPORTED_UI_LANGUAGES below.
 *   2. Add a sibling dictionary under `translations` with the same keys
 *      as the `fr` dictionary (use `{}` for unknown keys — the runtime
 *      will fall back to English, then French).
 *   3. Ship. No build-step change needed.
 *
 * Contract: every key MUST exist in at least the `en` dictionary (the
 * fallback of fallbacks), so the UI never renders a raw key like
 * "settings.language" to the user.
 */

export type UILanguage = 'auto' | 'fr' | 'en';

/**
 * Ordered list used to build the settings picker. `auto` resolves at
 * runtime via `resolveUILanguage()`.
 */
export const SUPPORTED_UI_LANGUAGES: Array<{ code: UILanguage; native: string; englishName: string }> = [
  { code: 'auto', native: 'Auto',     englishName: 'Auto (OS language)' },
  { code: 'fr',   native: 'Français', englishName: 'French' },
  { code: 'en',   native: 'English',  englishName: 'English' },
];

/**
 * Flat key → translation map. Dotted keys (`settings.language`) are
 * just conventions to group related strings — we never actually nest
 * the JSON because lookup cost matters at every render.
 *
 * Convention:
 *   - First segment: high-level area (common, nav, settings, main, …).
 *   - Subsequent segments: subsection / specific affordance.
 *
 * When a string contains variables, use `{name}` interpolation — see
 * `t()` below for the substitution rule.
 */
type Dict = Record<string, string>;

const en: Dict = {
  // Common / chrome
  'common.save':       'Save',
  'common.saved':      'Saved',
  'common.cancel':     'Cancel',
  'common.close':      'Close',
  'common.delete':     'Delete',
  'common.copy':       'Copy',
  'common.copied':     'Copied',
  'common.paste':      'Paste',
  'common.beta':       'Beta',
  'common.new':        'New',
  'common.enabled':    'Enabled',
  'common.disabled':   'Disabled',
  'common.loading':    'Loading…',
  'common.empty':      'Empty',

  // Sidebar nav
  'nav.dictation':     'Dictation',
  'nav.history':       'History',
  'nav.settings':      'Settings',

  // Main / dictation view
  'main.title':               'Smart dictation',
  'main.subtitle':            'Speak. We transcribe in a flash.',
  'main.hint.spaceToggle':    'Press {key} to start / stop.',
  'main.state.ready':         'Ready to listen',
  'main.state.readyInterp':   'Ready to interpret',
  'main.state.listening':     'Listening…',
  'main.state.interpreting':  'Interpreting…',
  'main.state.processing':    'Processing…',
  'main.state.error':         'Something went wrong',
  'main.action.start':        'Start',
  'main.action.stop':         'Stop',
  'main.action.inject':       'Paste into active app',

  // Settings — section titles
  'settings.title':             'Settings',
  'settings.subtitle':          'Tune your engine and your experience.',
  'settings.section.appearance':   'Appearance',
  'settings.section.interface':    'Interface',
  'settings.section.replacements': 'Custom dictionary',
  'settings.section.interpreter':  'Voice interpreter',
  'settings.section.translation':  'Automatic translation',
  'settings.section.transcription':'Transcription engine',
  'settings.section.workflow':     'Workflow',
  'settings.section.llm':          'LLM post-processing',
  'settings.section.shortcuts':    'Global shortcuts',
  'settings.section.system':       'System',

  // Settings — interface
  'settings.density.label':       'Density',
  'settings.density.comfortable': 'Comfortable',
  'settings.density.compact':     'Compact / minimalist',
  'settings.density.hint':        'Compact turns the app into a tiny floating pill (176×52 px), transparent and always on top — ideal for overlay dictation.',
  'settings.alwaysOnTop':         'Always on top',
  'settings.alwaysOnTop.desc':    'Keeps the VoiceInk window above your other apps.',

  // Settings — app language (this very feature)
  'settings.uiLanguage.label':    'App language',
  'settings.uiLanguage.hint':     'The app\u2019s own interface language. Independent of the dictation language (Whisper auto-detects speech).',

  // Settings — shortcuts
  'settings.shortcuts.toggle':       'Start / Stop (toggle)',
  'settings.shortcuts.toggle.hint':  'Click the field then press your combo. Applies instantly — no restart needed.',
  'settings.shortcuts.interpreter':  'Toggle voice interpreter',
  'settings.shortcuts.interpreter.hint': 'Instantly flips the voice translator. Your next dictation will go through Whisper → translate → AI voice. Leave empty to unbind.',
  'settings.shortcuts.ptt':          'Push-to-Talk shortcut',
  'settings.shortcuts.ptt.desc':     'Hold a key to speak, release to stop. Faster than the toggle for quick bursts.',

  // Settings — interpreter
  'settings.interpreter.title':     'Voice translator (interpreter)',
  'settings.interpreter.desc':      'Speak in your language — VoiceInk instantly translates and speaks the result with a realistic AI voice. Great for multilingual meetings, video calls, or testing a turn of phrase in another language.',
  'settings.interpreter.speakLabel':'Speak translations out loud',
  'settings.interpreter.speakDesc': 'When off, only the translated text is produced: no TTS call is made (Cartesia/ElevenLabs not billed, credit savings). Also applies to the Listener feature.',
  'settings.interpreter.targetLang':'Spoken output language',

  // Settings — system
  'settings.autostart':           'Launch VoiceInk at system startup',
  'settings.autostart.desc':      'The app will run automatically at every session open.',
  'settings.startMin':            'Start in background',
  'settings.startMin.desc':       'On launch, don\u2019t show the main window — stay in tray / pill.',
  'settings.sounds':              'Notification sounds',
  'settings.sounds.desc':         'Play a subtle beep at the start and end of recording.',

  // History view
  'history.title':        'History',
  'history.empty':        'No dictation yet. Press the record button to get started.',
  'history.export.json':  'Export JSON',
  'history.export.md':    'Export Markdown',
  'history.export.txt':   'Export Text',
  'history.export.csv':   'Export CSV',
  'history.clear':        'Clear history',
  'history.pin':          'Pin',
  'history.unpin':        'Unpin',

  // Auto-updater
  'updater.checking':      'Checking for updates…',
  'updater.upToDate':      'VoiceInk {version} is up to date.',
  'updater.downloading':   'Downloading VoiceInk {version}…',
  'updater.readyTitle':    'VoiceInk {version} is ready to install',
  'updater.readyDesc':     'Restart to apply the update — your work will be saved.',
  'updater.installNow':    'Install & restart',
  'updater.later':         'Later',
  'updater.errorTitle':    'Update check failed',
  'updater.errorGeneric':  'Network issue — we\u2019ll try again later.',
};

const fr: Dict = {
  // Common
  'common.save':       'Enregistrer',
  'common.saved':      'Sauvegardé',
  'common.cancel':     'Annuler',
  'common.close':      'Fermer',
  'common.delete':     'Supprimer',
  'common.copy':       'Copier',
  'common.copied':     'Copié',
  'common.paste':      'Coller',
  'common.beta':       'Beta',
  'common.new':        'Nouveau',
  'common.enabled':    'Activé',
  'common.disabled':   'Désactivé',
  'common.loading':    'Chargement…',
  'common.empty':      'Vide',

  // Nav
  'nav.dictation':     'Dictée',
  'nav.history':       'Historique',
  'nav.settings':      'Paramètres',

  // Main
  'main.title':               'Dictée intelligente',
  'main.subtitle':            'Parlez. On transcrit en un éclair.',
  'main.hint.spaceToggle':    '{key} pour démarrer / arrêter.',
  'main.state.ready':         'Prêt à vous écouter',
  'main.state.readyInterp':   'Prêt à interpréter',
  'main.state.listening':     'Écoute…',
  'main.state.interpreting':  'Interprétation…',
  'main.state.processing':    'Traitement…',
  'main.state.error':         'Un problème est survenu',
  'main.action.start':        'Démarrer',
  'main.action.stop':         'Arrêter',
  'main.action.inject':       'Coller dans l\u2019appli active',

  // Settings — titres
  'settings.title':             'Paramètres',
  'settings.subtitle':          'Configurez votre moteur et votre expérience.',
  'settings.section.appearance':   'Apparence',
  'settings.section.interface':    'Interface',
  'settings.section.replacements': 'Dictionnaire personnalisé',
  'settings.section.interpreter':  'Traducteur vocal',
  'settings.section.translation':  'Traduction automatique',
  'settings.section.transcription':'Moteur de transcription',
  'settings.section.workflow':     'Workflow',
  'settings.section.llm':          'Post-traitement LLM',
  'settings.section.shortcuts':    'Raccourcis globaux',
  'settings.section.system':       'Système',

  // Interface
  'settings.density.label':       'Densité',
  'settings.density.comfortable': 'Confortable',
  'settings.density.compact':     'Compact / minimaliste',
  'settings.density.hint':        'Le mode compact transforme l\u2019app en une petite pilule flottante (176×52 px) transparente, toujours au premier plan — idéale pour dicter en surimpression.',
  'settings.alwaysOnTop':         'Toujours au premier plan',
  'settings.alwaysOnTop.desc':    'Garde la fenêtre VoiceInk visible au-dessus de vos autres applications.',

  // Langue UI
  'settings.uiLanguage.label':    'Langue de l\u2019application',
  'settings.uiLanguage.hint':     'Langue de l\u2019interface de l\u2019app. Indépendante de la langue de dictée (Whisper la détecte automatiquement).',

  // Raccourcis
  'settings.shortcuts.toggle':       'Démarrer / Arrêter (toggle)',
  'settings.shortcuts.toggle.hint':  'Cliquez dans le champ puis appuyez sur la combinaison. S\u2019applique instantanément — aucun redémarrage nécessaire.',
  'settings.shortcuts.interpreter':  'Activer / désactiver l\u2019interprète vocal',
  'settings.shortcuts.interpreter.hint': 'Bascule instantanément le traducteur vocal. La prochaine dictée passera par Whisper → traduction → voix IA. Laissez vide pour désactiver.',
  'settings.shortcuts.ptt':          'Raccourci Push-to-Talk',
  'settings.shortcuts.ptt.desc':     'Maintenez une touche pour parler, relâchez pour arrêter. Plus rapide que le toggle pour de courtes dictées.',

  // Interpréte
  'settings.interpreter.title':     'Traducteur vocal (interprète)',
  'settings.interpreter.desc':      'Parlez dans votre langue — VoiceInk traduit instantanément et prononce le résultat avec une voix IA réaliste. Idéal pour réunions multilingues, appels visio, ou tester une tournure dans une autre langue.',
  'settings.interpreter.speakLabel':'Prononcer la traduction à voix haute',
  'settings.interpreter.speakDesc': 'Quand désactivé, seul le texte traduit est produit : aucun appel TTS n\u2019est fait (Cartesia/ElevenLabs non sollicités, économies de crédits). S\u2019applique aussi au mode Écoute.',
  'settings.interpreter.targetLang':'Langue parlée en sortie',

  // Système
  'settings.autostart':           'Lancer VoiceInk au démarrage de Windows',
  'settings.autostart.desc':      'L\u2019app se lancera automatiquement à chaque ouverture de session.',
  'settings.startMin':            'Démarrer en arrière-plan',
  'settings.startMin.desc':       'Au lancement, ne pas afficher la fenêtre principale — rester dans le tray / en pilule.',
  'settings.sounds':              'Sons de notification',
  'settings.sounds.desc':         'Joue un bip subtil au début et à la fin de l\u2019enregistrement.',

  // Historique
  'history.title':        'Historique',
  'history.empty':        'Aucune dictée pour l\u2019instant. Appuyez sur le bouton d\u2019enregistrement pour commencer.',
  'history.export.json':  'Exporter en JSON',
  'history.export.md':    'Exporter en Markdown',
  'history.export.txt':   'Exporter en Texte',
  'history.export.csv':   'Exporter en CSV',
  'history.clear':        'Vider l\u2019historique',
  'history.pin':          'Épingler',
  'history.unpin':        'Désépingler',

  // Mise à jour automatique
  'updater.checking':      'Recherche de mises à jour…',
  'updater.upToDate':      'VoiceInk {version} est à jour.',
  'updater.downloading':   'Téléchargement de VoiceInk {version}…',
  'updater.readyTitle':    'VoiceInk {version} est prêt à être installé',
  'updater.readyDesc':     'Redémarrez pour appliquer la mise à jour — votre travail sera sauvegardé.',
  'updater.installNow':    'Installer et redémarrer',
  'updater.later':         'Plus tard',
  'updater.errorTitle':    'Échec de la vérification',
  'updater.errorGeneric':  'Problème réseau — nous réessaierons plus tard.',
};

const translations: Record<Exclude<UILanguage, 'auto'>, Dict> = { en, fr };

/**
 * Resolve an 'auto' setting to a concrete locale code. Uses the
 * renderer's `navigator.language` when available (web context) or the
 * POSIX `LANG` / `LC_ALL` env vars in the main process. Falls back to
 * 'en' when nothing matches — English is the safer default for a
 * product sold internationally.
 */
export function resolveUILanguage(pref: UILanguage): Exclude<UILanguage, 'auto'> {
  if (pref === 'fr' || pref === 'en') return pref;
  // Auto.
  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      const tag = navigator.language.toLowerCase();
      if (tag.startsWith('fr')) return 'fr';
      return 'en';
    }
  } catch { /* ignore */ }
  try {
    const envLang = (process.env.LANG || process.env.LC_ALL || '').toLowerCase();
    if (envLang.startsWith('fr')) return 'fr';
  } catch { /* ignore */ }
  return 'en';
}

/**
 * Lookup a translation with simple `{var}` substitution.
 *
 * `t(lang, 'main.hint.spaceToggle', { key: 'Space' })` →
 *   "Press Space to start / stop." (en)   OR
 *   "Space pour démarrer / arrêter."      (fr)
 *
 * Missing keys fall through: `fr → en → key itself`. The last fallback
 * is deliberate: if we ever ship a build with a typo in a key, the
 * user sees the raw key instead of an empty string — a visible bug is
 * a reportable bug.
 */
export function t(lang: UILanguage, key: string, vars?: Record<string, string | number>): string {
  const resolved = resolveUILanguage(lang);
  const fromTarget = translations[resolved][key];
  const raw = fromTarget ?? translations.en[key] ?? translations.fr[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = vars[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}
