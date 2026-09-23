# Patchbay

A browser instrument for happy accidents: four playable scenes, a real modular audio graph, a keyboard, an editable sequencer, and a small observatory for your sound.

## Run

Use **Node.js 24.15 or later in the Node 24 line** (tested with 24.19.0) and npm.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite, including `/patchbay-chatgpt/`.

```sh
npm test
npm run build
npm run check:production
npm run preview
```

`build` produces the entire static site in **dist/**, with **dist/index.html** at its root. `check:production` starts a temporary local HTTP server, checks the real `/patchbay-chatgpt/` subpath and every built asset, then stops. It does not publish anything.

## Play

1. Tap **Enable audio**. **After hours** starts its bassline immediately.
2. Drag **Color**, **Bite/Bloom**, **Motion**, and **Space** up/down or sideways. Arrow keys work when a dial has focus. These controls move real module parameters; **CUSTOM** means you edited a mapped parameter directly.
3. Tap sequencer steps to change the rhythm. Use **Edit step** and **pitch** to change a note without toggling it. Tempo and gate length work while playing.
4. Choose **Velvet sky** and hold a chord pad or several piano keys. **Neon thread** is a lead; **Drift** plays an evolving ambient pattern. Loading a new scene stops the previous one; press Play or play the keys to begin again.
5. Play computer keys **A W S E D F T G Y H U J K**, with **Z X C V B N M , . /** continuing higher. Phones show one complete octave and octave buttons. Use **Connect MIDI** for MIDI note input where the browser supports it.
6. Open **Patch** to add, drag, edit, or remove modules. Drag empty space to pan; use zoom/Fit or pinch. Tap an output, then a matching input. Cable × controls disconnect. Audio/CV inputs accept one cable; note/gate inputs can merge keyboard and sequencer. Use a Mixer to combine audio.
7. Select an audio/CV module to inspect its waveform and spectrum. **Master output** is post-volume. The waveform uses labeled automatic display scaling; the level measurement uses actual samples.
8. **Save** keeps a copy in this browser. Export/import JSON for backups. **Share patch** creates a URL fragment containing the entire instrument and preserves the deployment path. It shares settings, not recorded audio.
9. **Record audio**, then **Finish recording**. Listen back or download the clip. No microphone is needed. Browser recording uses WebM/Ogg/M4A when supported, with a PCM WAV fallback.
10. **Stop all** or **Escape** silences voices and effect tails. On phones, a floating Stop all remains reachable. Escape first cancels an open cable/menu/dialog. Backgrounding the tab pauses playback.

## Morning hosting

The repository has **not** been deployed and contains no deployment-on-push workflow. Use your own deployment script to publish **the contents of dist/** once you choose to make the repository public. The Vite base is `/patchbay-chatgpt/`; assets, fonts and the favicon are bundled. There are no external runtime services, samples, AI calls, or special header requirements.

After deployment, open `/patchbay-chatgpt/?verify=1` and run the opt-in audio checks. Then follow the browser/device checklist in [BUILD_REPORT.md](BUILD_REPORT.md). **Live browser, physical-phone, MIDI hardware, and human listening checks were not completed in this build environment**; numerical native audio and simulated-DOM tests are distinguished in the report.

## Implementation

React + TypeScript + Vite. Native Web Audio, 16 voices, bounded master output, audio-rate CV, smoothed parameter changes and short graph crossfades. The 12 module types include keyboard, sequencer, oscillator, noise, filter, envelope, LFO, amplifier, mixer, delay, reverb and output. Sequencers share the patch's 16-step pattern. Evolution is deterministic from patch ID and loop count; set its rack control to zero for exact repetition.

Patches are limited to 64 modules, 128 cables and 256 KiB JSON. Invalid references, unknown parameters, mismatched ports and feedback loops are rejected. Delay/reverb provide bounded internal feedback. Browser storage can be cleared by the browser; export important patches.

`node-web-audio-api` is a **development-only** dependency for native rendered-audio tests. Its native backend is not shipped to the browser. These tests do not certify browser rendering, hardware latency, or how pleasing a patch sounds.

Fonts: DM Sans and Instrument Serif, bundled under the SIL Open Font License (copies in `public/licenses/`). Icons: Lucide, ISC. React, Vite, TypeScript, lz-string and testing dependencies retain their respective upstream licenses.
