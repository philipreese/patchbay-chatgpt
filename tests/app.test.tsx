// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';

const engineHarness = vi.hoisted(() => ({ instances: [] as Array<Record<string, any>> }));

vi.mock('../src/audio/engine', () => ({
  AudioEngine: class {
    setPatch = vi.fn();
    start = vi.fn(async () => undefined);
    setPlaying = vi.fn();
    noteOn = vi.fn();
    noteOff = vi.fn();
    panic = vi.fn();
    getSnapshot = vi.fn(() => ({ ready: false, playing: false, step: -1, activeNotes: [], recording: false, recordingSeconds: 0, contextState: 'not started' }));
    getAnalyser = vi.fn(() => null);
    startRecording = vi.fn(async () => undefined);
    stopRecording = vi.fn(async () => ({ blob: new Blob(), extension: 'webm', duration: 0 }));
    dispose = vi.fn();
    constructor() { engineHarness.instances.push(this); }
  },
}));

beforeEach(() => {
  engineHarness.instances.length = 0;
  localStorage.clear();
  history.replaceState(null, '', '/patchbay-chatgpt/');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function currentEngine() {
  const engine = engineHarness.instances[0];
  if (!engine) throw new Error('App did not create its audio engine');
  return engine;
}

describe('Patchbay app flows', () => {
  it('renders the initial preset and lets the user change Color, save a named copy, and reload it', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'After hours' })).toBeTruthy();

    fireEvent.change(screen.getByRole('slider', { name: 'Color' }), { target: { value: '1' } });
    expect(screen.getByRole('slider', { name: 'Color' }).getAttribute('aria-valuetext')).toBe('100 percent');

    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByLabelText('Patch name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'My saved color' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save on this device/ }));
    expect(screen.getByText('Saved “My saved color” on this device.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /My patches/ }));
    const library = screen.getByRole('dialog');
    expect(within(library).getByText('My saved color')).toBeTruthy();
    fireEvent.click(within(library).getByText('My saved color'));
    expect(screen.getByRole('heading', { name: 'My saved color' })).toBeTruthy();
    expect(currentEngine().panic).toHaveBeenCalled();
  });

  it('creates a share link with the hosted deployment path intact', () => {
    history.replaceState(null, '', '/patchbay-chatgpt/?from=test');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Share patch/ }));
    const share = screen.getByLabelText('Patch link') as HTMLTextAreaElement;
    const url = new URL(share.value);
    expect(url.pathname).toBe('/patchbay-chatgpt/');
    expect(url.search).toBe('?from=test');
    expect(url.hash.startsWith('#patch=')).toBe(true);
  });

  it('shows a visible notice when the URL contains a malformed shared patch', () => {
    history.replaceState(null, '', '/patchbay-chatgpt/#patch=not-valid');
    render(<App />);
    expect(screen.getByText(/That shared patch could not be opened\./)).toBeTruthy();
  });

  it('panics when switching presets and shows chord pads for Pad', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Load Velvet sky pad patch/ }));
    expect(currentEngine().panic).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Hold Am9 chord' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hold Cmaj7 chord' })).toBeTruthy();
  });
});
