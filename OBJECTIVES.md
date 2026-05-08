# VoiceInk - Dictée Intelligente IA

> Clone fonctionnel de Superwhisper — Application desktop de dictée intelligente avec transcription temps réel, post-traitement LLM et injection universelle.

---

## 🎯 Vision Produit

Application de dictée IA universelle desktop-first :
- Capture audio temps réel
- Transcription instantanée (STT)
- Post-traitement intelligent via LLM
- Insertion automatique dans n'importe quel champ texte
- Fonctionnement offline prioritaire
- Extension cloud facultative

**Principes** : Minimaliste, ultra rapide, invisible en arrière-plan, activable par raccourci global.

---

## 🏗️ Architecture Technique

### Stack Choisie

| Couche | Technologie | Justification |
|--------|------------|---------------|
| Desktop Framework | **Electron 28+** | Cross-platform, écosystème mature, accès natif |
| Frontend | **React 18 + TypeScript** | Composants réactifs, typage fort |
| Styling | **TailwindCSS + shadcn/ui** | Design moderne, minimal |
| STT Local | **whisper.cpp** (via addon natif) | Whisper optimisé C++, GPU/CPU |
| STT Cloud | **OpenAI Whisper API** | Fallback haute qualité |
| LLM Local | **Ollama** (API locale) | Simple, supporte llama, mistral, etc. |
| LLM Cloud | **OpenAI / Anthropic API** | Options cloud avancées |
| Base de données | **better-sqlite3** + chiffrement | Stockage local rapide et sécurisé |
| Audio | **Web Audio API + NAudiodon** | Capture audio native |
| OS Integration | **@nut-tree/nut-js** | Injection clavier cross-platform |
| Build | **electron-builder** | Installeurs Windows/Mac/Linux |
| Updates | **electron-updater** | Mises à jour automatiques |

### Pipeline de Traitement

```
Micro → Buffer Audio → VAD (détection voix) → Whisper STT → LLM Post-processing → Injection Texte → Historique
```

### Architecture des Processus

```
┌─────────────────────────────────────────────┐
│                 Main Process                 │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Tray    │ │ Global   │ │ IPC Bridge   │ │
│  │ Manager │ │ Shortcuts│ │              │ │
│  └─────────┘ └──────────┘ └──────────────┘ │
│  ┌─────────────┐ ┌────────────────────────┐ │
│  │ Whisper     │ │ OS Integration         │ │
│  │ Engine      │ │ (keyboard injection)   │ │
│  └─────────────┘ └────────────────────────┘ │
│  ┌─────────────┐ ┌────────────────────────┐ │
│  │ LLM Engine  │ │ Storage / History      │ │
│  └─────────────┘ └────────────────────────┘ │
└─────────────────────────────────────────────┘
         ▲ IPC ▼
┌─────────────────────────────────────────────┐
│              Renderer Process                │
│  ┌─────────────────────────────────────────┐ │
│  │ React UI (Main Window)                  │ │
│  │  - Recording controls                   │ │
│  │  - Mode selector                        │ │
│  │  - Language selector                    │ │
│  │  - Settings panel                       │ │
│  │  - History panel                        │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

## 📋 Fonctionnalités

### A. Dictée Temps Réel
- [x] Raccourci clavier global configurable
- [x] Mode push-to-talk
- [x] Mode écoute continue
- [x] Détection automatique fin de phrase (VAD)
- [x] Support multi-langues
- [ ] Détection automatique de langue

### B. Transcription Offline
- [x] Whisper.cpp local (tiny, base, small, medium, large)
- [x] Optimisation GPU si disponible
- [x] Fallback CPU
- [x] Choix du modèle (rapide / précis / large)

### C. Post-traitement LLM
- [x] Correction grammaticale automatique
- [x] Ponctuation intelligente
- [x] Modes prédéfinis :
  - Texte brut
  - Email professionnel
  - Message court
  - Notes de réunion
  - Résumé
  - Reformulation formelle
  - Reformulation simplifiée
- [x] Modes personnalisables (prompt système custom)
- [x] Température ajustable
- [x] Streaming tokens

### D. Insertion Universelle
- [x] Collage automatique à la position du curseur
- [x] Compatible : navigateurs, IDE, bureautique, messageries
- [x] API natives clavier (nut-js)

### E. Transcription Fichiers
- [x] Upload audio (mp3, wav, m4a, mp4)
- [x] Transcription complète avec horodatage
- [x] Export : txt, docx, srt, json

### F. Historique
- [x] Stockage local chiffré (SQLite)
- [x] Recherche full-text
- [x] Tagging
- [x] Export
- [x] Suppression sécurisée

---

## 🎨 Interface Utilisateur

### Structure
1. **System Tray** : icône, activation rapide, accès paramètres/historique
2. **Fenêtre principale** : design minimal, sections recording/mode/langue/settings/historique
3. **Overlay flottant** : indicateur d'enregistrement discret

### Paramètres
- **Audio** : micro sélectionnable, sensibilité, noise reduction, gain auto
- **Modèles** : STT local/cloud, LLM local/cloud
- **Raccourcis** : global personnalisable, push-to-talk
- **Confidentialité** : mode 100% local / hybride / cloud

---

## 🔒 Sécurité & Confidentialité
- Aucun envoi cloud par défaut
- Chiffrement local AES-256
- Permissions micro strictes
- Transparence modèles utilisés

## ⚡ Performance
- Latence cible : < 500ms
- Optimisation GPU (CUDA/Metal)
- Quantization modèles (Q4/Q5)
- Lazy loading composants

## 💰 Business Model
- Version gratuite : 10 min/jour, modèle tiny uniquement
- Pro mensuel : illimité, tous modèles, cloud
- Paiement unique : licence perpétuelle
- API key utilisateur pour LLM externes

---

## 📁 Structure du Projet

```
voiceink/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── index.ts           # Entry point
│   │   ├── tray.ts            # System tray
│   │   ├── shortcuts.ts       # Global shortcuts
│   │   ├── ipc.ts             # IPC handlers
│   │   ├── engines/
│   │   │   ├── whisper.ts     # Whisper STT engine
│   │   │   ├── llm.ts         # LLM processing engine
│   │   │   └── audio.ts       # Audio capture engine
│   │   ├── services/
│   │   │   ├── injection.ts   # Text injection (OS level)
│   │   │   ├── history.ts     # History/storage service
│   │   │   ├── export.ts      # Export service
│   │   │   └── config.ts      # Configuration service
│   │   └── utils/
│   ├── renderer/              # React frontend
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Recording.tsx
│   │   │   ├── ModeSelector.tsx
│   │   │   ├── LanguageSelector.tsx
│   │   │   ├── Settings.tsx
│   │   │   ├── History.tsx
│   │   │   └── Overlay.tsx
│   │   ├── hooks/
│   │   ├── stores/
│   │   └── styles/
│   └── shared/                # Shared types
│       └── types.ts
├── assets/                    # Icons, sounds
├── models/                    # Local AI models
├── OBJECTIVES.md              # This file
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── electron-builder.yml
└── README.md
```

---

## 🚀 Phases de Développement

### Phase 1 - Core MVP
1. Scaffold Electron + React + TypeScript
2. Audio capture engine
3. Whisper STT integration
4. Basic LLM post-processing
5. Text injection
6. Minimal UI

### Phase 2 - Features
7. History system
8. File transcription
9. Export system
10. Full settings UI

### Phase 3 - Polish
11. System tray & overlay
12. Packaging & installer
13. Documentation
14. Business logic (limits, licensing)
