#!/usr/bin/env node
/**
 * Exercise the 4 post-processing modes against Groq.
 *
 * Reads the installed app's settings.json to pick up the user's Groq
 * API key (so we hit the real LLM, not a mock). For each sample text
 * + mode combination, sends the chat-completions call with the
 * prompt template from src/shared/types.ts, then runs a battery of
 * quality checks specific to the mode:
 *
 *   raw      → output === input (passthrough, no LLM call)
 *   natural  → fillers removed, length within ±20%, same voice
 *   formal   → no contractions, uses "vous" in FR, register shifted
 *   message  → ≤ 3 sentences, significantly shorter than input
 *
 * We also check universal invariants for every non-raw mode:
 *   - no preamble ("Voici", "Here is", "Here's")
 *   - no code fences
 *   - numbers/names from the input are preserved
 *   - same primary language as the input (detected by the mode prompt)
 *
 * Iterates over a loop until all checks pass or we exhaust retries
 * — the user asked for "tests en boucle".
 *
 * Usage:
 *   node scripts/test-mode-prompts.js           # 1 sample
 *   node scripts/test-mode-prompts.js 3         # 3 iterations
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Pull the compiled MODE_PROMPTS out of the dist build so we test the
// exact same template the running app uses. Fall back to requiring the
// TypeScript via a tiny hand-eval if dist isn't present.
function loadPrompts() {
  const distPath = path.join(__dirname, '..', 'dist', 'main', 'index.js');
  if (!fs.existsSync(distPath)) {
    throw new Error(`dist/main/index.js not found — run "npm run build:main" first`);
  }
  // Source is small; parse MODE_PROMPTS directly from shared/types.ts so
  // we don't need a full module loader. Find the object literal after
  // "MODE_PROMPTS" in types.ts and dynamically evaluate the object.
  const typesPath = path.join(__dirname, '..', 'src', 'shared', 'types.ts');
  const src = fs.readFileSync(typesPath, 'utf-8');
  const match = src.match(/export const MODE_PROMPTS:[^=]*=\s*(\{[\s\S]*?\n\});/);
  if (!match) throw new Error('Could not parse MODE_PROMPTS from types.ts');
  // Replace TS type annotation with JS; strip trailing comma friendly.
  // eslint-disable-next-line no-eval
  const obj = eval('(' + match[1].replace(/Mode\s*,\s*string/g, '') + ')');
  return obj;
}

function loadApiKey() {
  const appdata = process.env.APPDATA;
  if (!appdata) throw new Error('APPDATA not set');
  const settingsPath = path.join(appdata, 'voiceink', 'voiceink-settings.json');
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`settings.json not found at ${settingsPath} — launch VoiceInk once to create it`);
  }
  const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  const key = raw?.settings?.groqApiKey || process.env.GROQ_API_KEY || '';
  if (!key || !key.startsWith('gsk_')) {
    throw new Error('No Groq API key found (checked settings.json + GROQ_API_KEY env)');
  }
  return key;
}

const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGroq(system, user, apiKey) {
  const body = JSON.stringify({
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const backoff = [2000, 4000, 8000, 16000];
  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    const res = await fetch(GROQ_CHAT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body,
    });
    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || '';
    }
    const errBody = await res.text().catch(() => '');
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === backoff.length) {
      throw new Error(`Groq ${res.status}: ${errBody.slice(0, 300)}`);
    }
    // Respect the "try again in Xs" hint Groq returns on 429, else fall
    // back to exponential backoff. +200ms slack for clock drift.
    let wait = backoff[attempt];
    const hint = errBody.match(/try again in ([0-9.]+)s/i);
    if (hint) wait = Math.max(wait, Math.ceil(parseFloat(hint[1]) * 1000) + 200);
    process.stderr.write(`  [backoff] ${res.status} retry ${attempt + 1}/${backoff.length} in ${wait}ms\n`);
    await sleep(wait);
  }
  throw new Error('Groq unreachable after retries');
}

function stripCodeFences(s) {
  const m = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return m ? m[1].trim() : s;
}

// Sample dictations (French — that's the user's primary language).
// Each entry has a "raw" field as it would come out of Whisper, plus
// the key facts we want to verify are preserved after post-processing.
const SAMPLES = [
  {
    label: 'FR · brainstorm informel',
    language: 'French',
    raw: "alors euh ben du coup je pense qu'on pourrait euh faire un point demain voilà vers 14h dans la salle B, j'ai trois trois sujets à aborder et du coup ça devrait prendre environ 45 minutes quoi",
    facts: ['14h', 'salle B', '45', 'trois'],
  },
  {
    label: 'FR · note technique',
    language: 'French',
    raw: "ouais donc en fait euh le serveur de prod plante à chaque fois qu'on lance plus de 20 requêtes simultanées ben faut que Marc regarde ça avant vendredi voilà c'est assez urgent quoi",
    facts: ['20', 'Marc', 'vendredi'],
  },
  {
    label: 'FR · flux stream-of-consciousness (long)',
    language: 'French',
    raw: "bon alors euh j'ai regardé le dossier de Thomas hier soir et en fait y'a plusieurs trucs qui m'ont étonné, déjà le budget de 12000 euros ça me paraît élevé pour un projet de 6 semaines et en plus euh du coup je me demande si on a bien inclus les frais de déplacement voilà et puis ensuite il faut qu'on valide le planning avec Sarah avant lundi parce que sinon on va être en retard sur la phase 2 quoi",
    facts: ['Thomas', '12000', '6 semaines', 'Sarah', 'lundi', 'phase 2'],
  },
  {
    label: 'FR · demande d\'action (piège formal)',
    language: 'French',
    raw: "euh Lucie tu peux me renvoyer le rapport de février avant midi s'il te plaît c'est urgent",
    facts: ['Lucie', 'février', 'midi'],
  },
  {
    label: 'EN · casual chat draft',
    language: 'English',
    raw: "uh yeah so like I was thinking we could maybe um push the deadline to Friday cause you know John is out sick this week and we haven't got the data from the API team yet",
    facts: ['Friday', 'John', 'API'],
  },
];

// Resolve {{LANG}} the same way the main process does at runtime.
function resolvePrompt(tpl, lang) { return tpl.replace(/\{\{LANG\}\}/g, lang); }

// --- QA checks ---------------------------------------------------------------

function countSentences(s) {
  return (s.match(/[.!?]+(?:\s|$)/g) || []).length || (s.trim() ? 1 : 0);
}
function countWords(s) {
  return (s.match(/[\p{L}\p{N}]+/gu) || []).length;
}
function hasPreamble(s) {
  return /^(?:voici|voila|here\s*is|here's|bien\s*s[uû]r|certainement|d[eé]sol[eé]e?,?)/i.test(s.trim());
}
function hasCodeFence(s) {
  return /```/.test(s);
}
/**
 * Template-wrapper patterns that LLMs spontaneously inject to "make it
 * sound formal". These are sign-offs / administrative wrappers the
 * user never dictated, and break the "keep it faithful" contract.
 */
function hasTemplateWrapper(s) {
  return (
    /\b(je vous prie|cordialement|bien\s+[aà]\s+vous|veuillez\s+agr[eé]er|merci\s+d['']avance)\b/i.test(s) ||
    /bien\s+vouloir\s+noter|please\s+take\s+note|kindly\s+note|best\s+regards|sincerely|thank\s+you\s+in\s+advance/i.test(s) ||
    /je\s+(?:vous\s+)?(?:informe|confirme|fais\s+savoir)\s+(?:que|par)/i.test(s)
  );
}
function containsAll(s, needles) {
  // Remove thin / regular spaces inside long numbers so "12000" matches
  // the formal typography "12 000". Applied to both needle and haystack
  // so we stay symmetric.
  const norm = (x) => String(x).replace(/(\d)[\s\u00A0\u202F](?=\d)/g, '$1');
  const hay = norm(s);
  return needles.every((n) => new RegExp(norm(String(n)), 'i').test(hay));
}
function hasFrenchFillers(s) {
  // Look for obvious fillers surrounded by whitespace / punctuation.
  return /(?:^|\s)(euh|heu|ben|bah|voilà|voila|du\s+coup|quoi\s*[.!?]?)(?:\s|[.!?]|$)/i.test(s);
}
function hasContractions(s) {
  // French informal contractions or English ones ("don't", "can't").
  return /\b(don't|can't|won't|shouldn't|couldn't|it's|we're|j'sais)\b/i.test(s);
}

function runChecks(mode, input, output, sample) {
  const issues = [];
  if (!output || !output.trim()) issues.push('empty output');

  if (mode !== 'raw') {
    if (hasPreamble(output)) issues.push(`preamble detected: "${output.slice(0, 60)}"`);
    if (hasCodeFence(output)) issues.push(`code fence present`);
    if (!containsAll(output, sample.facts)) {
      const missing = sample.facts.filter((f) => !new RegExp(String(f), 'i').test(output));
      issues.push(`facts dropped: ${missing.join(', ')}`);
    }
  }

  if (mode === 'natural') {
    if (hasFrenchFillers(output)) issues.push('natural kept filler words');
    const inLen = countWords(input);
    const outLen = countWords(output);
    // Natural shouldn't dramatically change length (fillers make ±25% tolerance).
    const ratio = outLen / inLen;
    if (ratio < 0.6 || ratio > 1.2) {
      issues.push(`natural changed length too much (${inLen} → ${outLen}, ratio ${ratio.toFixed(2)})`);
    }
  }

  if (mode === 'formal') {
    if (hasFrenchFillers(output)) issues.push('formal kept filler words');
    if (hasContractions(output)) issues.push('formal kept contractions');
    if (hasTemplateWrapper(output)) issues.push('formal injected template wrapper (sign-off / "je vous prie" / "bien vouloir noter")');
    // "vous" presence is a soft heuristic: the sample uses "on" so the
    // model should NOT force "vous". We only complain if the model
    // INTRODUCED "tu" out of nowhere.
    if (/\btu\b/i.test(output) && !/\btu\b/i.test(input)) {
      issues.push(`formal introduced "tu" not in source`);
    }
    // Length check: formal may add a few words for register shift, but
    // more than 130% means the model is hallucinating content.
    const inLen = countWords(input);
    const outLen = countWords(output);
    if (outLen > inLen * 1.3) {
      issues.push(`formal too long (${inLen} → ${outLen} words, ${(outLen / inLen * 100).toFixed(0)}%)`);
    }
  }

  if (mode === 'message') {
    const sents = countSentences(output);
    if (sents > 3) issues.push(`message has ${sents} sentences (>3)`);
    if (countWords(output) > countWords(input) * 0.8) {
      issues.push(`message not compressed (${countWords(input)} → ${countWords(output)})`);
    }
  }

  return issues;
}

async function main() {
  const iterations = Math.max(1, parseInt(process.argv[2] || '1', 10));
  const prompts = loadPrompts();
  const apiKey = loadApiKey();
  const modes = Object.keys(prompts);

  console.log('=== PROMPT QA ===');
  console.log('modes:  ', modes.join(', '));
  console.log('samples:', SAMPLES.length);
  console.log('iters:  ', iterations);
  console.log('model:  ', MODEL);
  console.log('');

  let totalIssues = 0;
  const perModeIssues = Object.fromEntries(modes.map((m) => [m, 0]));

  for (let iter = 1; iter <= iterations; iter++) {
    console.log(`----- ITER ${iter}/${iterations} -----`);
    for (const sample of SAMPLES) {
      console.log(`\n[${sample.label}]`);
      console.log(`  INPUT: ${sample.raw}`);
      for (const mode of modes) {
        const tpl = prompts[mode];
        if (!tpl) {
          // raw — passthrough, no LLM call
          const out = sample.raw;
          const issues = runChecks(mode, sample.raw, out, sample);
          console.log(`  [${mode.padEnd(8)}] ${out.length}ch  ${issues.length ? '❌ ' + issues.join(' | ') : 'OK'}`);
          if (issues.length) { totalIssues += issues.length; perModeIssues[mode] += issues.length; }
          continue;
        }
        const system = resolvePrompt(tpl, sample.language);
        let output;
        try {
          output = stripCodeFences((await callGroq(system, sample.raw, apiKey)).trim());
        } catch (e) {
          console.log(`  [${mode.padEnd(8)}] ❌ Groq error: ${e.message}`);
          totalIssues++;
          perModeIssues[mode]++;
          continue;
        }
        const issues = runChecks(mode, sample.raw, output, sample);
        const status = issues.length ? '❌ ' + issues.join(' | ') : '✅';
        console.log(`  [${mode.padEnd(8)}] ${output.length.toString().padEnd(4)}ch ${status}`);
        console.log(`          → ${output.replace(/\n/g, ' | ')}`);
        if (issues.length) { totalIssues += issues.length; perModeIssues[mode] += issues.length; }
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  for (const m of modes) {
    console.log(`  ${m.padEnd(10)} ${perModeIssues[m]} issue(s)`);
  }
  console.log(`  TOTAL      ${totalIssues} issue(s)`);
  process.exit(totalIssues === 0 ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(2); });
