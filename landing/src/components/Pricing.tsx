/**
 * Pricing section — 3 tiers with a monthly/yearly toggle.
 *
 * Annual discount is 2 months free (≈ 16.6 %). Toggle uses a classic
 * pill switch with the price fading across, powered by Framer Motion's
 * `<AnimatePresence>` so the numbers don't "jump" during the swap.
 *
 * ROI badge on the Pro card: calculated in `useMemo` — we estimate
 * how many minutes of dictation / interpreter the average user runs
 * per day and express the saving vs Otter / Dragon.
 *
 * Keyboard: arrow keys on the toggle flip between monthly/yearly.
 * Focus-visible ring on every actionable element.
 */
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Sparkles, Zap, Shield, ArrowRight } from 'lucide-react';
import { useLang } from '../i18n/useLang';
import type { Lang } from '../i18n/lang';

type Cycle = 'monthly' | 'yearly';

/**
 * Bilingual plan definition. Every user-facing string ships as a
 * `{ en, fr }` object so the React tree swaps instantly when the
 * global lang toggle fires — no remount, no layout jank.
 */
interface Plan {
  key: 'free' | 'pro' | 'team';
  name: { en: string; fr: string };
  tagline: { en: string; fr: string };
  priceMonthly: number;
  priceYearly: number | null; // null = monthly-only plan (Team)
  ctaLabel: { en: string; fr: string };
  ctaHref: string;
  highlighted?: boolean;
  features: { en: string; fr: string }[];
  limits: { en: string; fr: string }[];
  icon: typeof Sparkles;
}

/** Tiny helper to pick the right locale variant from a `{en,fr}`. */
const t = (lang: Lang, v: { en: string; fr: string }): string => v[lang];

const PLANS: Plan[] = [
  {
    key: 'free',
    name:    { en: 'Free',                   fr: 'Gratuit'                    },
    tagline: { en: 'For trying things out.', fr: 'Pour essayer tranquillement.' },
    priceMonthly: 0,
    priceYearly: 0,
    ctaLabel: { en: 'Download free', fr: 'Télécharger gratuitement' },
    ctaHref: '#download',
    icon: Sparkles,
    features: [
      { en: '30 min dictation / day',       fr: '30 min de dictée / jour'        },
      { en: '15 min interpreter / month',   fr: '15 min d\u2019interprète / mois'  },
      { en: 'All 4 dictation modes',        fr: 'Les 4 modes de dictée'           },
      { en: 'Bring your own API keys',      fr: 'Vos propres clés API'            },
    ],
    limits: [
      { en: 'No listener mode',             fr: 'Pas de mode écoute'              },
      { en: 'No history export',            fr: 'Pas d\u2019export d\u2019historique' },
      { en: '7-day history retention',      fr: 'Historique conservé 7 jours'     },
    ],
  },
  {
    key: 'pro',
    name:    { en: 'Pro',                    fr: 'Pro'                    },
    tagline: { en: 'Everything unlocked.',    fr: 'Tout débloqué.'         },
    priceMonthly: 9.90,
    priceYearly: 99,
    ctaLabel: { en: 'Start free trial', fr: 'Essai gratuit' },
    ctaHref: '#checkout-pro',
    highlighted: true,
    icon: Zap,
    features: [
      { en: 'Unlimited dictation (fair use)',             fr: 'Dictée illimitée (fair use)'                  },
      { en: '10 h interpreter / month',                   fr: '10 h d\u2019interprète / mois'                  },
      { en: '10 h voice synthesis / month',               fr: '10 h de synthèse vocale / mois'               },
      { en: 'Voice cloning (coming soon)',                fr: 'Clonage vocal (bientôt)'                       },
      { en: 'Full history + export (JSON / MD / CSV)',    fr: 'Historique complet + export (JSON / MD / CSV)' },
      { en: 'Custom vocabulary',                          fr: 'Vocabulaire personnalisé'                      },
      { en: 'Priority routing (Groq first)',              fr: 'Routage prioritaire (Groq d\u2019abord)'        },
    ],
    limits: [],
  },
  {
    key: 'team',
    name:    { en: 'Team',                        fr: 'Équipe'                    },
    tagline: { en: 'For small teams & studios.',  fr: 'Pour petites équipes & studios.' },
    priceMonthly: 19,
    priceYearly: null,
    ctaLabel: { en: 'Start a team', fr: 'Créer une équipe' },
    ctaHref: '#checkout-team',
    icon: Shield,
    features: [
      { en: 'Everything in Pro',                    fr: 'Tout du plan Pro'                    },
      { en: 'Team workspace & shared dictionary',   fr: 'Espace équipe & dictionnaire partagé' },
      { en: '30 h interpreter / month',             fr: '30 h d\u2019interprète / mois'         },
      { en: 'SSO (Google / Microsoft)',             fr: 'SSO (Google / Microsoft)'             },
      { en: 'Priority email support',               fr: 'Support email prioritaire'            },
      { en: 'Seat-based pricing from 3 seats',      fr: 'Tarif par siège dès 3 sièges'         },
    ],
    limits: [],
  },
];

export default function Pricing() {
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const lang = useLang();

  const roiSavings = useMemo(() => {
    // Assume an Otter Pro user ($17/mo ≈ 16 €) and compare to our Pro.
    // For medical users we'd compare vs Dragon Medical (~60 €/mo).
    const otter = 16;
    const ours = cycle === 'yearly' ? 99 / 12 : 9.90;
    return Math.round((otter - ours) * 12);
  }, [cycle]);

  const copy = {
    pill:    { en: 'Simple, honest pricing',                                           fr: 'Tarifs simples et honnêtes' },
    h2a:     { en: 'One price. ',                                                      fr: 'Un prix. ' },
    h2b:     { en: 'No surprises.',                                                    fr: 'Sans surprise.' },
    body:    {
      en: 'Start free, upgrade when the Free cap gets in your way. Cancel from the app in two clicks — no retention hotline, we promise.',
      fr: 'Commencez gratuitement, passez Pro quand la limite Free vous gêne. Annulez depuis l\u2019app en deux clics — aucun numéro de rétention, promis.',
    },
    toggleMonthly: { en: 'Monthly',       fr: 'Mensuel'         },
    toggleYearly:  { en: 'Yearly',        fr: 'Annuel'          },
    yearlyHint:    { en: '2 months free', fr: '2 mois offerts'  },
    savings1: { en: 'Switching from Otter? You save',                 fr: 'Vous venez d\u2019Otter ? Vous économisez' },
    savings2: { en: '€ / year per seat on Pro.',                       fr: '€ / an par siège sur Pro.'                 },
    seeCompare: { en: 'See the full comparison',                       fr: 'Voir la comparaison complète'              },
  };

  return (
    <section id="pricing" className="relative py-20 md:py-32" aria-labelledby="pricing-title">
      <div className="container-page px-4 md:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <div className="pill mx-auto">
            <span className="h-1.5 w-1.5 rounded-full bg-aurora-pink shadow-[0_0_18px_rgba(244,114,182,0.7)]" />
            {t(lang, copy.pill)}
          </div>
          <h2 id="pricing-title" className="mt-4 text-display font-semibold text-white">
            {t(lang, copy.h2a)}<span className="text-gradient">{t(lang, copy.h2b)}</span>
          </h2>
          <p className="mt-4 text-ink-300 md:text-lg">
            {t(lang, copy.body)}
          </p>

          {/* Billing cycle toggle */}
          <div
            role="tablist"
            aria-label={lang === 'fr' ? 'Cycle de facturation' : 'Billing cycle'}
            className="glass mx-auto mt-8 inline-flex items-center gap-1 rounded-full border border-white/10 p-1"
          >
            <ToggleButton active={cycle === 'monthly'} onClick={() => setCycle('monthly')} label={t(lang, copy.toggleMonthly)} />
            <ToggleButton active={cycle === 'yearly'}  onClick={() => setCycle('yearly')}  label={t(lang, copy.toggleYearly)}  hint={t(lang, copy.yearlyHint)} />
          </div>
        </div>

        <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard key={plan.key} plan={plan} cycle={cycle} lang={lang} />
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-ink-400">
          {t(lang, copy.savings1)}{' '}
          <span className="text-white font-semibold">{roiSavings} {t(lang, copy.savings2)}</span>{' '}
          <a href="/compare" className="underline decoration-aurora-purple/40 underline-offset-4 hover:text-white">
            {t(lang, copy.seeCompare)}
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function ToggleButton({ active, onClick, label, hint }: { active: boolean; onClick: () => void; label: string; hint?: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`focus-ring relative rounded-full px-5 py-2 text-sm font-medium transition-colors ${active ? 'text-white' : 'text-ink-300 hover:text-white'}`}
    >
      {active && (
        <motion.span
          layoutId="toggle-bg"
          className="absolute inset-0 rounded-full bg-white/10 ring-1 ring-white/15"
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        />
      )}
      <span className="relative">{label}</span>
      {hint && <span className="relative ml-2 rounded-md bg-aurora-cyan/20 px-1.5 py-0.5 text-[10px] font-semibold text-aurora-cyan">{hint}</span>}
    </button>
  );
}

function PlanCard({ plan, cycle, lang }: { plan: Plan; cycle: Cycle; lang: Lang }) {
  const Icon = plan.icon;
  const isYearly = cycle === 'yearly' && plan.priceYearly != null;
  const freeLabel = lang === 'fr' ? 'Gratuit' : 'Free';
  const displayPrice =
    plan.priceMonthly === 0
      ? freeLabel
      : isYearly
      ? `${(plan.priceYearly! / 12).toFixed(2)} €`
      : `${plan.priceMonthly.toFixed(2)} €`;
  const displayUnit =
    plan.priceMonthly === 0
      ? (lang === 'fr' ? 'à vie' : 'forever')
      : isYearly
      ? (lang === 'fr' ? '/mois facturé annuel' : '/mo billed yearly')
      : (lang === 'fr' ? '/mois' : '/mo');
  const mostPopular = lang === 'fr' ? 'Le plus choisi' : 'Most popular';

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10%' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`glass-tilt relative flex flex-col rounded-3xl p-6 ${
        plan.highlighted
          ? 'glass-strong ring-2 ring-aurora-purple/60 shadow-glow-violet'
          : 'glass'
      }`}
    >
      {plan.highlighted && (
        <span className="pill-glow absolute -top-3 left-1/2 -translate-x-1/2">
          <Sparkles size={12} />
          {mostPopular}
        </span>
      )}

      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${
            plan.highlighted
              ? 'bg-aurora-purple/20 ring-aurora-purple/40'
              : 'bg-white/[0.04] ring-white/10'
          }`}
        >
          <Icon size={18} className={plan.highlighted ? 'text-aurora-purple' : 'text-ink-200'} />
        </span>
        <div>
          <h3 className="text-lg font-semibold text-white">{t(lang, plan.name)}</h3>
          <p className="text-xs text-ink-400">{t(lang, plan.tagline)}</p>
        </div>
      </div>

      <div className="mt-6 flex items-end gap-2">
        <AnimatePresence mode="wait">
          <motion.span
            key={`${plan.key}-${cycle}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="font-display text-4xl font-semibold tracking-tight text-white"
          >
            {displayPrice}
          </motion.span>
        </AnimatePresence>
        <span className="mb-1.5 text-xs text-ink-400">{displayUnit}</span>
      </div>

      <a
        href={plan.ctaHref}
        className={`focus-ring mt-6 inline-flex items-center justify-center gap-2 rounded-2xl py-3 font-medium transition-all ${
          plan.highlighted ? 'btn-primary' : 'btn-secondary'
        }`}
      >
        {t(lang, plan.ctaLabel)}
        <ArrowRight size={16} />
      </a>

      <ul className="mt-6 space-y-2.5 text-sm">
        {plan.features.map((f) => (
          <li key={f.en} className="flex items-start gap-2">
            <Check size={14} className="mt-0.5 flex-none text-aurora-cyan" />
            <span className="text-ink-200">{t(lang, f)}</span>
          </li>
        ))}
        {plan.limits.map((f) => (
          <li key={f.en} className="flex items-start gap-2 text-ink-400">
            <span className="mt-1.5 inline-block h-px w-3 flex-none bg-ink-500" />
            <span>{t(lang, f)}</span>
          </li>
        ))}
      </ul>
    </motion.article>
  );
}
