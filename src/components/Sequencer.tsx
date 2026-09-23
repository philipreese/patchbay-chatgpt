import { useState } from 'react';
import { noteName } from '../presets';
import type { Patch, Step } from '../types';
import './Performance.css';

interface SequencerProps {
  patch: Patch;
  step: number;
  playing: boolean;
  onChange: (patch: Patch) => void;
}

const NOTE_OPTIONS = Array.from({ length: 73 }, (_, index) => index + 24);
const DEFAULT_STEP: Step = { note: 60, active: false, velocity: 0.75 };

export function Sequencer({ patch, step, playing, onChange }: SequencerProps) {
  const [selected, setSelected] = useState(0);
  const module = patch.modules.find(item => item.type === 'sequencer');
  const steps = Array.from({ length: 16 }, (_, index) => patch.steps[index] ?? DEFAULT_STEP);
  const current = steps[selected];
  const gate = module ? Math.max(0.1, Math.min(0.95, Number(module.params.gate ?? 0.65))) : 0.65;

  function updateStep(index: number, change: Partial<Step>) {
    onChange({ ...patch, steps: steps.map((item, i) => i === index ? { ...item, ...change } : item) });
  }

  function updateGate(value: number) {
    if (!module) return;
    onChange({ ...patch, modules: patch.modules.map(item => item.id === module.id ? { ...item, params: { ...item.params, gate: value } } : item) });
  }

  if (!module) return null;

  return <section className="pb-performance pb-sequencer" aria-label="Step sequencer">
    <div className="pb-performance-heading">
      <div><span className="pb-performance-eyebrow">PATTERN</span><h2>Step sequencer</h2></div>
      <span className="pb-sequencer-counter" aria-live="off">{steps.filter(item => item.active).length}<span> / 16 notes</span></span>
    </div>
      <div className="pb-step-grid" role="group" aria-label="Sixteen pattern steps">
        {steps.map((item, index) => {
          const isCurrent = playing && step === index;
          return <button type="button" key={index}
            className={`pb-step ${item.active ? 'is-on' : ''} ${selected === index ? 'is-selected' : ''} ${isCurrent ? 'is-current' : ''}`}
            aria-label={`Step ${index + 1}, ${noteName(item.note)}, ${item.active ? 'on' : 'off'}${isCurrent ? ', playing now' : ''}. Toggle note`}
            aria-pressed={item.active}
            onClick={() => { setSelected(index); updateStep(index, { active: !item.active }); }}
          ><span className="pb-step-number">{String(index + 1).padStart(2, '0')}</span><span className="pb-step-note">{noteName(item.note)}</span><span className="pb-step-dot" aria-hidden="true" /></button>;
        })}
      </div>
      <div className="pb-sequencer-controls">
        <label className="pb-sequencer-note">
          <span>Edit step</span>
          <select value={selected} onChange={event => setSelected(Number(event.target.value))} aria-label="Choose step to edit without toggling it">
            {steps.map((item, index) => <option key={index} value={index}>Step {String(index + 1).padStart(2, '0')} · {item.active ? 'on' : 'off'}</option>)}
          </select>
        </label>
        <label className="pb-sequencer-note">
          <span>Step {String(selected + 1).padStart(2, '0')} pitch</span>
          <select value={current.note} onChange={event => updateStep(selected, { note: Number(event.target.value) })}>
            {NOTE_OPTIONS.map(note => <option key={note} value={note}>{noteName(note)}</option>)}
          </select>
        </label>
        <label className="pb-sequencer-slider">
          <span>Tempo <output>{patch.tempo} BPM</output></span>
          <input type="range" min="30" max="300" step="1" value={patch.tempo} onChange={event => onChange({ ...patch, tempo: Number(event.target.value) })} aria-label="Tempo in beats per minute" />
        </label>
        <label className="pb-sequencer-slider">
          <span>Gate length <output>{Math.round(gate * 100)}%</output></span>
          <input type="range" min="0.1" max="0.95" step="0.01" value={gate} onChange={event => updateGate(Number(event.target.value))} aria-label="Sequencer gate length" />
        </label>
      </div>
      <p className="pb-sequencer-hint">Tap a step to toggle it, or choose Edit step to change its pitch without toggling.</p>
  </section>;
}

export default Sequencer;
