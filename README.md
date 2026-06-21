# 🐟 FISH ＜＞＜ SOUNDBOARD

A zero-dependency, zero-server browser soundboard — 684 sounds across 13 categories. Open `index.html` directly, or host the folder on GitHub Pages / any static host.

## Run it

- **Just play:** double-click `index.html`.
- **Add new sounds:** drop audio files into `audio/<Category>/`, then double-click `RUN.bat` (Windows). It transcodes anything non-OGG to Vorbis via ffmpeg and regenerates `config.js`.
- On other platforms, run the scripts yourself:
  ```sh
  # transcode (optional, needs ffmpeg)
  pwsh scripts/convert-to-ogg.ps1
  # rebuild the sound index
  node scripts/generate-config.js
  ```

## Features

**Playback**
- Independent **speed** and **pitch** (cents) sliders, with reset buttons
- Per-sound **loop**, **±10s skip**, **stop**, and **download**
- **Distortion** (WaveShaper) and a **bass boost** toggle
- A master **limiter** (20:1 compressor) with a live dB meter you can drag to set the threshold

**Equalizer** — interactive canvas with live FFT spectrum overlay
- Click to add a band, drag to move it, double-click to remove, scroll/slider for Q
- Fun modes: **wobble** (LFO sweep), **scatter** (randomize all bands), **chaos** (random walk)
- Frequency-response curve drawn from the actual filter state

**Auto-pitch** — sweeps the pitch automatically in three modes (RND / STEP / DRIFT) with adjustable speed

**Organization & UX**
- **Search** across all sounds, with category reordering on match
- **Random from enabled** (also the `Space` key)
- Per-category **enable/disable**, persisted to `localStorage`
- **Now Playing** tiles with one-click stop
- "Paint" by dragging across buttons to toggle loops or fire a whole row at once
- Lazy category rendering — only expanded categories build their buttons

**Import your own** — drag & drop files or folders anywhere (recursive), or use the 📂 IMPORT menu. Imports are:
- Grouped by subfolder into their own categories
- Persisted to **IndexedDB** and restored on reload
- Fully featured (loop / skip / speed / pitch / EQ all apply)

**Offline** — a service worker caches audio via stale-while-revalidate, so replays are instant and replaced sounds still propagate.

## How it's built

| File | Role |
|------|------|
| `index.html` | Markup + CRT-green terminal styling |
| `config.js` | Auto-generated `window.SOUND_CONFIG` map of `folder → [[filename, size], ...]` |
| `app.js` | Audio engine (Web Audio graph + `Audio()` fallback), UI, drag/drop, persistence |
| `sw.js` | Service worker — audio cache (stale-while-revalidate) |
| `scripts/generate-config.js` | Walks `audio/`, emits `config.js` |
| `scripts/convert-to-ogg.ps1` | ffmpeg transcode of non-OGG sources to Vorbis |

The audio signal chain:

```
source → [EQ biquad chain] → bassFilter (lowshelf) → masterGain
       → distortion (WaveShaper) → limiter (DynamicsCompressor) → analyser → out
```

If Web Audio can't fetch/decode (e.g. opened over `file://`), it transparently falls back to `HTMLAudioElement` with a combined playback rate.
