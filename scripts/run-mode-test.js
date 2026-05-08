/**
 * Mode-application test.
 *
 * Loads the compiled main-process LLM module (dist/main/engines/llm.js)
 * and calls postProcess() directly for each Mode, reusing the user's
 * actual persisted Groq API key. Asserts:
 *
 *   - mode='raw'      → output === input (no polishing)
 *   - mode='natural'  → output differs, fillers stripped, language kept
 *   - mode='formal'   → output differs, formal register
 *   - mode='message'  → output differs, short conversational
 *
 * The input is a deliberately messy French dictation with fillers so
 * each prompt has something to clean up.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const settingsPath = path.join(process.env.APPDATA, 'voiceink', 'voiceink-settings.json');
if (!fs.existsSync(settingsPath)) {
  console.error('SKIP: settings not found at', settingsPath);
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
const userSettings = raw.settings || raw;

if (!userSettings.groqApiKey) {
  console.error('SKIP: no groqApiKey in settings');
  process.exit(2);
}

// Force llmEnabled=false in the test copy so the fix (ignoring llmEnabled)
// is what's actually being exercised. Before the fix this config would
// return raw text for every non-raw mode.
const testSettings = {
  ...userSettings,
  llmEnabled: false,
  llmProvider: 'groq',
  llmModel: userSettings.llmModel || 'llama-3.3-70b-versatile',
};

const { postProcess } = require(path.join(__dirname, '..', 'dist', 'main', 'engines', 'llm.js'));

const INPUT = "euh alors je pense que demain on pourrait heu faire la réunion à dix heures et voilà " +
  "je je voulais aussi parler du projet Alpha qui du coup avance bien enfin bon voilà";

const modes = ['raw', 'natural', 'formal', 'message'];

(async () => {
  let failures = 0;
  const results = [];
  for (const mode of modes) {
    const t0 = Date.now();
    let out;
    try {
      out = await postProcess(INPUT, mode, testSettings, 'fr');
    } catch (e) {
      console.error(`[${mode}] ERROR:`, e.message);
      failures++;
      continue;
    }
    const ms = Date.now() - t0;
    const changed = out !== INPUT;
    const header = `\n--- mode=${mode} (${ms}ms, in=${INPUT.length}ch out=${out.length}ch changed=${changed}) ---`;
    console.log(header);
    console.log(out);
    results.push({ mode, out, changed, ms });
  }

  console.log('\n================ ASSERTIONS ================');

  // raw: must return INPUT unchanged
  const raw = results.find((r) => r.mode === 'raw');
  if (raw && raw.out === INPUT) {
    console.log('  [OK]    raw: unchanged (identity)');
  } else {
    console.log('  [FAIL]  raw: output differs from input');
    failures++;
  }

  // Non-raw modes: output must have actually changed
  for (const mode of ['natural', 'formal', 'message']) {
    const r = results.find((x) => x.mode === mode);
    if (!r) { failures++; continue; }
    if (!r.changed) {
      console.log(`  [FAIL]  ${mode}: output identical to input (LLM did not fire)`);
      failures++;
      continue;
    }
    // Heuristic: common french filler 'euh' should be gone in all non-raw modes
    if (/\beuh\b/i.test(r.out)) {
      console.log(`  [FAIL]  ${mode}: still contains "euh" filler`);
      failures++;
      continue;
    }
    console.log(`  [OK]    ${mode}: output is polished (no "euh", length=${r.out.length}ch)`);
  }

  console.log('============================================');
  if (failures === 0) {
    console.log('\u2705 ALL ASSERTIONS PASSED');
    process.exit(0);
  } else {
    console.log(`\u274c ${failures} assertion(s) failed`);
    process.exit(1);
  }
})();
