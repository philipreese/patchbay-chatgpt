import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus, VolumeX } from 'lucide-react';
import { noteName } from '../presets';
import type { Patch } from '../types';
import './Performance.css';

interface KeyboardProps {
  category: Patch['category'];
  resetKey: string;
  activeNotes: number[];
  onNoteOn: (note: number, source: string) => void;
  onNoteOff: (note: number, source: string) => void;
  onReleaseAll: () => void;
  ready: boolean;
}

const COMPUTER_KEYS = [
  'a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k',
  'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/',
];
const CHORDS = [
  { name: 'Am9', notes: [57, 60, 64, 67, 71] },
  { name: 'Cmaj7', notes: [60, 64, 67, 71] },
  { name: 'Fmaj7', notes: [53, 57, 60, 64] },
  { name: 'G6', notes: [55, 59, 62, 64] },
];
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_POSITIONS = [0, 1, 3, 4, 5];

function editableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}

type Held = { notes: number[]; source: string };

export function Keyboard({ category, resetKey, activeNotes, onNoteOn, onNoteOff, onReleaseAll, ready }: KeyboardProps) {
  const [octave, setOctave] = useState(category === 'bass' ? 2 : 4);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  const visibleOctaves = compact ? 1 : 2;
  const held = useRef(new Map<string, Held>());
  const suppressClick = useRef(new Set<string>());
  const callbacks = useRef({ onNoteOn, onNoteOff, onReleaseAll });
  callbacks.current = { onNoteOn, onNoteOff, onReleaseAll };
  const base = (octave + 1) * 12;
  const latestBase = useRef(base);
  latestBase.current = base;

  function press(id: string, notes: number[]) {
    if (held.current.has(id)) return;
    const source = `performance:${id}`;
    held.current.set(id, { notes, source });
    notes.forEach(note => callbacks.current.onNoteOn(note, source));
  }

  function release(id: string) {
    const item = held.current.get(id);
    if (!item) return;
    held.current.delete(id);
    item.notes.forEach(note => callbacks.current.onNoteOff(note, item.source));
  }

  function releaseEverything() {
    held.current.forEach(item => item.notes.forEach(note => callbacks.current.onNoteOff(note, item.source)));
    held.current.clear();
  }

  useEffect(() => {
    function down(event: globalThis.KeyboardEvent) {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || editableTarget(event.target)) return;
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      const offset = COMPUTER_KEYS.indexOf(event.key.toLowerCase());
      if (offset < 0) return;
      event.preventDefault();
      const id = `key:${event.code}`;
      if (held.current.has(id)) return;
      const note = latestBase.current + offset;
      const source = `performance:${id}`;
      held.current.set(id, { notes: [note], source });
      callbacks.current.onNoteOn(note, source);
    }
    function up(event: globalThis.KeyboardEvent) {
      const id = `key:${event.code}`;
      const item = held.current.get(id);
      if (!item) return;
      event.preventDefault();
      held.current.delete(id);
      item.notes.forEach(note => callbacks.current.onNoteOff(note, item.source));
    }
    function blur() {
      held.current.forEach(item => item.notes.forEach(note => callbacks.current.onNoteOff(note, item.source)));
      held.current.clear();
      callbacks.current.onReleaseAll();
    }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      held.current.forEach(item => item.notes.forEach(note => callbacks.current.onNoteOff(note, item.source)));
      held.current.clear();
    };
  }, []);

  useEffect(() => {
    setOctave(category === 'bass' ? 2 : 4);
  }, [category]);

  useEffect(() => {
    releaseEverything();
  }, [resetKey]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  function startPointer(event: ReactPointerEvent<HTMLButtonElement>, id: string, notes: number[]) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    press(`pointer:${event.pointerId}:${id}`, notes);
  }

  function stopPointer(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    release(`pointer:${event.pointerId}:${id}`);
  }

  function handleAccessibleKey(event: ReactKeyboardEvent<HTMLButtonElement>, id: string, notes: number[], down: boolean) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (down) {
      suppressClick.current.add(id);
      press(`access:${id}`, notes);
      window.setTimeout(() => suppressClick.current.delete(id), 500);
    }
    else {
      release(`access:${id}`);
      suppressClick.current.add(id);
      window.setTimeout(() => suppressClick.current.delete(id), 500);
    }
  }

  function playAccessibleClick(id: string, notes: number[]) {
    if (suppressClick.current.delete(id)) return;
    const source = `performance:access-click:${id}`;
    notes.forEach(note => callbacks.current.onNoteOn(note, source));
    window.setTimeout(() => notes.forEach(note => callbacks.current.onNoteOff(note, source)), 260);
  }

  function octaveShift(amount: number) {
    releaseEverything();
    setOctave(current => Math.max(1, Math.min(6, current + amount)));
  }

  return <section className="pb-performance pb-keyboard" aria-label="Play the patch">
    <div className="pb-performance-heading">
      <div><span className="pb-performance-eyebrow">LIVE INPUT</span><h2>Play the patch</h2></div>
      <div className="pb-keyboard-actions">
        <div className="pb-octave" aria-label="Keyboard octave">
          <button type="button" aria-label="Octave down" disabled={octave <= 1} onClick={() => octaveShift(-1)}><Minus size={15} /></button>
          <span>C{octave}–B{octave + visibleOctaves - 1}</span>
          <button type="button" aria-label="Octave up" disabled={octave >= 6} onClick={() => octaveShift(1)}><Plus size={15} /></button>
        </div>
        <button type="button" className="pb-release" onClick={() => { releaseEverything(); onReleaseAll(); }} aria-label="Release all notes"><VolumeX size={15} /><span>Release</span></button>
      </div>
    </div>
    {category === 'pad' && <div className="pb-chord-area">
      <span className="pb-performance-caption">CHORD PADS <span>· hold to play</span></span>
      <div className="pb-chord-grid">{CHORDS.map(chord => <button
        type="button" key={chord.name} className="pb-chord"
        aria-label={`Hold ${chord.name} chord`}
        aria-pressed={chord.notes.every(note => activeNotes.includes(note))}
        onPointerDown={event => startPointer(event, `chord:${chord.name}`, chord.notes)}
        onPointerUp={event => stopPointer(event, `chord:${chord.name}`)}
        onPointerCancel={event => stopPointer(event, `chord:${chord.name}`)}
        onLostPointerCapture={event => stopPointer(event, `chord:${chord.name}`)}
        onKeyDown={event => handleAccessibleKey(event, `chord:${chord.name}`, chord.notes, true)}
        onKeyUp={event => handleAccessibleKey(event, `chord:${chord.name}`, chord.notes, false)}
        onBlur={() => release(`access:chord:${chord.name}`)}
        onClick={event => { if (event.detail === 0) playAccessibleClick(`chord:${chord.name}`, chord.notes); }}
      ><span>{chord.name}</span><small>{chord.notes.map(noteName).join(' · ')}</small></button>)}</div>
    </div>}
    <div className="pb-keys-scroll"><div className="pb-keys" role="group" aria-label={`${visibleOctaves === 1 ? 'One' : 'Two'} octave piano keyboard, C${octave} to B${octave + visibleOctaves - 1}`}>
      {Array.from({ length: visibleOctaves * 7 }, (_, index) => {
        const note = base + Math.floor(index / 7) * 12 + WHITE_OFFSETS[index % 7];
        const offset = note - base;
        return <button type="button" key={offset} className={`pb-piano-key pb-white-key ${activeNotes.includes(note) ? 'is-active' : ''}`}
          aria-label={`Play ${noteName(note)}${COMPUTER_KEYS[offset] ? `, computer key ${COMPUTER_KEYS[offset]}` : ''}`}
          aria-pressed={activeNotes.includes(note)}
          onPointerDown={event => startPointer(event, `note:${note}`, [note])}
          onPointerUp={event => stopPointer(event, `note:${note}`)}
          onPointerCancel={event => stopPointer(event, `note:${note}`)}
          onLostPointerCapture={event => stopPointer(event, `note:${note}`)}
          onKeyDown={event => handleAccessibleKey(event, `note:${note}`, [note], true)}
          onKeyUp={event => handleAccessibleKey(event, `note:${note}`, [note], false)}
          onBlur={() => release(`access:note:${note}`)}
          onClick={event => { if (event.detail === 0) playAccessibleClick(`note:${note}`, [note]); }}
        ><span>{index % 7 === 0 ? `C${octave + Math.floor(index / 7)}` : ''}</span><small>{COMPUTER_KEYS[offset]?.toUpperCase()}</small></button>;
      })}
      {Array.from({ length: visibleOctaves }, (_, oct) => BLACK_POSITIONS.map((position, index) => {
        const offset = oct * 12 + [1, 3, 6, 8, 10][index];
        const note = base + offset;
        return <button type="button" key={offset} className={`pb-piano-key pb-black-key ${activeNotes.includes(note) ? 'is-active' : ''}`}
          style={{ left: `${(oct * 7 + position + 1) / (visibleOctaves * 7) * 100}%` }}
          aria-label={`Play ${noteName(note)}${COMPUTER_KEYS[offset] ? `, computer key ${COMPUTER_KEYS[offset]}` : ''}`}
          aria-pressed={activeNotes.includes(note)}
          onPointerDown={event => startPointer(event, `note:${note}`, [note])}
          onPointerUp={event => stopPointer(event, `note:${note}`)}
          onPointerCancel={event => stopPointer(event, `note:${note}`)}
          onLostPointerCapture={event => stopPointer(event, `note:${note}`)}
          onKeyDown={event => handleAccessibleKey(event, `note:${note}`, [note], true)}
          onKeyUp={event => handleAccessibleKey(event, `note:${note}`, [note], false)}
          onBlur={() => release(`access:note:${note}`)}
          onClick={event => { if (event.detail === 0) playAccessibleClick(`note:${note}`, [note]); }}
        ><small>{COMPUTER_KEYS[offset]?.toUpperCase()}</small></button>;
      }))}
    </div></div>
    <p className="pb-keyboard-hint">{ready ? compact ? 'Hold keys to play · use − and + to reach another octave · computer keys A W S E D…' : 'Tap or hold keys to play · computer keys A W S E D… · K Z X… for the upper octave' : 'Enable audio above, then tap a key or use your computer keyboard to play.'}</p>
  </section>;
}

export default Keyboard;
