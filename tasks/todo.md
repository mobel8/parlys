# Fix : micro « zombie » après veille/idle + mots hallucinés (« Merci. »)

## Symptômes rapportés (2026-07-08)
1. Parfois la parole n'est pas détectée (surtout après une longue période sans
   utilisation, ou juste après l'ouverture). Le contournement utilisateur :
   basculer compact → confortable → compact (= recréation de fenêtre = pipeline
   audio neuf).
2. Des mots jamais prononcés apparaissent (« merci », etc.), parfois sans même
   parler.

## Causes racines identifiées
- `useAudioRecorder` garde un pipeline PCM chaud en continu mais ne vérifie
  jamais que des échantillons ARRIVENT : après veille Windows / changement de
  périphérique / AudioContext suspendu, `stream.active` reste true et
  `ensureWarm()` early-return → pipeline mort en silence. `stop()` découpe
  alors ~1 s de ring buffer PÉRIMÉ (writeCount gelé) et l'expédie à Whisper →
  hallucination sur silence/vieux audio. Pire : si writeCount est gelé,
  `count === 0` → return silencieux → pilule bloquée en état « recording ».
- Aucune barrière « y a-t-il de la parole ? » avant l'appel API : un appui
  sans parole expédie le pré-roll (≥1 s de silence) → Whisper hallucine
  (« Merci. » est LE token silence français classique).
- `applySegmentFilter` (whisper.ts) est fail-open : si TOUS les segments sont
  jugés hallucinés (no_speech_prob…), il renvoie quand même le texte complet
  en comptant sur le regex scrubber — qui ne couvre pas « Merci. » nu.
- `postProcess` LLM tourne même sur texte vide (modes non-raw).

## Plan
- [x] Analyse complète du projet (pipelines, fenêtres, IPC, cleanup)
- [x] `src/shared/speech-gate.ts` (NOUVEAU) : DSP pur testable — RMS par
      trame 30 ms, plancher de bruit adaptatif (percentile), détection
      parole (durée cumulée + tenue vocale), trim tête/queue avec marges.
- [x] `useAudioRecorder.ts` : liveness (timestamp du dernier onaudioprocess),
      `ensureLive()` au start, watchdog 2 s (idle + capture + flux mort +
      saut d'horloge = veille), track.ended/mute + devicechange +
      systemResumed, gate anti-silence + trim dans stop(), onDrop (plus
      aucun retour silencieux), hooks d'audit + flag A/B.
- [x] `CompactView.tsx` / `MainView.tsx` : onDrop + stats.
- [x] `whisper.ts` : fail-closed quand tous les segments sont filtrés.
- [x] `ipc.ts` : skip postProcess sur texte vide ; stats loggées + audioMs
      réel dans l'historique.
- [x] `types.ts` + `validate.ts` : champs optionnels audioMs/speechMs.
- [x] `index.ts` (main) : powerMonitor → `parlys:systemResumed` ;
      PARLYS_USERDATA ; PARLYS_FAKE_AUDIO ; PARLYS_AUDIT / PARLYS_AUDIO_HEAL.
- [x] `preload.ts` : onSystemResumed.
- [x] Build (tsc main + typecheck renderer + vite) : 0 erreur.
- [x] Tests unitaires : 14/14 speech-gate + 11/11 filtre hallucinations
      (contre dist/ compilé).
- [x] E2E `scripts/_e2e-mic.js` : 17/17 sur le build exact.
- [x] Captures (_audit-mic/shots/) + rapport (_audit-mic/e2e-report.json).

## Review

**Causes racines confirmées et corrigées.**

1. *Zombie mic* : S0 (baseline, auto-guérison désactivée) reproduit le bug
   mécaniquement : `kill('suspend')` (équivalent post-veille) → ticks gelés,
   rien ne le détecte, l'utilisateur « enregistre » 2,5 s pendant lesquelles
   **zéro échantillon** arrive (tickCount 59 → 59), et stop() expédie quand
   même 1 s de ring PÉRIMÉ que Groq transcrit (« Ceci est un test. » — des
   mots jamais prononcés pendant cette capture). C'est exactement le duo de
   symptômes rapporté (rien détecté + mots inventés).
2. *Avec le fix* : S4a (suspend) → watchdog ranime en < 6 s (resume), S4b
   (périphérique mort) → reconstruction complète (rebuilds=1), et la dictée
   qui suit marche dans les deux cas. S1 : parole réelle transcrite mot pour
   mot. S2/S3 : silence et bruit sont bloqués LOCALEMENT (zéro appel API,
   pilule « Aucune parole détectée ») — la source n° 1 du « Merci. » fantôme
   est morte.
3. Filtre serveur fail-closed + LLM jamais appelé sur texte vide = double
   filet pour les clips limites qui passeraient la barrière client.

**Résultats** : build 0 erreur ; 25/25 unit ; 17/17 e2e ; captures écran
S1 « Injecté » (vert), S2/S3 « Aucune parole détectée » (ambre), S0/S4
états morts/ranimés. App utilisateur relancée sur le nouveau build.

**Risque résiduel accepté** : un locuteur TRÈS faible (RMS crête < ~0,01 sur
un micro déjà à 100 %) pourrait se voir répondre « Aucune parole détectée »
au lieu d'une transcription approximative ; le message explique quoi
corriger, et les seuils (plancher absolu 0,009, plafond adaptatif 0,045)
sont volontairement permissifs. Les logs `[recorder] ship/drop` donnent
toutes les stats pour re-calibrer au besoin.
