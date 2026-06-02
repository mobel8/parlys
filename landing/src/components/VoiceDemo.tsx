/**
 * VoiceDemo — the interactive "proof" widget next to the hero headline.
 *
 * It's a *visual simulation* of the Parlys pipeline, driven by a
 * canned script that cycles every 9s. Why simulated and not a real
 * backend call?
 *   - The landing ships on a CDN (static), no live API on page load.
 *   - Even with a live API, the first-paint budget is < 500 ms; a
 *     real TTS call costs 300-700 ms. A scripted demo keeps the first
 *     impression snappy while still showing exactly what the product
 *     does.
 *
 * Stages cycle through:
 *   1. IDLE            — "Hold space to dictate" pulse
 *   2. LISTENING       — blue wave animation + live transcript
 *   3. INTERPRETING    — spinner + partial translation
 *   4. SPEAKING        — waveform + fade-in of final audio caption
 *
 * Framer Motion orchestrates the transitions. We use `LayoutGroup`
 * so the height morph between stages doesn't jank.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Languages, Volume2, Zap } from 'lucide-react';
import { useLang } from '../i18n/useLang';

const STORYBOARD = [
  {
    id: 'ml-team',
    spokenLang:  'English',
    spokenFlag:  '🇬🇧',
    spoken:      'Can you ship the auth refactor before Friday so QA has a full weekend?',
    targetLang:  'Français',
    targetFlag:  '🇫🇷',
    translated:  'Peux-tu livrer le refactor d\u2019authentification avant vendredi pour que la QA ait le week-end complet ?',
    latencyMs:   372,
  },
  {
    id: 'doctor',
    spokenLang:  'Français',
    spokenFlag:  '🇫🇷',
    spoken:      'Patient suivi depuis 2021 pour HTA, introduction lisinopril 10 mg, contrôle dans 6 semaines.',
    targetLang:  'English',
    targetFlag:  '🇬🇧',
    translated:  'Patient followed since 2021 for hypertension; introducing lisinopril 10 mg, follow-up in 6 weeks.',
    latencyMs:   348,
  },
  {
    id: 'travel',
    spokenLang:  'English',
    spokenFlag:  '🇬🇧',
    spoken:      'Hi! Could we get a table for two on the terrace around eight?',
    targetLang:  'Español',
    targetFlag:  '🇪🇸',
    translated:  '¡Hola! ¿Podríamos conseguir una mesa para dos en la terraza alrededor de las ocho?',
    latencyMs:   391,
  },
] as const;

type Stage = 'idle' | 'listening' | 'interpreting' | 'speaking';

export default function VoiceDemo() {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>('idle');
  const [typedSpoken, setTypedSpoken] = useState('');
  const [typedTranslated, setTypedTranslated] = useState('');
  const timers = useRef<number[]>([]);

  const script = STORYBOARD[index];

  useEffect(() => {
    // Guard against infinite setState loops when the component unmounts
    // mid-schedule (e.g. user scrolls away while a timer is queued).
    let cancelled = false;
    const schedule = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => { if (!cancelled) fn(); }, ms);
      timers.current.push(t);
    };

    const runCycle = () => {
      setStage('idle');
      setTypedSpoken('');
      setTypedTranslated('');

      schedule(() => setStage('listening'), 900);

      // Type the spoken transcript one word at a time (~35 ms/word).
      script.spoken.split(' ').forEach((word, i) => {
        schedule(() => {
          setTypedSpoken((prev) => (prev ? `${prev} ${word}` : word));
        }, 900 + 120 + i * 55);
      });

      const typeDoneAt = 900 + 120 + script.spoken.split(' ').length * 55 + 200;

      schedule(() => setStage('interpreting'), typeDoneAt);
      schedule(() => setStage('speaking'),     typeDoneAt + 500);

      // Type the translated version.
      script.translated.split(' ').forEach((word, i) => {
        schedule(() => {
          setTypedTranslated((prev) => (prev ? `${prev} ${word}` : word));
        }, typeDoneAt + 600 + i * 45);
      });

      const totalTime = typeDoneAt + 600 + script.translated.split(' ').length * 45 + 1400;

      // Advance to the next script.
      schedule(() => setIndex((i) => (i + 1) % STORYBOARD.length), totalTime);
    };

    runCycle();
    return () => {
      cancelled = true;
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="glass-strong relative mx-auto max-w-md rounded-3xl p-5 md:p-6 shadow-glass"
    >
      {/* Orbiting glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-4 -z-10 rounded-[32px] opacity-60"
        style={{
          background:
            'conic-gradient(from 180deg at 50% 50%, rgba(167,139,250,0.25), rgba(34,211,238,0.25), rgba(244,114,182,0.25), rgba(167,139,250,0.25))',
          filter: 'blur(28px)',
        }}
      />

      {/* Window chrome — pretends the demo is a floating app window,
          reinforcing "Parlys is a real desktop product". */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        </div>
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-ink-400">
          <Zap size={11} className="text-aurora-cyan" />
          Parlys Live
        </div>
      </div>

      {/* Stage indicator row */}
      <StageRow stage={stage} />

      {/* Transcript block */}
      <div className="mt-4 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
        <LabelRow flag={script.spokenFlag} lang={script.spokenLang} hintEn="Heard" hintFr="Entendu" />
        <AnimatePresence mode="wait">
          <motion.p
            key={`spoken-${script.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-1 min-h-[1.75rem] text-sm text-white"
          >
            {typedSpoken}
            {(stage === 'listening' || stage === 'idle') && (
              <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-aurora-cyan" />
            )}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="my-3 flex items-center gap-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        <Languages size={14} className="text-aurora-purple" />
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      </div>

      <div className="rounded-2xl border border-aurora-purple/30 bg-aurora-purple/[0.06] p-4">
        <LabelRow flag={script.targetFlag} lang={script.targetLang} hintEn="Spoken" hintFr="Parlé" />
        <AnimatePresence mode="wait">
          <motion.p
            key={`translated-${script.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-1 min-h-[2.5rem] text-sm font-medium text-white"
          >
            {typedTranslated}
            {stage === 'speaking' && <span className="ml-1 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-aurora-pink" />}
          </motion.p>
        </AnimatePresence>
        {stage === 'speaking' && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-300">
            <Volume2 size={12} className="text-aurora-pink" />
            <Waveform />
            <span className="tabular-nums">{script.latencyMs} ms</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StageRow({ stage }: { stage: Stage }) {
  const lang = useLang();
  // Stage labels are tiny pills users glance at. We translate them
  // via a lookup keyed on the active locale to avoid re-allocating
  // the array on every render.
  const items: { key: Stage; label: string }[] = [
    { key: 'listening',    label: lang === 'fr' ? 'Écouter'   : 'Listen'    },
    { key: 'interpreting', label: lang === 'fr' ? 'Traduire'  : 'Translate' },
    { key: 'speaking',     label: lang === 'fr' ? 'Parler'    : 'Speak'     },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {items.map(({ key, label }) => {
        const active = stage === key;
        const done =
          (key === 'listening' && (stage === 'interpreting' || stage === 'speaking')) ||
          (key === 'interpreting' && stage === 'speaking');
        return (
          <motion.div
            key={key}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              active
                ? 'border-aurora-cyan/40 bg-aurora-cyan/10 text-aurora-cyan'
                : done
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : 'border-white/5 bg-white/[0.02] text-ink-400'
            }`}
            animate={active ? { scale: [1, 1.04, 1] } : { scale: 1 }}
            transition={{ duration: 0.9, repeat: active ? Infinity : 0, ease: 'easeInOut' }}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-aurora-cyan' : done ? 'bg-emerald-400' : 'bg-white/20'}`} />
            {label}
          </motion.div>
        );
      })}
    </div>
  );
}

function LabelRow({
  flag, lang: spokenLang, hintEn, hintFr,
}: {
  flag: string;
  lang: string;
  hintEn: string;
  hintFr: string;
}) {
  const uiLang = useLang();
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-ink-400">
      <span className="text-base leading-none">{flag}</span>
      <span>{spokenLang}</span>
      <span className="h-1 w-1 rounded-full bg-white/30" />
      <span className="text-ink-400/80">{uiLang === 'fr' ? hintFr : hintEn}</span>
    </div>
  );
}

function Waveform() {
  return (
    <div className="flex items-end gap-[2px]">
      {Array.from({ length: 14 }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full bg-aurora-pink/70"
          animate={{ height: [4, 12 + (i % 4) * 4, 4] }}
          transition={{
            duration: 0.9 + (i % 3) * 0.12,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.06,
          }}
        />
      ))}
    </div>
  );
}
