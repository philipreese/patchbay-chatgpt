// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Keyboard from '../src/components/Keyboard';
import Sequencer from '../src/components/Sequencer';
import { PRESETS } from '../src/presets';
import type { Patch } from '../src/types';

function setViewport(small: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((media: string) => ({
      media,
      matches: small && media === '(max-width: 640px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });
}

function keyboardProps(category: Patch['category'] = 'bass') {
  return {
    category,
    resetKey: 'first-patch',
    activeNotes: [] as number[],
    ready: true,
    onNoteOn: vi.fn<(note: number, source: string) => void>(),
    onNoteOff: vi.fn<(note: number, source: string) => void>(),
    onReleaseAll: vi.fn(),
  };
}

beforeEach(() => {
  setViewport(false);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('dialog').forEach(dialog => dialog.remove());
  vi.restoreAllMocks();
});

describe('performance controls (React DOM in jsdom)', () => {
  it('plays A after another button has focus, but ignores text input and an open modal', () => {
    const props = keyboardProps();
    render(<><button type="button">Enable audio</button><input aria-label="Patch name" /><Keyboard {...props} /></>);
    const external = screen.getByRole('button', { name: 'Enable audio' });
    external.focus();
    fireEvent.keyDown(external, { key: 'a', code: 'KeyA' });
    expect(props.onNoteOn).toHaveBeenCalledWith(36, 'performance:key:KeyA');
    fireEvent.keyUp(external, { key: 'a', code: 'KeyA' });
    expect(props.onNoteOff).toHaveBeenCalledWith(36, 'performance:key:KeyA');

    const input = screen.getByRole('textbox', { name: 'Patch name' });
    input.focus();
    fireEvent.keyDown(input, { key: 'a', code: 'KeyA' });
    expect(props.onNoteOn).toHaveBeenCalledTimes(1);

    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    external.focus();
    fireEvent.keyDown(external, { key: 'a', code: 'KeyA' });
    expect(props.onNoteOn).toHaveBeenCalledTimes(1);
  });

  it('holds a multi-note pad chord and releases every note when the pointer lifts', () => {
    const props = keyboardProps('pad');
    render(<Keyboard {...props} />);
    const pad = screen.getByRole('button', { name: 'Hold Am9 chord' });
    fireEvent.pointerDown(pad, { pointerId: 7, pointerType: 'touch', button: 0 });
    expect(props.onNoteOn.mock.calls.map(([note]) => note)).toEqual([57, 60, 64, 67, 71]);
    fireEvent.pointerUp(pad, { pointerId: 7, pointerType: 'touch' });
    expect(props.onNoteOff.mock.calls.map(([note]) => note)).toEqual([57, 60, 64, 67, 71]);
    expect(props.onNoteOff.mock.calls.every(([_, source]) => source === props.onNoteOn.mock.calls[0][1])).toBe(true);
  });

  it('releases a held computer note when a different patch ID arrives', () => {
    const props = keyboardProps();
    const { rerender } = render(<Keyboard {...props} />);
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' });
    expect(props.onNoteOn).toHaveBeenCalledTimes(1);
    rerender(<Keyboard {...props} resetKey="second-patch" />);
    expect(props.onNoteOff).toHaveBeenCalledWith(36, 'performance:key:KeyA');
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' });
    expect(props.onNoteOn).toHaveBeenCalledTimes(2);
  });

  it('shows one complete octave on phone viewport and reaches the next with octave up', () => {
    setViewport(true);
    render(<Keyboard {...keyboardProps('lead')} />);
    expect(screen.getByRole('group', { name: 'One octave piano keyboard, C4 to B4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Play B4/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Play C5/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Octave up' }));
    expect(screen.getByRole('group', { name: 'One octave piano keyboard, C5 to B5' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Play C5/ })).toBeTruthy();
  });

  it('edits an inactive step pitch without enabling it and hides when no sequencer exists', () => {
    const patch = structuredClone(PRESETS[0]);
    const onChange = vi.fn<(next: Patch) => void>();
    const { rerender } = render(<Sequencer patch={patch} step={-1} playing={false} onChange={onChange} />);
    expect(patch.steps[1].active).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose step to edit without toggling it' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Step 02 pitch' }), { target: { value: '48' } });
    const changed = onChange.mock.lastCall?.[0];
    expect(changed?.steps[1]).toMatchObject({ note: 48, active: false });
    expect(changed?.steps[0]).toEqual(patch.steps[0]);

    rerender(<Sequencer patch={structuredClone(PRESETS[1])} step={-1} playing={false} onChange={onChange} />);
    expect(screen.queryByRole('region', { name: 'Step sequencer' })).toBeNull();
  });
});
