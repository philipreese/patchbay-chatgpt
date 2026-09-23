import { AudioEngine } from './engine';
import { PRESETS } from '../presets';
import type { Patch } from '../types';

export type AudioVerification = { check: string; passed: boolean; measured: string };
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/** Call from a user-initiated click after constructing a dedicated engine. Results stream to report. */
export async function runAudioVerification(
  engine: AudioEngine,
  report: (result: AudioVerification) => void,
): Promise<AudioVerification[]> {
  const checks: AudioVerification[] = [];
  const publish = (result: AudioVerification) => { checks.push(result); report(result); };
  const measure = async (duration: number) => {
    let rms = 0, peak = 0;
    for (let elapsed = 0; elapsed < duration; elapsed += 40) {
      await wait(40);
      const reading = engine.getDiagnostics();
      rms = Math.max(rms, reading.rms);
      peak = Math.max(peak, reading.peak);
    }
    return { rms, peak };
  };
  try {
    await engine.start(PRESETS[0]);
    const bass = await measure(800);
    publish({ check: 'Sequenced bass reaches master output', passed: bass.rms > 0.0002,
      measured: `maximum RMS ${bass.rms.toFixed(5)}, peak ${bass.peak.toFixed(4)}` });

    const disconnected: Patch = { ...PRESETS[0], cables: PRESETS[0].cables.filter(cable => cable.to !== 'out') };
    engine.setPatch(disconnected);
    await wait(180); // edit fade and analyser window have elapsed
    const unplugged = await measure(160);
    publish({ check: 'Unplugged output is silent', passed: unplugged.rms < 0.0001,
      measured: `maximum RMS ${unplugged.rms.toFixed(6)}` });

    engine.panic();
    await engine.start(PRESETS[1]);
    const chord = [48, 52, 55, 59, 60, 64, 67, 71];
    for (const note of chord) engine.noteOn(note, 0.7);
    const voiceCount = engine.getDiagnostics().voices;
    await wait(750); // slow pad attack
    const poly = await measure(160);
    publish({ check: 'Eight-key pad chord sounds with eight voices', passed: voiceCount >= 8 && poly.rms > 0.0003,
      measured: `${voiceCount} voices, maximum RMS ${poly.rms.toFixed(5)}` });
    for (const note of chord) engine.noteOff(note);

    const cvPatch: Patch = {
      ...PRESETS[1], id: 'verify-cv', name: 'CV routing verification', master: 0.5,
      modules: PRESETS[1].modules.filter(module => ['keys', 'osc', 'env', 'amp', 'out'].includes(module.id)).map(module => {
        if (module.id === 'osc') return { ...module, params: { ...module.params, waveform: 'sine', level: 0.55 } };
        if (module.id === 'env') return { ...module, params: { ...module.params, attack: 2, decay: 0.1, sustain: 1, release: 0.4 } };
        if (module.id === 'amp') return { ...module, params: { gain: 0.8 } };
        return module;
      }),
      cables: PRESETS[1].cables.filter(cable =>
        ['keys-note-osc-note', 'keys-gate-env-gate', 'env-cv-amp-gain', 'amp-audio-out-audio'].includes(cable.id))
        .concat([
          { id: 'osc-audio-amp-audio', from: 'osc', fromPort: 'audio', to: 'amp', toPort: 'audio' },
          { id: 'amp-audio-out-audio', from: 'amp', fromPort: 'audio', to: 'out', toPort: 'audio' },
        ]),
    };
    engine.panic();
    await engine.start(cvPatch);
    engine.noteOn(60);
    const shaped = await measure(120);
    const cvTap = engine.getAnalyser('env');
    const masterTap = engine.getAnalyser('out') === engine.getAnalyser();
    engine.setPatch({ ...cvPatch, cables: cvPatch.cables.filter(cable => cable.toPort !== 'gain') });
    await wait(160);
    const unshaped = await measure(140);
    publish({ check: 'Envelope CV changes amplifier gain when unplugged',
      passed: unshaped.rms > Math.max(0.001, shaped.rms * 3),
      measured: `CV RMS ${shaped.rms.toFixed(5)}, unplugged RMS ${unshaped.rms.toFixed(5)}` });
    publish({ check: 'CV analyser is real; output analyser is the master', passed: !!cvTap && masterTap,
      measured: `envelope analyser ${!!cvTap}, output matches master ${masterTap}` });

    engine.panic();
    await wait(120);
    const stopped = await measure(100);
    publish({ check: 'Panic after live graph edit silences every tail', passed: stopped.rms < 0.0001,
      measured: `maximum RMS ${stopped.rms.toFixed(6)}` });

    await engine.start(PRESETS[0]);
    await engine.startRecording();
    await wait(900);
    const recording = await engine.stopRecording();
    let recordedRms = 0, decodedSeconds = 0;
    try {
      const decoder = new AudioContext();
      try {
        const audio = await decoder.decodeAudioData(await recording.blob.arrayBuffer());
        const samples = audio.getChannelData(0);
        let squares = 0;
        for (const sample of samples) squares += sample * sample;
        recordedRms = Math.sqrt(squares / Math.max(1, samples.length));
        decodedSeconds = audio.duration;
      } finally { await decoder.close(); }
    } catch { /* Report decode failure rather than claiming the blob is verified. */ }
    publish({ check: 'Recorded audio blob decodes with nonzero sound',
      passed: recording.blob.size > 512 && decodedSeconds > 0.3 && recordedRms > 0.0001,
      measured: `${recording.extension}, ${recording.blob.size} bytes, ${decodedSeconds.toFixed(2)} s, decoded RMS ${recordedRms.toFixed(5)}` });

    const maximumPeak = Math.max(bass.peak, poly.peak, shaped.peak, unshaped.peak);
    publish({ check: 'Output samples remain bounded', passed: maximumPeak <= 0.801,
      measured: `maximum sampled peak ${maximumPeak.toFixed(4)}` });
  } catch (error) {
    publish({ check: 'Audio verification completed', passed: false,
      measured: error instanceof Error ? error.message : String(error) });
  } finally {
    engine.panic();
  }
  return checks;
}
