# VoiceInk — Dictée Intelligente IA

> Application desktop de dictée intelligente avec transcription temps réel, post-traitement LLM et injection universelle. Clone fonctionnel de Superwhisper.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![License](https://img.shields.io/badge/license-proprietary-red)

---

## Fonctionnalités

- **Dictée temps réel** — Raccourci global, push-to-talk, écoute continue
- **Transcription offline** — Whisper.cpp local (tiny → large), GPU/CPU
- **Post-traitement LLM** — Correction, ponctuation, reformulation via Ollama/OpenAI/Anthropic
- **Injection universelle** — Collage automatique dans n'importe quelle application
- **Transcription fichiers** — MP3, WAV, M4A, MP4 avec horodatage
- **Historique chiffré** — SQLite local, recherche, tags, export
- **Modes prédéfinis** — Email, message court, notes de réunion, résumé, formel, simplifié
- **Modes personnalisables** — Prompt système custom
- **Multi-langues** — FR, EN, ES, DE, IT, PT, NL, PL, RU, JA, ZH, KO, AR
- **Export** — TXT, SRT, JSON, DOCX

## Installation

### Prérequis

- Node.js 18+
- npm 9+
- (Optionnel) Ollama installé pour le LLM local

### Développement

```bash
# Installer les dépendances
npm install

# Lancer en mode développement
npm run dev

# Dans un autre terminal, lancer Electron
npm start
```

### Build

```bash
# Build complet
npm run build

# Créer l'installeur
npm run dist
```

## Configuration

### Premier lancement

1. Lancer VoiceInk
2. Aller dans **Paramètres** → **Modèles**
3. Télécharger un modèle Whisper (recommandé : `base` pour commencer)
4. (Optionnel) Configurer un fournisseur LLM pour le post-traitement

### Raccourcis par défaut

| Action | Raccourci |
|--------|-----------|
| Démarrer/Arrêter la dictée | `Ctrl+Shift+Space` |
| Push-to-talk | `Ctrl+Shift+V` |
| Annuler | `Escape` |

### Modes de confidentialité

- **100% Local** — Aucune donnée envoyée en ligne
- **Hybride** — STT local, LLM cloud si configuré
- **Cloud** — STT et LLM cloud pour la meilleure qualité

## Architecture

```
Micro → Buffer Audio → Whisper STT → LLM Post-processing → Injection Texte → Historique
```

Voir [OBJECTIVES.md](./OBJECTIVES.md) pour la documentation technique complète.

## Stack Technique

| Composant | Technologie |
|-----------|------------|
| Desktop | Electron 33 |
| Frontend | React 18 + TypeScript |
| Styling | TailwindCSS 4 |
| STT | whisper.cpp |
| LLM | Ollama / OpenAI / Anthropic |
| Storage | better-sqlite3 |
| Icons | Lucide React |
| State | Zustand |
| Build | Vite + electron-builder |

## Licence

Propriétaire — Tous droits réservés.
