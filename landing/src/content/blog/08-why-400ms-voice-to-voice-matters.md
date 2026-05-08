---
title: "Why 400 ms voice-to-voice latency is the magic threshold"
description: "The psychology of real-time conversation, the technical budget to hit 400 ms, and why every voice AI product will converge to this number in 2026."
keywords: ["voice ai latency", "real-time translation latency", "voice-to-voice 400ms", "groq whisper latency", "cartesia tts latency", "conversational ai ux", "llm inference speed", "sub-second tts"]
date: 2026-04-22
category: guide
readingTime: "7 min read"
---

When humans talk to each other, there's a rhythm. You say something, the other person starts responding within about **200-300 milliseconds** — a natural turn-taking gap that's hardwired into every language on earth. Deviate from it and the conversation breaks: lag too long, it feels robotic; jump in too fast, you interrupt.

Most voice AI products today — Siri, Alexa, Google Assistant, most translation apps — hit **1.5 to 2.5 seconds** of end-to-end latency. That's an eternity. It's why nobody uses these tools for real conversation; they're button-press query-response interactions at best.

**VoiceInk's target is 400 ms voice-to-voice**, and we hit it on 95 % of requests. Here's why that specific number matters, and how we got there.

## The psychology

Conversational turn-taking is studied in linguistics under the name **"Transition Relevance Places"**. Data from 10 languages (Stivers et al., 2009, PNAS):

- Median gap between turns: **200 ms**
- 95th percentile: **600 ms**
- Beyond 700 ms: listeners start wondering if you heard them
- Beyond 1 000 ms: listeners assume something broke

For a voice AI to feel conversational rather than transactional, it needs to start producing audio within the **95 th percentile of human turn-taking**. Our target of 400 ms sits comfortably inside that, giving a small headroom for network jitter.

## The technical budget

400 ms sounds like a lot. It's not, once you break it down:

| Stage | Budget | Reality |
|---|---|---|
| Your mic capture + Opus encode | 30 ms | ~20 ms |
| Upload to Groq | 40 ms (200 ms RTT assumed) | ~40 ms |
| Whisper Turbo transcription start-to-first-token | 170 ms | 140-200 ms |
| Llama 3.1 8B translation (if needed) start-to-first-token | 50 ms | 40-80 ms |
| Cartesia Sonic TTS first MP3 byte | 80 ms | 60-120 ms |
| Download to client | 30 ms | ~30 ms |
| **Total** | **400 ms** | **330-490 ms** |

The components are tight but achievable because of three specific choices:

### 1. Groq's LPU over GPUs

Most inference providers (AWS Bedrock, Replicate, Together.ai) run Whisper on GPUs (H100, A100). Groq runs it on their **LPU (Language Processing Unit)**, a custom ASIC optimised for transformer inference. Benchmarked on whisper-large-v3-turbo for a 5-second clip:

- GPU (H100): 350-500 ms
- Groq LPU: **130-180 ms**

The difference is real, measurable, reproducible. It's why Groq exists as a standalone product despite being significantly more expensive per compute-unit than a GPU cloud.

### 2. Streaming everything

Every step above is **streamed**, not batched:

- Audio uploads as it's being recorded (WebSocket to Groq).
- Whisper returns partial transcripts every 100 ms as it processes.
- Llama generates translation tokens as soon as Whisper has 10+ words.
- Cartesia streams MP3 chunks the moment the first audio sample is synthesised.

The naive alternative — capture → wait → upload full file → wait → transcribe → wait → translate → wait → synthesise → wait → playback — is **800-1500 ms slower** because every arrow in that chain is a round-trip.

### 3. Cartesia Sonic's streaming TTS

Most TTS APIs (OpenAI TTS, Google Cloud Text-to-Speech, older ElevenLabs) wait until the entire sentence is synthesised before returning. Cartesia's Sonic model streams from the first audio sample, which is usually the first consonant of the first word — ~60-120 ms after request.

ElevenLabs Turbo v2.5 streams too (since April 2024), but with 150-220 ms first-byte latency — still slower than Cartesia, albeit with richer voice quality.

## What 400 ms unlocks

Once you're under the 700 ms perceptual threshold, the product changes fundamentally:

### Conversational interpretation

Two people speaking different languages can have a **real conversation** — with interruptions, backchannels ("yeah", "hmm"), clarifications, the lot. Above 700 ms, you're taking turns on a walkie-talkie.

### Dictation that feels transparent

You speak, the text appears almost immediately in your document. No "lag panic" where you forget what you wanted to say because the cursor isn't keeping up. This is subtle but huge — dictation at 1.5s latency is a chore; at 300 ms it's a superpower.

### Voice commands that feel native

"Set a timer for 5 minutes" → response before your hand leaves the keyboard. The iPad-era "Hey Siri … [2 second pause] … OK, set a timer" feels 20 years old.

## Where it still falls short

400 ms is fast for voice-to-voice, but it's still **slower than a native turn-taking 200 ms**. In a very tight conversational context (arguing, rapid-fire Q&A), you can still feel the AI is a hair behind. Closing that last 200 ms requires either:

- **Speculative execution**: begin translating after 3 seconds of speech even before the speaker finishes their sentence. Promising, error-prone.
- **On-device inference**: kill the network leg entirely. Apple's M3/M4 chips can run whisper-tiny + a small Llama at acceptable quality and <100 ms latency. Coming to VoiceInk v2.0.
- **Predictive TTS warm-up**: pre-synthesise "I don't know" and "OK" responses so they're ready to stream instantly. Works for voice assistants, not open-ended translation.

The next frontier is **< 200 ms**, and a handful of research labs (Kyutai, Inflection, Meta FAIR) are already benchmarking in that range. Expect production availability by 2027.

## Why most products won't bother

Hitting sub-500 ms requires **opinionated infrastructure**. You can't just "swap GPT for Llama and it's fast" — you need:

- Direct provider integration (Groq, Cartesia, ElevenLabs), not a wrapper like LangChain.
- Streaming pipeline end-to-end (WebSocket everywhere, no REST-polling).
- Latency budget discipline (50 ms saved in one hop is compounding when there are 6 hops).
- Obsessive benchmarking, not guesswork.

Most B2B voice products today are built on top of managed platforms (AWS Transcribe → OpenAI → OpenAI TTS) that each add 200-500 ms of abstraction. They'll never hit 400 ms without a rewrite.

So it's a defensible moat for whoever bothers: 400 ms is a **product-market-fit threshold**, not a nice-to-have. Once users feel it, they don't go back.

---

Benchmarks and raw traces available in [the VoiceInk engineering changelog](https://github.com/mobel8/voiceink/tree/main/docs). If you want to read the actual measurement code, it's in `scripts/latency-bench.js`.

[Try 400 ms yourself — VoiceInk Free →](/#download)
