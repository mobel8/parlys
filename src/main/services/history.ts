// Simple JSON-based history store (reliable on Windows, no native deps).
// Stored in Electron userData/history.json.

import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { HistoryEntry, UsageStats } from '../../shared/types';

function filePath(): string {
  return join(app.getPath('userData'), 'history.json');
}

function load(): HistoryEntry[] {
  const fp = filePath();
  // A genuinely absent file legitimately means "no history yet".
  if (!existsSync(fp)) return [];

  let raw: string;
  try {
    raw = readFileSync(fp, 'utf-8');
  } catch (err) {
    // Transient/permission read error (e.g. EACCES). Do NOT return [] in a way
    // that lets the next save() overwrite still-present data — just bail out
    // without touching the file so the data on disk stays intact.
    console.warn(`[history] failed to read ${fp}; keeping file untouched:`, err);
    return [];
  }

  try {
    return JSON.parse(raw) as HistoryEntry[];
  } catch (err) {
    // File is present but corrupt/truncated (e.g. crash mid-write). Preserve it
    // before returning [] so the next save() cannot silently destroy it.
    const backup = `${fp}.corrupt-${Date.now()}`;
    try {
      renameSync(fp, backup);
      console.warn(`[history] ${fp} is corrupt; preserved as ${backup}:`, err);
    } catch (renameErr) {
      console.warn(`[history] ${fp} is corrupt and could not be preserved:`, renameErr);
    }
    return [];
  }
}

function save(entries: HistoryEntry[]): void {
  const fp = filePath();
  mkdirSync(dirname(fp), { recursive: true });
  // Atomic write: serialise to a temp file in the SAME directory, then rename
  // over the target. rename is atomic on the same volume, so a crash either
  // leaves the old file intact or the fully-written new one — never a truncated
  // half-write.
  const tmp = `${fp}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
    renameSync(tmp, fp);
  } catch (err) {
    // Clean up the temp file on failure so we don't leak partial files.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}

/**
 * Return the history sorted for display:
 *   - pinned entries first (most recently pinned on top),
 *   - then everything else by createdAt desc.
 */
export function listHistory(): HistoryEntry[] {
  const all = load();
  return all.sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.createdAt - a.createdAt;
  });
}

export function addHistory(entry: HistoryEntry): void {
  const all = load();
  all.push(entry);
  // Cap at 1000 entries, preserving pinned ones
  if (all.length > 1000) {
    const pinned = all.filter((e) => e.pinned);
    const rest = all.filter((e) => !e.pinned);
    while (pinned.length + rest.length > 1000 && rest.length > 0) rest.shift();
    save([...pinned, ...rest]);
    return;
  }
  save(all);
}

export function deleteHistory(id: string): void {
  const all = load().filter((e) => e.id !== id);
  save(all);
}

export function clearHistory(): void {
  // Preserve pinned entries so users don't lose favourites by mistake.
  const all = load().filter((e) => e.pinned);
  save(all);
}

/** Flip the `pinned` flag on a given entry. Returns the new value. */
export function togglePinHistory(id: string): boolean {
  const all = load();
  const entry = all.find((e) => e.id === id);
  if (!entry) return false;
  entry.pinned = !entry.pinned;
  save(all);
  return !!entry.pinned;
}

/**
 * Compute aggregated usage stats from the current history.
 * Cheap enough to recompute on every UI refresh (<=1000 entries).
 */
export function getUsageStats(): UsageStats {
  const all = load();
  const stats: UsageStats = {
    totalEntries: all.length,
    totalWords: 0,
    totalChars: 0,
    totalDurationMs: 0,
    byLanguage: {},
    byMode: {},
    streakDays: 0,
  };
  if (!all.length) return stats;

  const days = new Set<string>();
  for (const e of all) {
    stats.totalWords += e.wordCount ?? estimateWords(e.finalText);
    stats.totalChars += (e.finalText || '').length;
    stats.totalDurationMs += e.durationMs || 0;
    stats.byLanguage[e.language || 'auto'] = (stats.byLanguage[e.language || 'auto'] || 0) + 1;
    stats.byMode[e.mode || 'raw'] = (stats.byMode[e.mode || 'raw'] || 0) + 1;
    if (!stats.first || e.createdAt < stats.first) stats.first = e.createdAt;
    if (!stats.last || e.createdAt > stats.last) stats.last = e.createdAt;
    days.add(new Date(e.createdAt).toISOString().slice(0, 10));
  }

  // Consecutive-day streak ending "today" (or the latest recorded day).
  if (days.size > 0) {
    const sorted = Array.from(days).sort().reverse();
    let streak = 1;
    let prev = new Date(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      const cur = new Date(sorted[i]);
      const diff = Math.round((prev.getTime() - cur.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 1) { streak++; prev = cur; }
      else break;
    }
    stats.streakDays = streak;
  }
  return stats;
}

function estimateWords(text: string): number {
  if (!text) return 0;
  const m = text.match(/[\p{L}\p{N}]+/gu);
  return m ? m.length : 0;
}

export type ExportFormat = 'json' | 'markdown' | 'txt' | 'csv';

/**
 * Serialise the current (already-sorted) history to a chosen format.
 * Caller writes the resulting string to disk via Electron dialog.
 */
export function exportHistory(format: ExportFormat): { filename: string; content: string } {
  const entries = listHistory();
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    return {
      filename: `voiceink-history-${stamp}.json`,
      content: JSON.stringify(entries, null, 2),
    };
  }
  if (format === 'txt') {
    return {
      filename: `voiceink-history-${stamp}.txt`,
      content: entries.map((e) => e.finalText).filter(Boolean).join('\n\n---\n\n'),
    };
  }
  if (format === 'csv') {
    const header = 'id,createdAt,language,mode,translatedTo,durationMs,wordCount,pinned,finalText\n';
    const rows = entries.map((e) =>
      [
        e.id,
        new Date(e.createdAt).toISOString(),
        e.language || '',
        e.mode || '',
        e.translatedTo || '',
        String(e.durationMs || 0),
        String(e.wordCount ?? estimateWords(e.finalText)),
        e.pinned ? '1' : '0',
        csvEscape(e.finalText || ''),
      ].join(','),
    ).join('\n');
    return { filename: `voiceink-history-${stamp}.csv`, content: header + rows };
  }
  // markdown (default)
  const md = entries.map((e) => {
    const date = new Date(e.createdAt).toLocaleString();
    const tags = [e.language, e.mode, e.translatedTo ? `→ ${e.translatedTo}` : null, e.pinned ? '★ épinglé' : null]
      .filter(Boolean)
      .join(' · ');
    return `## ${date}\n\n*${tags}*\n\n${e.finalText || ''}\n`;
  }).join('\n---\n\n');
  return { filename: `voiceink-history-${stamp}.md`, content: `# VoiceInk — Historique (${stamp})\n\n${md}` };
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
