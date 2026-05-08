import { useEffect, useMemo, useRef } from 'react';
import { X, Sparkles, Wrench, Bug, Plus } from 'lucide-react';

/**
 * Renders the CHANGELOG.md contents as a polished in-app dialog.
 *
 * We deliberately parse a SMALL, PREDICTABLE subset of Markdown rather
 * than pulling in `marked` / `remark` — the changelog format is
 * enforced by us, not user-generated, so we know exactly which
 * constructs to support:
 *
 *   # Changelog                   → ignored (we render our own title)
 *   ## [X.Y.Z] — YYYY-MM-DD       → version card header
 *   ### Ajouté | Modifié | Corrigé → category inside a version card
 *   - bullet                      → bullet point
 *     - nested bullet             → nested bullet (2-space indent)
 *   **bold**                      → <strong>
 *   `code`                        → <code>
 *   ---                           → separator between versions
 *   plain text line               → paragraph
 *
 * Anything the parser doesn't recognise falls through as plain text,
 * so an unknown Markdown construct never crashes the dialog.
 */

type Category = 'added' | 'changed' | 'fixed' | 'other';

interface Entry {
  kind: 'bullet' | 'nested' | 'paragraph';
  text: string;
}

interface Section {
  category: Category;
  title: string;
  entries: Entry[];
}

interface Version {
  version: string;
  date: string;
  sections: Section[];
  intro: string[]; // paragraph text between the version header and the first "### " category
}

function detectCategory(title: string): Category {
  const t = title.toLowerCase();
  if (t.includes('ajout')) return 'added';
  if (t.includes('modifi') || t.includes('changed')) return 'changed';
  if (t.includes('corrig') || t.includes('fix')) return 'fixed';
  return 'other';
}

function parseChangelog(md: string): Version[] {
  const lines = md.split(/\r?\n/);
  const versions: Version[] = [];
  let currentVersion: Version | null = null;
  let currentSection: Section | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // New version header: `## [1.1.0] — 2026-04-21`
    const versionMatch = line.match(/^##\s+\[([^\]]+)\]\s*[—–-]?\s*(.*)$/);
    if (versionMatch) {
      currentVersion = {
        version: versionMatch[1],
        date: versionMatch[2].trim(),
        sections: [],
        intro: [],
      };
      currentSection = null;
      versions.push(currentVersion);
      continue;
    }

    // Outside any version section (top-of-file preamble, footer, `---`):
    // swallow silently — we already render our own dialog chrome.
    if (!currentVersion) continue;

    // New category header: `### Ajouté`
    const sectionMatch = line.match(/^###\s+(.*)$/);
    if (sectionMatch) {
      currentSection = {
        category: detectCategory(sectionMatch[1]),
        title: sectionMatch[1].trim(),
        entries: [],
      };
      currentVersion.sections.push(currentSection);
      continue;
    }

    // Bullets. We care about two indent levels only.
    const bulletMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length;
      const text = bulletMatch[2];
      const kind: Entry['kind'] = indent >= 2 ? 'nested' : 'bullet';
      if (!currentSection) {
        // Bullets before any "### " go into an implicit "other" section.
        currentSection = { category: 'other', title: '', entries: [] };
        currentVersion.sections.push(currentSection);
      }
      currentSection.entries.push({ kind, text });
      continue;
    }

    // Horizontal rule — ignored; it's decoration in the source file.
    if (/^---+\s*$/.test(line)) continue;
    // Italic-only footer lines (`*...*`) — treated as intro paragraph.
    if (/^\*[^*].*\*$/.test(line)) continue;

    // Plain text paragraph inside a version (`### 1.0.0` introduces the
    // intro paragraph for that release before any "### " category).
    if (line.trim().length > 0) {
      if (!currentSection) currentVersion.intro.push(line.trim());
      else currentSection.entries.push({ kind: 'paragraph', text: line.trim() });
    }
  }

  return versions;
}

/**
 * Renders inline Markdown constructs (**bold**, `code`) into React nodes.
 * Intentionally minimal — we only support the patterns the changelog
 * actually uses. Unknown sequences fall through as literal text.
 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`i${key++}`} className="text-white/95">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={`i${key++}`}
          className="px-1.5 py-0.5 rounded text-[0.85em] bg-white/10 text-white/90 font-mono"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

const CATEGORY_META: Record<Category, { label: string; Icon: typeof Sparkles; accent: string }> = {
  added:   { label: 'Ajouté',  Icon: Plus,     accent: 'text-emerald-400' },
  changed: { label: 'Modifié', Icon: Wrench,   accent: 'text-sky-400' },
  fixed:   { label: 'Corrigé', Icon: Bug,      accent: 'text-amber-400' },
  other:   { label: '',        Icon: Sparkles, accent: 'text-white/60' },
};

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const versions = useMemo(() => parseChangelog(__APP_CHANGELOG__), []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Move focus into the dialog on open so subsequent Tab cycles stay
  // inside it (and Escape works without clicking first).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Card */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative glass-strong rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-white/70" />
            <h2 className="text-sm font-semibold tracking-wide text-white/90">
              Historique des versions
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 text-white/60 hover:text-white/90 transition"
            title="Fermer (Échap)"
          >
            <X size={14} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-[13px] text-white/75 leading-relaxed">
          {versions.length === 0 && (
            <p className="text-white/50 italic">
              Aucune version enregistrée dans le changelog.
            </p>
          )}
          {versions.map((v, idx) => (
            <section key={v.version} className="space-y-3">
              <header className="flex items-baseline gap-3 flex-wrap">
                <span className="text-white/95 font-semibold text-base">
                  v{v.version}
                </span>
                {v.date && (
                  <span className="text-white/40 text-[11px]">
                    {v.date}
                  </span>
                )}
                {idx === 0 && (
                  <span className="badge badge-green text-[10px]">Actuelle</span>
                )}
              </header>

              {v.intro.length > 0 && (
                <p className="text-white/60">
                  {v.intro.map((t, i) => (
                    <span key={i}>{renderInline(t)}{i < v.intro.length - 1 ? ' ' : ''}</span>
                  ))}
                </p>
              )}

              {v.sections.map((s, si) => {
                const meta = CATEGORY_META[s.category];
                const Icon = meta.Icon;
                return (
                  <div key={si} className="space-y-1.5">
                    {s.title && (
                      <h3 className={`text-[11px] uppercase tracking-wider font-medium flex items-center gap-1.5 ${meta.accent}`}>
                        <Icon size={11} />
                        <span>{meta.label || s.title}</span>
                      </h3>
                    )}
                    <ul className="space-y-1 pl-0">
                      {s.entries.map((e, ei) => (
                        <li
                          key={ei}
                          className={
                            e.kind === 'nested'
                              ? 'ml-6 text-white/60 before:content-["◦"] before:mr-2 before:text-white/30'
                              : e.kind === 'bullet'
                              ? 'ml-3 before:content-["•"] before:mr-2 before:text-white/30'
                              : 'text-white/60'
                          }
                        >
                          {renderInline(e.text)}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              {idx < versions.length - 1 && (
                <div className="border-t border-white/5 pt-1" />
              )}
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 text-[11px] text-white/40 flex items-center justify-between">
          <span>Version installée : <span className="text-white/70 font-mono">v{__APP_VERSION__}</span></span>
          <span className="italic">Échap pour fermer</span>
        </div>
      </div>
    </div>
  );
}
