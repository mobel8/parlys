---
title: "VoiceInk 1.7 — global hotkey interpreter, fluid UI, and 60 UI strings in FR/EN"
description: "A global Ctrl+Shift+I flips the voice interpreter from anywhere, the UI scales with window size, and every string is bilingual French/English."
keywords: ["voiceink 1.7", "voiceink release", "voiceink changelog", "voice interpreter hotkey", "voiceink i18n", "voiceink update", "dictation app update"]
date: 2026-04-22
category: announcement
readingTime: "5 min read"
---

Today we're shipping VoiceInk 1.7 — the last minor release before our SaaS beta opens in May. Three features ship: a global interpreter hotkey, a fluid UI that scales with your window size, and FR/EN bilingual strings for the core settings.

## Global interpreter hotkey

Press **Ctrl+Shift+I** anywhere in your OS — while typing in Word, gaming on Steam, scrolling through Reddit, whatever — and VoiceInk flips its live interpreter on or off. The emerald pill in the top-right of the window lights up instantly, and the next dictation goes through the Whisper → translate → AI voice pipeline.

This completes the "invisible, everywhere" philosophy of the app. You don't open VoiceInk to interpret; you interpret from wherever you are. The pill mode + hotkey combo means a multilingual Discord call is literally: `Ctrl+Alt+Space` to talk (push-to-talk), already-translated voice comes out the other side. No focus switch, no modal, no friction.

The hotkey itself is fully customisable in Settings → Global shortcuts. Click the field, press your preferred combination, and the binding is live — no app restart needed.

Technical detail for the curious: the main process persists the setting then broadcasts `ON_SETTINGS_CHANGED` to every open VoiceInk window, so if you have the History view open in one window and the Settings view in another, they both reflect the change instantly without a round-trip to the IPC layer.

## Fluid UI

We've rewritten every layout constraint in the renderer to use CSS `clamp()` and `grid-template-columns: repeat(auto-fit, minmax(…, 1fr))` instead of hard breakpoints.

In practical terms: as you resize the VoiceInk window, **every single element scales proportionally** — headline type, section padding, card gaps, button heights, grid columns. The window no longer "snaps" between md/lg breakpoints mid-drag. The content stays the right size relative to the window.

On a 14" MacBook (1400px wide) the app shows 3 theme cards per row. On a 6K iMac (6000px wide), it shows 6. On a 12" tablet, 2. At any size, the reading line length stays in the 50-75 character sweet spot that researchers have been preaching about since 1968.

For the implementation-curious: we set `font-size: clamp(14px, 14px + 0.35vw, 17px)` on the root `<html>` element. Every downstream Tailwind utility that uses `rem` (which is most of them) scales with the window. One rule, everywhere.

## Bilingual FR/EN strings

The core of the app now renders in either English or French, decided by a new setting (Settings → Interface → App language). Default is `auto`, which resolves from `navigator.language` and falls back to English.

We didn't pull in `i18next` or `react-intl` — with ~60 strings to start, a hand-rolled 60-line scaffold is cheaper and faster. A `useT()` React hook, two flat dictionaries, and `{variable}` interpolation. Adding a third language is a 15-minute chore: duplicate the EN dictionary, translate, add an entry to `SUPPORTED_UI_LANGUAGES`.

Spanish, German, Italian, Portuguese and Dutch are planned for v1.8 — we're hunting contributors in each (hit us up at hi@voiceink.app if you're a native speaker).

## What's next

**v1.8** (mid-May): SaaS beta opens. Paid accounts, quotas, Stripe billing, no more "bring your own API key or nothing". Free tier keeps working.

**v1.9** (June): Voice cloning for creators. Upload 30 seconds of your voice, synthesise in 30 languages with your timbre.

**v2.0** (Q3 2026): medical vertical + HDS certification, mobile companion app, API public access.

## Upgrading

If auto-updater is enabled (it is by default since v1.7), VoiceInk will detect the new version within 15 seconds of startup, download it silently, and show a banner when it's ready to install. One click, 8-second restart, you're on 1.7.

For manual installers: [grab the .exe from the releases page](https://github.com/mobel8/voiceink/releases/latest).

Release notes in full are in the [CHANGELOG](https://github.com/mobel8/voiceink/blob/main/CHANGELOG.md).
