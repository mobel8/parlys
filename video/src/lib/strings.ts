/**
 * i18n string table for every narrated piece of copy in the promo.
 *
 * Keep strings SHORT so they fit the animation windows — typewriter
 * speeds are tuned for ~60-char lines. If you exceed that, the text
 * will still render but the timing will feel off.
 *
 * NEVER change the *key structure* without also updating every scene
 * that consumes it — TypeScript will complain, but only on the code
 * that directly references the key you broke.
 */
export type Lang = 'en' | 'fr';

export const STRINGS = {
  en: {
    intro: {
      pill: 'Desktop app · Windows · macOS · Linux',
    },
    tagline: {
      l1: 'Speak once.',
      l2: 'The world understands.',
      l3: 'Instantly.',
      sub: 'Sub-400 ms voice-to-voice · 30+ languages',
    },
    problem: {
      eyebrow: 'The category is slow.',
      championName: 'VoiceInk',
      championTagline: 'The same pipeline, obsessed with latency.',
      latencyLabel: 'Voice-to-voice latency',
      badge: '3.2× faster',
    },
    pipeline: {
      eyebrow: "How it's possible",
      title: 'Four best-in-class models, stitched tight.',
      stepPrefix: 'Step',
      steps: ['Listen', 'Transcribe', 'Translate', 'Speak'],
      totalLabel: 'Total voice-to-voice',
    },
    interpreter: {
      eyebrow: 'Real-time interpreter',
      title: 'Speak French. Be heard in English. Instantly.',
      source: "Peux-tu livrer le refactor d\u2019authentification avant vendredi pour que la QA ait le week-end complet\u00a0?",
      target: 'Can you ship the auth refactor before Friday so QA has a full weekend?',
      stages: ['Listen', 'Interpret', 'Speak'],
      heardLabel: 'Heard',
      spokenLabel: 'Spoken · your voice',
      latencyBadge: '380 ms · voice-to-voice',
    },
    clone: {
      eyebrow: 'Voice cloning',
      title1: 'Your voice.',
      title2: '30 languages.',
      caption1: 'Clone your voice in 30 seconds',
      caption2: 'Dub anywhere forever',
    },
    pill: {
      eyebrow: 'Pill mode',
      title: 'Always on top. Never in the way.',
      transcript: 'PR up in 10 minutes. Covers token refresh, logout cookie cleanup, and 12 new edge-case tests. No breaking changes.',
      listening: 'Listening\u2026',
      sent: 'Sent',
      hotkey: 'Ctrl+Alt+Space',
      caption: '176 × 52 px · transparent · always on top',
    },
    stats: {
      eyebrow: 'The numbers',
      title1: 'Four reasons.',
      title2: 'No fluff.',
      labels: [
        'Voice-to-voice latency',
        'Supported languages',
        'Price to get started',
        'Dictations per week',
      ],
      users: ' users',
    },
    pricing: {
      eyebrow: 'Simple, honest pricing',
      title1: 'One price.',
      title2: 'No surprises.',
      popular: 'Most popular',
      plans: [
        { name: 'Free',  price: '0',    unit: '€ · forever',          cta: 'Download free',      sub: 'For trying things out',
          bullets: ['15 h dictation / month', '15 min interpreter / month', 'All 4 dictation modes', 'Bring your own API keys'] },
        { name: 'Pro',   price: '9.90', unit: '€ · per month',        cta: 'Start 7-day trial',  sub: 'Everything unlocked',
          bullets: ['Unlimited dictation', '10 h interpreter / month', 'Voice cloning (Q3 2026)', 'Custom vocabulary', 'Priority routing'] },
        { name: 'Team',  price: '19',   unit: '€ · per seat / mo',    cta: 'Start a team',       sub: 'For small teams & studios',
          bullets: ['Everything in Pro', '30 h interpreter / month', 'Shared team dictionary', 'SSO (Google · Microsoft)'] },
      ],
      footnote: 'Cancel in two clicks.',
      footnoteStrong: 'No retention hotline, we promise.',
    },
    cta: {
      title: 'Ready to never type again?',
      sub: 'Free forever. No credit card.',
      subStrong: '8 MB download.',
      button: 'Download VoiceInk Free',
      url: 'voiceink.app',
      footer: 'Built in Paris · Used in 47 countries',
    },
  },
  fr: {
    intro: {
      pill: 'App desktop · Windows · macOS · Linux',
    },
    tagline: {
      l1: 'Parlez une fois.',
      l2: 'Le monde comprend.',
      l3: 'Instantanément.',
      sub: 'Moins de 400 ms voix-à-voix · 30+ langues',
    },
    problem: {
      eyebrow: 'Le marché est lent.',
      championName: 'VoiceInk',
      championTagline: 'Le même pipeline, obsédé par la latence.',
      latencyLabel: 'Latence voix-à-voix',
      badge: '3,2× plus rapide',
    },
    pipeline: {
      eyebrow: 'Comment c\'est possible',
      title: 'Quatre modèles state-of-the-art, soudés serré.',
      stepPrefix: 'Étape',
      steps: ['Écouter', 'Transcrire', 'Traduire', 'Parler'],
      totalLabel: 'Total voix-à-voix',
    },
    interpreter: {
      eyebrow: 'Interprète temps réel',
      title: 'Parlez anglais. Soyez entendu en français. Instantanément.',
      source: 'Can you ship the auth refactor before Friday so QA has a full weekend?',
      target: "Peux-tu livrer le refactor d\u2019authentification avant vendredi pour que la QA ait le week-end complet\u00a0?",
      stages: ['Écoute', 'Interprète', 'Parle'],
      heardLabel: 'Entendu',
      spokenLabel: 'Parlé · votre voix',
      latencyBadge: '380 ms · voix-à-voix',
    },
    clone: {
      eyebrow: 'Clonage de voix',
      title1: 'Votre voix.',
      title2: '30 langues.',
      caption1: 'Clonez votre voix en 30 secondes',
      caption2: 'Dubbez partout, pour toujours',
    },
    pill: {
      eyebrow: 'Mode Pilule',
      title: 'Toujours au-dessus. Jamais dans le chemin.',
      transcript: 'PR prête dans 10 minutes. Couvre le refresh token, le nettoyage du cookie de déconnexion, et 12 nouveaux tests sur les cas limites. Zéro breaking change.',
      listening: 'À l\'écoute\u2026',
      sent: 'Envoyé',
      hotkey: 'Ctrl+Alt+Espace',
      caption: '176 × 52 px · transparent · toujours au-dessus',
    },
    stats: {
      eyebrow: 'Les chiffres',
      title1: 'Quatre raisons.',
      title2: 'Sans blabla.',
      labels: [
        'Latence voix-à-voix',
        'Langues supportées',
        'Prix pour commencer',
        'Dictées par semaine',
      ],
      users: ' utilisateurs',
    },
    pricing: {
      eyebrow: 'Tarifs simples et honnêtes',
      title1: 'Un prix.',
      title2: 'Aucune surprise.',
      popular: 'Le plus populaire',
      plans: [
        { name: 'Gratuit', price: '0',    unit: '€ · pour toujours',   cta: 'Télécharger',        sub: 'Pour essayer',
          bullets: ['15 h de dictée / mois', '15 min d\'interprète / mois', 'Les 4 modes de dictée', 'Vos propres clés API'] },
        { name: 'Pro',     price: '9,90', unit: '€ · par mois',        cta: 'Essai 7 jours',      sub: 'Tout est débloqué',
          bullets: ['Dictée illimitée', '10 h d\'interprète / mois', 'Clonage de voix (T3 2026)', 'Vocabulaire personnalisé', 'Routage prioritaire'] },
        { name: 'Équipe',  price: '19',   unit: '€ · par siège / mois',cta: 'Créer une équipe',   sub: 'Pour petites équipes & studios',
          bullets: ['Tout Pro', '30 h d\'interprète / mois', 'Dictionnaire d\'équipe partagé', 'SSO (Google · Microsoft)'] },
      ],
      footnote: 'Annulation en deux clics.',
      footnoteStrong: 'Pas de service de rétention, promis.',
    },
    cta: {
      title: 'Prêt à ne plus jamais taper ?',
      sub: 'Gratuit pour toujours. Sans carte bancaire.',
      subStrong: 'Téléchargement de 8 Mo.',
      button: 'Télécharger VoiceInk',
      url: 'voiceink.app',
      footer: 'Conçu à Paris · Utilisé dans 47 pays',
    },
  },
} as const;

export type Strings = typeof STRINGS['en'];
