---
title: "Real-time voice translator for Discord, Zoom and Google Meet"
description: "Speak French in a Discord call, be heard in English. How to route an AI voice translator into any conferencing app via a virtual microphone. Zero lag, your own voice."
keywords: ["real-time voice translator", "discord voice translator", "zoom live translation", "google meet translator", "virtual microphone translator", "bilingual meeting app", "live interpreter software", "voiceink"]
date: 2026-04-22
category: tutorial
readingTime: "7 min read"
---

You're on a Discord call with a Japanese teammate. You speak French natively, they speak Japanese. Google Translate's mobile app "Conversation" mode exists, but passing the phone back and forth breaks the flow, adds 1.5-2 seconds of lag, and sounds robotic.

What you actually want: **speak into your headset mic in French, have your Japanese teammate hear fluent Japanese in their headphones**, without any extra device, bot, or round-trip to a mobile app. In 2026, that's finally a solved problem.

Here's how it works.

## The pipeline, demystified

A voice-to-voice translator needs four pieces wired in sequence:

1. **Audio capture** — your mic, standard.
2. **Speech-to-text** — Whisper (open-source) is the state of the art. Deployed on Groq's LPU inference, it returns the transcript in ~170 ms.
3. **LLM translation** — Llama 3.1 8B instruct handles 30+ languages with near-DeepL quality and < 100 ms latency on Groq.
4. **Text-to-speech** — Cartesia Sonic clones your voice from a 30-second sample and synthesises in ~180 ms. Or ElevenLabs Turbo if you prefer their voice library.

Total: **< 400 ms** from your mouth to your teammate's ear. That's faster than a trans-Atlantic RTT, and indistinguishable from live interpretation.

The last missing piece is **routing the synthesised audio into Discord / Zoom / Meet as if it came from your microphone**. This requires a **virtual audio device** at the OS level.

## Virtual microphone: the secret sauce

Windows, macOS and Linux all support creating a fake audio input that another program writes to and a third reads from. The canonical free tools:

- **Windows**: [VB-Audio VoiceMeeter](https://vb-audio.com/Voicemeeter/) (free, donation-ware) or [VAC (Virtual Audio Cable)](https://vac.muzychenko.net/en/).
- **macOS**: [BlackHole](https://existential.audio/blackhole/) (free, open-source).
- **Linux**: PulseAudio `null-sink` or PipeWire virtual device (both built in).

VoiceInk ships with a one-click installer that sets up a virtual mic named "VoiceInk Output" using VB-Audio on Windows and BlackHole on macOS. In Discord, you pick "VoiceInk Output" as your input device in Settings → Voice & Video. Same idea in Zoom (Settings → Audio → Microphone) and Google Meet (⚙ → Audio → Microphone).

## Walkthrough: Discord bilingual call in 5 minutes

1. **Install VoiceInk** from the download page. Accept the VB-Audio installer prompt.
2. In Discord: **User Settings → Voice & Video → Input Device → "VoiceInk Output"**.
3. Open VoiceInk, click the language pill in the top bar, pick: **Source = French (auto)**, **Target = Japanese**.
4. Toggle "Voice interpreter" in the settings bar. A pink chip lights up at the top of the VoiceInk window.
5. **Press and hold Ctrl+Alt+Space** while you speak in French. Release when you're done.
6. ~400 ms later, your teammate hears the Japanese translation in your voice, through Discord.
7. When they reply, VoiceInk's "Listener" feature captures the incoming Discord audio, transcribes it, and shows you the French translation on screen. (Audio playback of the reverse direction is a Pro feature in Listener settings.)

## Practical latency numbers

Measured on a 50 Mbps home fiber connection in Paris, April 2026:

| Step | Time |
|---|---|
| Mic capture + Opus encode | 20 ms |
| Upload to Groq | 40 ms |
| Whisper Turbo transcription | 170 ms |
| Llama 3.1 8B translation | 65 ms |
| Cartesia Sonic first MP3 byte | 165 ms |
| Playback + virtual mic routing | 30 ms |
| **Total voice-to-voice** | **~370 ms** |

Your teammate hears the *first syllable* of the Japanese translation within 370 ms of you finishing your sentence. The rest streams in real time.

## When it shines

- **Small bilingual teams**. Every daily standup becomes a non-issue. Everyone speaks their best language.
- **Customer calls in foreign markets**. You can take a sales call in a language you don't speak, live, and close.
- **Gaming with friends across continents**. Discord voice chat in 5 languages at once, one virtual mic per person.
- **Interviewing candidates** where you want them to answer in their native language for the best signal — you hear the translated version, they hear yours.

## When it doesn't

- **Legal depositions or anything where liability on mistranslation matters**. Hire a human interpreter.
- **Simultaneous multi-party conversations** (4+ people, all different languages, talking over each other). Current models aren't good at speaker diarization + translation at that density.
- **Heavy dialects** (thick regional Japanese, Quebecois with old-timey expressions, Scottish broad). Whisper handles them but accuracy drops 5-10 points.

## Privacy, briefly

VoiceInk uploads your audio over TLS to Groq (transcribe) and Cartesia (synthesise). Neither provider stores it or trains on it — both signed DPAs to that effect. If you're paranoid, turn on **BYOK mode** in settings: you provide your own Groq / Cartesia API keys, our server is bypassed entirely, and zero audio bytes cross our infrastructure. Free users can use BYOK; Pro users can too.

---

A free VoiceInk account gives you 15 minutes of interpreter per month — enough to try it on a call and see if the latency is as real as we claim. [Download free →](/#download)
