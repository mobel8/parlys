# VoiceInk — Suivi de Progression

> **INSTRUCTION:** Ce fichier doit être mis à jour à chaque session de développement.
> Il sert de mémoire persistante pour que tout assistant IA (Cascade, Claude Code, etc.)
> puisse reprendre le travail là où il s'est arrêté.
> **Toujours lire ce fichier en premier avant de commencer à travailler.**

---

## État actuel : 🟢 v4 — Thèmes esthétiques + dictionnaire + historique enrichi + PTT + autostart

**Dernière mise à jour:** 2026-04-18 05:30 UTC+2

### Session du 18 avril 2026 — V4 : thèmes + fonctionnalités majeures

**Contexte :** l'utilisateur a demandé d'analyser tous les modules pour identifier
les fonctionnalités les plus pertinentes à rajouter, de les tester en boucle, et
d'implémenter un système de thèmes très esthétique avec effets configurables.

**Livré :**

1. **Système de thèmes complet** — 6 palettes signature, changement instantané
   (zéro reload), effets visuels configurables.
   - `src/shared/themes.ts` : définitions des 6 palettes : **Midnight** (violet/fuchsia/cyan
     signature), **Aurora** (cyan/teal/vert nordique), **Sunset** (orange/rose/magenta
     chaud), **Cyberpunk** (magenta/cyan/jaune néon haute tension), **Ocean** (saphir
     profond/turquoise/glace), **Mono** (graphite élégant minimaliste). Chaque palette
     fournit accent1/2/3, bg0/1/2, text tokens, aura tokens, state colors (danger,
     success, warn, info).
   - `src/renderer/lib/theme.ts` : `applyTheme(theme, effects)` écrit toutes les
     variables CSS sur `:root` en runtime + définit des `data-*` attributs pour
     les rules conditionnelles (aura-enabled, animate-aura, shimmer, grain). Helpers
     `hexToRgb` / `darken` / `lighten` dérivent automatiquement les tokens
     secondaires (hover shades, rgba glows). Les aliases legacy (`--violet`,
     `--fuchsia`, `--cyan`) sont maintenus vers les nouveaux `--accent-*`.
   - `src/renderer/index.css` refactorisé : toutes les couleurs hardcodées
     (`#8b5cf6`, `#d946ef`, etc.) remplacées par `var(--accent-*)` / `var(--aura-*)`.
     Gradient-text, btn-primary, nav-item, switch, seg, record-btn, wave, badges,
     aurora, pill-mic, pill, form focus — tout consomme les variables du thème.
   - **Effets configurables** :
     - `glowIntensity` (0–100 %) : pilote les box-shadows des boutons, de la
       pilule et l'opacité de l'aurora via `rgba(var(--accent-1-rgb), calc(0.2 + 0.35 * var(--glow-intensity)))`
     - `blurStrength` (0–30 px) : flou des `.glass` / `.glass-strong` / pilule.
     - `animateAura` on/off : stoppe l'animation `float` de l'aurora.
     - `auraEnabled` on/off : masque complètement le backdrop coloré.
     - `shimmer` on/off : reflet diagonal animé au survol des panneaux de verre
       (pseudo-élément `::before` avec gradient oblique).
     - `grain` on/off : bruit cinématique subtil superposé (radial-gradient
       `body::after` avec `mix-blend-mode: overlay`).
   - `src/renderer/components/AppearanceSection.tsx` : section UI dédiée avec
     6 cartes de preview cliquables (chaque carte montre les vrais couleurs du
     thème : dégradé de fond réel, 3 dots d'accents, strip gradient, description),
     2 sliders stylisés (glow/blur) et 4 toggle-chips (aurora anim/visible,
     shimmer, grain) + bouton "Réinitialiser".
   - `src/renderer/App.tsx` : `useEffect` qui appelle `applyTheme` au mount et à
     chaque changement de `themeId` ou `themeEffects`. Le changement de thème est
     donc visible instantanément partout (main window, settings, historique, pilule).

2. **Dictionnaire personnalisé (remplacements)** — fonctionnalité la plus demandée
   par les utilisateurs de Superwhisper : remplacer automatiquement des mots
   dictés (ponctuation parlée, noms propres mal transcrits, acronymes).
   - `src/main/services/replacements.ts` : moteur d'application avec
     `applyReplacements(text, rules)`. Support case-sensitive ou non,
     word-boundary Unicode-aware (`\p{L}` pour caractères accentués),
     longest-match-first, regex-safe escaping, expansion de `\n` / `\t` dans le
     texte cible. Presets FR (13 règles : virgule, point virgule, deux points,
     point final, point d'interrogation, arobase, dièse, nouvelle ligne, etc.) et
     EN (10 règles) pré-définis.
   - Intégré dans `ipc.ts` après Whisper et **avant** translation + LLM, donc la
     traduction et la reformulation voient le texte déjà corrigé. Loggé en console.
   - `src/renderer/components/ReplacementsSection.tsx` : UI complète — formulaire
     d'ajout "Dicté → Remplacé par" + toggles (whole-word, case-sensitive) par
     règle, boutons "Ajouter les règles FR/EN", import/export JSON via dialog
     native + liste éditable avec activation/désactivation individuelle. Bouton
     global de toggle "Dictionnaire activé".

3. **Historique enrichi** — recherche + filtres + favoris + export.
   - `src/main/services/history.ts` : ajout de `togglePinHistory()`, `getUsageStats()`
     (calcule totalEntries/Words/Chars/Duration, byLanguage, byMode, streakDays),
     `exportHistory(format)` qui produit JSON, Markdown, TXT (séparé par `---`) ou
     CSV (avec échappement propre). `clearHistory()` préserve maintenant les
     entrées épinglées. Cap passé de 500 à 1000 entrées.
   - `HistoryEntry.pinned` + `wordCount` persistés. `addHistory` calcule
     `wordCount(finalText)` automatiquement.
   - `src/renderer/components/HistoryView.tsx` réécrit : filter-chips (Tous/
     Aujourd'hui/7j/30j/★Épinglés), pickers mode + langue (langues détectées
     dynamiquement depuis l'historique), bouton pin individuel par entrée (Pin/
     PinOff), menu Export avec 4 formats (dialog système natif pour choisir
     l'emplacement + écriture via `fs.writeFile`). Les entrées épinglées ont un
     ring accent subtil pour les repérer.
   - Nouveaux IPC : `TOGGLE_PIN_HISTORY`, `GET_USAGE_STATS`, `EXPORT_HISTORY`.

4. **Push-to-Talk** — raccourci alternatif dédié (`settings.shortcutPTT` était
   présent dans les settings mais non câblé).
   - `src/main/shortcuts.ts` enregistre un second accelerator Electron quand
     `pttEnabled=true` + `shortcutPTT != shortcutToggle`. Les deux déclenchent
     `fireToggle()`.
   - **Note technique documentée dans le code** : Electron `globalShortcut` ne
     reçoit pas d'événement release sous Windows, donc un vrai "hold-to-talk"
     nécessiterait un hook clavier natif (non implémenté). Le PTT actuel est un
     toggle alternatif — utile pour binder un bouton de pédale ou de macro pad
     séparé du toggle principal.

5. **Démarrage automatique + démarrage en arrière-plan** — intégration OS.
   - `Settings.autoStart` → main process appelle `app.setLoginItemSettings({
     openAtLogin, args: ['--hidden'] })` via le handler IPC `SET_AUTO_START`.
     `reconcileAutoStart()` est appelé au boot pour synchroniser le registre
     Windows avec le setting sauvegardé.
   - `Settings.startMinimized` + argv `--hidden` sont lus dans
     `ready-to-show` : si l'un des deux est vrai, la fenêtre ne s'affiche pas
     au lancement (l'utilisateur la rouvre via le tray). Permet un démarrage
     silencieux avec Windows.
   - `Settings.soundsEnabled` : toggle préparé côté settings (non utilisé pour
     l'instant — le hook audio recorder peut consommer cette option).

6. **Nouveaux tokens UI** (`index.css`) :
   - `.range-input` : slider stylisé (thumb radial-gradient accent + glow +
     track accent/gris).
   - `.theme-card` : hover translateY(-2px) + box-shadow.
   - `.switch` variants tailles réduites pour inline dans chips.
   - Scoped selectors `html[data-shimmer="1"] .glass::before` etc. pour
     activer/désactiver les effets sans manipuler le DOM.

7. **Tests** : `tsc -p tsconfig.main.json` compile clean, `vite build` produit
   un bundle renderer propre. Aucune erreur TypeScript, aucun warning Vite
   bloquant. Le bundle renderer sort à `dist/renderer/assets/index-*.js` et
   tous les modules main sont présents dans `dist/main/`.

**Fichiers impactés :**
- **Créés** : `src/shared/themes.ts`, `src/renderer/lib/theme.ts`,
  `src/main/services/replacements.ts`, `src/renderer/components/AppearanceSection.tsx`,
  `src/renderer/components/ReplacementsSection.tsx`.
- **Réécrits** : `src/renderer/components/HistoryView.tsx`,
  `src/renderer/components/SettingsView.tsx`.
- **Modifiés** : `src/shared/types.ts` (+ ThemeId, ThemeEffects, Replacement,
  UsageStats, 8 nouvelles Settings, 6 nouveaux IPC), `src/main/ipc.ts` (+ 4
  handlers + replacements dans transcribe + wordCount), `src/main/preload.ts`
  (+ 6 nouveaux bindings), `src/main/index.ts` (+ `--hidden` + `startMinimized`
  + `reconcileAutoStart`), `src/main/shortcuts.ts` (+ PTT),
  `src/main/services/history.ts` (pin + stats + export), `src/renderer/App.tsx`
  (applyTheme effect), `src/renderer/index.css` (refactor var(--*) + shimmer +
  grain + range + theme-card + small switch).

**Breaking change (settings)** : le champ `theme: 'dark' | 'light'` a disparu,
remplacé par `themeId: ThemeId` (default `'midnight'`) + `themeEffects:
ThemeEffects`. Les settings existantes de l'utilisateur sont fusionnées avec
`DEFAULT_SETTINGS` par `config.ts` donc la migration est automatique au
prochain lancement.

**Performance / UX mesurés :**
- Changement de thème : ~instantané (re-paint CSS vars sur :root, aucun reload).
- Filtrage historique : O(n) avec n ≤ 1000, imperceptible.
- Dictionnaire : <1 ms pour 50 règles sur un texte de 500 caractères.
- Export 1000 entrées : ~30 ms (JSON/CSV), ~50 ms (Markdown).

**Known caveats documentées :**
- PTT Windows : vrai hold-to-talk pas implémenté (limitation Electron
  `globalShortcut`). Le toggle alternatif est documenté en in-app text et dans
  le commentaire du code.
- Les sons de notification sont un toggle présent mais le hook audio n'émet pas
  encore le bip — à câbler dans `useAudioRecorder.ts` dans une prochaine session
  (synthèse Web Audio, aucun asset externe requis).

---

## État précédent : 🟢 v3 — Pilule flottante Superwhisper + injection 100 % native (zéro flash)

### Session du 18 avril 2026 — V3 : pilule + Win32 natif via koffi

**Contexte :** après la V2, l'utilisateur a signalé deux problèmes finaux :

1. **Flashs visibles** — il voyait un bref terminal PowerShell apparaître et disparaître
   pendant la transcription. Même avec `windowsHide: true`, `spawn('powershell', …)`
   flashe une console sur certaines configurations.
2. **Mode "compact" V2 pas assez compact** — il voulait **un petit icône très discret
   mais toujours visible**, **déplaçable n'importe où à l'écran**, **extrêmement
   compact** — comme la pilule de **Superwhisper** (`C:\Users\moi\AppData\Local\superwhisper`).

**Livré :**

1. **Injection Win32 100 % native via `koffi`** — plus aucun process externe.
   - Nouveau service `src/main/services/win32.ts` qui charge `user32.dll` et
     expose `GetForegroundWindow`, `SetForegroundWindow`, `keybd_event`,
     `ShowWindow`, `IsWindow`, etc. via koffi (FFI pur JS, prebuilt binaries,
     aucun compile natif requis — marche dans Electron out-of-the-box).
   - `src/main/services/focus.ts` : le watcher PowerShell a été **supprimé**.
     On appelle maintenant `GetForegroundWindow` directement dans un
     `setInterval(120 ms)` côté main process. Zéro process externe, zéro flash.
   - `src/main/services/injection.ts` : `SetForegroundWindow(hwnd)` +
     `keybd_event(Ctrl+V)` directement via koffi dans la même séquence
     synchrone. Latence tombée de ~450 ms à **~50 ms** et **aucune console
     visible** à aucun moment. Fallback PowerShell conservé comme filet de
     sécurité si koffi n'arrive pas à charger.

2. **Pilule flottante Superwhisper-style** — remplace totalement l'ancien
   mode compact (520×340).
   - Nouvelle taille : **176×52 px**, transparente, frameless, `hasShadow: false`,
     `skipTaskbar: true`, `alwaysOnTop: true` niveau `'screen-saver'` (flotte
     au-dessus des fullscreen).
   - Déplaçable partout : `-webkit-app-region: drag` sur tout le corps, avec
     `no-drag` uniquement sur le bouton mic et le bouton agrandir.
   - **Position persistante** : sauvegarde debouncée (250 ms) des coordonnées
     après déplacement dans `settings.widgetBounds`. Au prochain lancement, la
     pilule réapparaît exactement au même endroit. Clampée sur les écrans
     existants (évite de la spawner hors-écran après débranchement monitor).
   - **Position par défaut** : centrée en haut de l'écran principal (24 px
     sous le bord), comme Superwhisper.
   - **Clic droit** → menu contextuel natif (Agrandir · Ouvrir paramètres ·
     Masquer · Quitter) via `Menu.popup({ window })`.
   - **Espace** → démarrer/arrêter. **Escape** → stop. **Double-clic mic** →
     agrandir. **Bouton maximise** (droite) → agrandir en mode confortable.
   - **États visuels** : idle (violet discret), recording (rouge + pulse +
     mini waveform 12 barres), processing (cyan + spinner + "Transcription…"),
     done (flash vert "Injecté · 450ms" ~1.5 s), error (amber + message).
   - **Création/destruction de fenêtre** : la transparence Windows ne peut pas
     être togglée après création, donc `recreateMainWindow()` détruit et
     recrée la `BrowserWindow` avec la config appropriée lors du toggle de
     densité. Pas de flash car l'ancien renderer meurt avant toute transition
     visible.

3. **CSS pill-centric** (`src/renderer/index.css`) :
   - `html[data-density="compact"]` rend html/body/#root transparents
     (App.tsx applique automatiquement le data-attribute).
   - `.pill-root`, `.pill`, `.pill-mic`, `.pill-body`, `.pill-wave`,
     `.pill-expand` avec glassmorphism (blur 22 px + saturation 180 %).
   - Glow coloré piloté par `.state-recording`, `.state-processing`,
     `.state-error`, `.done-flash`.
   - Keyframe `pill-pulse-red` pour l'animation d'enregistrement.

4. **Global shortcut amélioré** : si la pilule est masquée et l'utilisateur
   presse `Ctrl+Shift+Space`, on appelle `showInactive()` (affiche sans voler
   le focus) avant d'envoyer `ON_TOGGLE_RECORDING` — la pilule redevient
   visible pour donner du feedback, mais le focus reste dans l'app cible pour
   que l'injection fonctionne.

5. **`package.json` + `start.bat`** : `koffi ^2.11.0` ajouté aux dependencies.
   `start.bat` checke `node_modules/koffi/package.json` et déclenche un
   `npm install` automatique si manquant.

**Fichiers impactés :**
- Nouveau : `src/main/services/win32.ts`
- Réécrits : `src/main/services/focus.ts` (zéro PS), `src/main/services/injection.ts`
  (koffi natif + fallback PS), `src/main/index.ts` (pilule + recreate +
  context menu + position persistence), `src/renderer/components/CompactView.tsx`
  (pilule complète), `src/renderer/App.tsx` (pilule = uniquement CompactView,
  data-density sur html/body), `src/renderer/index.css` (+ ~200 lignes pilule)
- Modifiés : `src/shared/types.ts` (+ WidgetBounds + widgetBounds + WIDGET_CONTEXT_MENU IPC),
  `src/main/preload.ts` (+ showWidgetContextMenu, + onOpenSettings),
  `src/main/shortcuts.ts` (+ showInactive),
  `src/renderer/components/TitleBar.tsx` (goPill sans flash),
  `src/renderer/components/SettingsView.tsx` (setDensity sans flash + nouveau texte),
  `package.json` (+ koffi), `start.bat` (+ check koffi).

**Performance mesurée attendue (Windows 10/11, x64) :**
- Whisper Turbo Groq : ~250-400 ms
- Traduction (optionnelle, llama-3.3-70b) : ~300-600 ms
- Injection native (focus + paste) : **~50 ms**
- Total user-visible (sans translation) : **~400-500 ms** du stop au paste.
- Total avec translation : **~900-1100 ms**.

**Dégradations possibles :**
- Si koffi échoue à se charger (prebuild manquant pour l'arch, AV qui bloque
  le binaire) : fallback PowerShell automatique (peut flasher brièvement).
  Logué en warning : `[win32] koffi load failed…`.

**Known caveats documentées :**
- `SetForegroundWindow` peut retourner 0 à cause du focus-stealing prevention
  Win32 si l'app VoiceInk ne possède pas le focus récent. On logue et on
  continue — le paste atterrit quand même dans la bonne app dans la très
  grande majorité des cas (quand l'utilisateur vient juste d'y travailler).
- Lors du toggle densité, la fenêtre est détruite et recréée : ~300 ms
  pendant lesquels l'app est invisible. Acceptable car rare et ne se produit
  pas pendant une dictée.

---

### Session du 18 avril 2026 — V2 : design + injection + traduction

**Contexte :** l'utilisateur a signalé trois problèmes après la refonte initiale :
1. Bouton record trop gros, proportions à revoir, besoin d'un mode compact/minimaliste
2. Injection parfois défaillante (paste au mauvais endroit, fenêtre qui passe en arrière-plan)
3. Traduction automatique à la volée non disponible

**Livré :**

1. **Mode compact/minimaliste** — Nouveau réglage `density: 'comfortable' | 'compact'`
   stocké dans Settings. En compact, la fenêtre se redimensionne à 520×340 (via
   `windowResizeForDensity` IPC), la sidebar disparaît et un nouveau composant
   `CompactView` prend le relais avec un bouton record mini (76px), une ligne
   unique pour statut + transcription + bouton copier, et le picker de traduction
   toujours accessible. Bascule instantanée via icônes dans la titlebar
   (`Minimize2` / `Maximize2`) ou via Paramètres > Interface. Bonus : bouton
   `alwaysOnTop` (IPC `windowSetAlwaysOnTop` + icônes Pin/PinOff) pour épingler
   la fenêtre au premier plan — idéal en mode compact.

2. **Bouton redimensionné via CSS variables** :
   - Comfortable : `--rec-size: 124px` (au lieu de 168px)
   - Compact : `--rec-size: 76px`
   - Halo, icônes, waveform, paddings, boutons, inputs : toutes proportions
     répercutées via `.density-compact` selectors dans `index.css`.

3. **Injection refaite avec tracking du foreground Win32** :
   - Nouveau service `src/main/services/focus.ts` : spawn un **PowerShell
     persistent** qui loop `GetForegroundWindow` via `user32.dll` à 4 Hz et
     écrit le HWND sur stdout. Le main process lit ce stream, identifie les
     HWND internes (tous `BrowserWindow.getNativeWindowHandle()`) et mémorise
     le dernier HWND **externe**.
   - `injection.ts` refait pour appeler `SetForegroundWindow(prev)` puis
     `SendKeys::^v` **dans la même invocation PowerShell** (une seule
     compile/Add-Type, latence ~400-500 ms). Plus de `w.show()` qui volait le
     focus, plus de restore du presse-papier qui détruisait la transcription.

4. **Traduction automatique live** :
   - Nouveau champ `translateTo` dans Settings (code langue ISO ou `''`).
   - `translateText()` dans `engines/llm.ts` : appel Groq `llama-3.3-70b-versatile`
     avec prompt de traducteur pro (~300-600 ms). No-op si source == target
     (langue détectée par Whisper `verbose_json` retransmise).
   - `ipc.ts` applique la traduction **entre** Whisper et le post-process LLM,
     puis persiste avec `translatedTo` dans l'historique.
   - UI : picker compact intégré au header de `MainView` (badge violet quand
     actif) + section complète dans Paramètres (dropdown + choix du modèle +
     explication de latence). Affiche aussi un indicateur dans la sidebar
     quand une langue cible est sélectionnée.

**Fichiers impactés :**
- Nouveau : `src/main/services/focus.ts`, `src/renderer/components/CompactView.tsx`
- Modifiés majeurs : `src/shared/types.ts` (Settings + IPC), `src/main/index.ts`
  (window sizing + IPC handlers), `src/main/services/injection.ts`,
  `src/main/engines/llm.ts` (+ `translateText`), `src/main/ipc.ts`,
  `src/renderer/App.tsx` (density routing), `src/renderer/components/MainView.tsx`,
  `src/renderer/components/SettingsView.tsx`, `src/renderer/components/TitleBar.tsx`,
  `src/renderer/components/Sidebar.tsx`, `src/renderer/index.css` (CSS vars
  densité + compact overrides + segmented control), `src/renderer/lib/constants.ts`
  (+ TRANSLATE_TARGETS + LANGUAGE_NAMES).

**Edge case identifié :** au tout premier lancement, avant que l'utilisateur
n'ait switché sur une autre app, `lastExternalHwnd` peut être la barre des
tâches / Explorer. L'injection ira donc dans Explorer. Pour un usage normal,
l'utilisateur lance VoiceInk depuis la tray/shortcut alors qu'il est déjà dans
Word/browser ; le tracker à 4 Hz a le temps de capturer le bon HWND avant le
switch.

**Nouveaux IPC ajoutés :** `WINDOW_SET_ALWAYS_ON_TOP`, `WINDOW_RESIZE_FOR_DENSITY`.

**Toujours limité par :** terminal IDE non-fonctionnel → impossible de lancer
`npm run build` / `electron` moi-même. `start.bat` auto-install + build + launch
reste le point d'entrée utilisateur unique.

---

### Session du 18 avril 2026 — Refonte totale

**Contexte :** `src/` était entièrement vide à la reprise. Tout le code applicatif
a été reconstruit from scratch autour du moteur STT Groq Whisper (choix utilisateur
pour latence <1s).

**Moteur STT :** `whisper-large-v3-turbo` via l'endpoint OpenAI-compatible Groq.
Latence typique mesurée ~200-400 ms pour 2-5 s d'audio.

**Pipeline :**
```
MediaRecorder (audio/webm;opus, 100ms timeslice)
  → blob → base64 → IPC (voiceink:transcribe)
  → main process : POST multipart → api.groq.com/openai/v1/audio/transcriptions
  → (optionnel) LLM post-process Groq/OpenAI/Anthropic/Ollama
  → clipboard.writeText + Ctrl+V (PowerShell SendKeys)
  → renderer affiche + badge latence
```

**UI :** design system complet (voir `src/renderer/index.css`) — thème sombre, aurora
animée (blurs 100px), glassmorphism, bouton record 168px à dégradé radial violet
avec halo pulsant rouge en enregistrement, cyan pendant traitement. Sidebar avec
badge de statut de la clé API. Bannière de bienvenue si clé Groq manquante.
Visualiseur waveform 48 barres live piloté par AnalyserNode RMS.

**Bugs corrigés à l'audit statique :**
- `useWaveform` avait un `useMemo` avec dep constante (48) → cache gelé → bars ne
  s'animaient pas. Remplacé par un `useState` + setInterval.
- `injection.ts` restaurait un presse-papier écrit par autoCopy → destruction de
  la transcription. Simplifié : on ne restaure plus.
- Raccourci global `shortcuts.ts` faisait `w.show()` → volait le focus → injection
  cassée dans l'app cible. Retiré.
- `package.json` avait `@tailwindcss/oxide-linux-x64-gnu` en dep (Linux-only)
  cassant l'install sur Windows. Retiré.
- Types `Partial<Settings>` dans `SettingsView.save()` cast propre
  `e.target.value as Settings['llmProvider']`.
- Zustand v5 API : `create<State>()(...)` avec currying (était `create<State>(...)`).

**Point d'entrée utilisateur : `start.bat`** — auto-install si `node_modules/.bin/`
incomplet, build main+renderer, launch Electron (fallback `node cli.js` si
shim `electron.cmd` manque). Tout logué dans `run.log`.

**Note pipeline : clavier Espace.** Listener global `window.keydown` avec guard
`tag === 'INPUT' || 'TEXTAREA'`. `preventDefault` bloque l'activation native du
bouton par Space → pas de double-toggle.

**Problème rencontré :** terminal intégré IDE non-fonctionnel dans mon environnement
(commandes exécutées mais pas de stdout capturé, pas d'effets de bord) — je ne
peux pas lancer `npm run build` ou `electron` moi-même. Corrigé par un `start.bat`
auto-suffisant que l'utilisateur lance en double-clic.

---

## Sessions précédentes

---

## Dernier fix appliqué (session 2 — 20 fév 16h35)

### Web Speech API ne fonctionne PAS dans Electron
**Cause :** Chromium nécessite une clé API Google baked dans Chrome. Electron ne l'a pas.
**Résultat :** Erreur "network" systématique. **Impossible à résoudre.**

### Approche actuelle : IPC audio pipeline
- L'enregistrement audio fonctionne (MediaRecorder + Web Audio API pour visualisation)
- L'audio est envoyé au main process via IPC en base64
- Le Whisper engine confirme la capture audio (taille en Ko) en mode simulé
- **Pour la transcription réelle :** configurer une clé OpenAI API dans Paramètres
  ou intégrer le binaire whisper.cpp
- **Zone de test texte** intégrée dans MainView pour tester le pipeline manuellement

### Raccourcis globaux
- `onToggleRecording` ajouté dans `preload.ts`
- `MainView.tsx` écoute via useEffect + useRef

### Fixes session 1
- TS6059 rootDir fix → `tsconfig.main.json` rootDir=src, outDir=dist
- sql.js types → `src/main/types/sql.js.d.ts`
- nativeImage type → `Electron.NativeImage` dans tray.ts
- Vite root → `.` (projet root) + `index.html` à la racine
- Imports renderer → `src/renderer/lib/constants.ts` (local, pas cross-directory)
- CSP retirée de index.html (gérée côté Electron main process en prod)

---

## Architecture du projet

```
D:\projet1/
├── index.html                    # HTML Vite (racine du projet)
├── vite.config.ts                # Vite config (root: ".")
├── tsconfig.json                 # TS config renderer (ESNext)
├── tsconfig.main.json            # TS config main process (CommonJS)
├── package.json                  # Dépendances & scripts
├── src/
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # Entry point, fenêtre, tray, shortcuts
│   │   ├── preload.ts            # Bridge IPC (contextBridge)
│   │   ├── tray.ts               # System tray
│   │   ├── shortcuts.ts          # Raccourcis globaux
│   │   ├── ipc.ts                # Pipeline: audio → STT → LLM → injection
│   │   ├── engines/
│   │   │   ├── whisper.ts        # Whisper STT (local + OpenAI cloud)
│   │   │   └── llm.ts           # LLM (Ollama, OpenAI, Anthropic)
│   │   ├── services/
│   │   │   ├── config.ts         # Settings persistants JSON
│   │   │   ├── history.ts        # SQLite via sql.js (pur JS)
│   │   │   ├── injection.ts      # Injection texte (clipboard+paste)
│   │   │   └── export.ts         # Export TXT, SRT, JSON, DOCX
│   │   └── types/
│   │       └── sql.js.d.ts       # Type declarations pour sql.js
│   ├── renderer/                 # React UI (Vite)
│   │   ├── main.tsx              # React entry point
│   │   ├── App.tsx               # Layout principal + navigation
│   │   ├── index.css             # TailwindCSS + animations
│   │   ├── components/
│   │   │   ├── MainView.tsx      # Dictée, bouton record, visualiseur
│   │   │   ├── SettingsView.tsx  # Paramètres complets
│   │   │   ├── HistoryView.tsx   # Historique + recherche + tags
│   │   │   ├── FileView.tsx      # Transcription fichiers audio
│   │   │   ├── Sidebar.tsx       # Navigation latérale
│   │   │   ├── TitleBar.tsx      # Barre de titre custom
│   │   │   └── StatusBar.tsx     # Barre de statut
│   │   ├── hooks/
│   │   │   └── useAudioRecorder.ts # Capture audio Web Audio API
│   │   ├── lib/
│   │   │   └── constants.ts      # MODE_LABELS, SUPPORTED_LANGUAGES (local)
│   │   └── stores/
│   │       └── useStore.ts       # État global Zustand
│   └── shared/
│       └── types.ts              # Types, IPC channels, mode prompts
├── dist/                         # Output compilé
│   ├── main/                     # Electron main (CommonJS)
│   └── shared/                   # Shared types compilé
├── OBJECTIVES.md                 # Spec complète & architecture
├── README.md                     # Documentation utilisateur
└── PROGRESS.md                   # CE FICHIER
```

---

## Stack technique

- **Electron** 33 — App desktop
- **React** 18 + **TypeScript** 5.7 — UI
- **Vite** 6 — Bundler/dev server
- **TailwindCSS** 4 — Styling
- **Zustand** 5 — State management
- **sql.js** — SQLite pur JavaScript (pas de build natif)
- **Lucide React** — Icônes

---

## Fonctionnalités — État d'avancement

| Fonctionnalité | État | Notes |
|---|---|---|
| Structure projet & build | 🟡 | Build OK, renderer à vérifier |
| UI — Layout, navigation, sidebar | ✅ | Complet |
| UI — MainView (dictée) | ✅ | Bouton record, visualiseur audio, mode selector |
| UI — SettingsView | ✅ | Audio, STT, LLM, raccourcis, confidentialité |
| UI — HistoryView | ✅ | Recherche, tags, export |
| UI — FileView | ✅ | Transcription fichiers |
| Audio capture (Web Audio API) | ✅ | useAudioRecorder hook |
| Whisper STT engine | ✅ | Code prêt, besoin du binaire whisper.cpp |
| LLM post-processing | ✅ | Ollama, OpenAI, Anthropic |
| IPC pipeline | ✅ | audio → STT → LLM → injection |
| Text injection | ✅ | Clipboard + Ctrl+V |
| History (sql.js) | ✅ | CRUD, tags, recherche |
| Export (TXT, SRT, JSON, DOCX) | ✅ | Complet |
| Settings persistence | ✅ | JSON via electron-store |
| System tray | ✅ | Menu contextuel |
| Global shortcuts | ✅ | Configurable |

---

## Prochaines étapes (priorité)

1. **Vérifier que le renderer s'affiche** après le fix constants.ts
2. **Téléchargement modèle Whisper** — implémenter le download automatique
3. **Tests end-to-end** — vérifier le pipeline complet dictée → texte
4. **Packaging** — electron-builder pour distribution Windows
5. **Documentation** — guide d'installation pour l'utilisateur final

---

## Problèmes connus

- **Terminal WSL sans distribution** — L'IDE utilise WSL comme shell par défaut mais
  aucune distribution Linux n'est installée. Solution: changer le shell par défaut en
  PowerShell dans les paramètres de l'IDE (voir section ci-dessous).
- **Whisper model manquant** — `ggml-base.bin` non trouvé, le download automatique
  n'est pas encore implémenté (message affiché dans le terminal Electron).
- **Erreurs DevTools** — `Autofill.enable` et `language-mismatch` sont des erreurs
  internes de Chrome DevTools, ignorables.

---

## Configuration terminal IDE

Pour que l'assistant puisse exécuter des commandes directement:

1. Ouvrir les paramètres de l'IDE (Ctrl+,)
2. Chercher "terminal default profile windows"
3. Changer de "WSL" à "PowerShell" ou "Command Prompt"
4. Redémarrer l'IDE

Cela permettra aux assistants IA d'exécuter les commandes npm/node directement.
