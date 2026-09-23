// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import PatchCanvas from '../src/components/PatchCanvas';
import { PRESETS } from '../src/presets';
import { validatePatch } from '../src/storage';
import type { Patch } from '../src/types';

beforeEach(()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
 vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));
 vi.stubGlobal('cancelAnimationFrame',vi.fn());
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('patch editor interactions (simulated DOM)',()=>{
 it('deleting a mapped module preserves a saveable patch and selects the output',()=>{
  const onChange=vi.fn(),onSelect=vi.fn();
  render(<PatchCanvas patch={PRESETS[0]} selectedId="filter" onChange={onChange} onSelect={onSelect} onMessage={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Remove Filter'}));
  const next=onChange.mock.lastCall![0] as Patch;
  expect(()=>validatePatch(next)).not.toThrow();
  expect(next.modules.some(m=>m.id==='filter')).toBe(false);
  expect(next.macros.flatMap(m=>m.mappings).some(m=>m.moduleId==='filter')).toBe(false);
  expect(onSelect).toHaveBeenCalledWith('out');
  expect(screen.queryByRole('button',{name:'Remove Output'})).toBeNull();
 });
 it('disconnects and reconnects a real audio cable, rejecting a mismatched port',()=>{
  let latest=structuredClone(PRESETS[0]);const message=vi.fn();
  function Harness(){const [patch,setPatch]=useState(latest);return <PatchCanvas patch={patch} selectedId="out" onSelect={()=>{}} onChange={next=>{latest=next;setPatch(next);}} onMessage={message}/>;}
  render(<Harness/>);
  fireEvent.click(screen.getByRole('button',{name:'Disconnect Oscillator audio from Filter audio'}));
  expect(latest.cables.some(c=>c.from==='osc'&&c.to==='filter')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Oscillator Audio audio output'}));
  fireEvent.click(screen.getByRole('button',{name:/^Filter Cutoff cv input/}));
  expect(message.mock.lastCall![0]).toMatch(/AUDIO connects only/);
  fireEvent.click(screen.getByRole('button',{name:'Filter Audio audio input'}));
  expect(latest.cables.some(c=>c.from==='osc'&&c.to==='filter')).toBe(true);
  expect(()=>validatePatch(latest)).not.toThrow();
 });
 it('adds a module and moves it with the keyboard',()=>{
  let latest=structuredClone(PRESETS[0]);
  function Harness(){const [patch,setPatch]=useState(latest);return <PatchCanvas patch={patch} selectedId="out" onSelect={()=>{}} onChange={next=>{latest=next;setPatch(next);}} onMessage={()=>{}}/>;}
  render(<Harness/>);
  fireEvent.click(screen.getByRole('button',{name:'Add module'}));
  fireEvent.click(screen.getByRole('menuitem',{name:/Noise/}));
  const noise=latest.modules.find(m=>m.type==='noise')!;const x=noise.x;
  fireEvent.keyDown(screen.getByRole('article',{name:/^Noise module/}),{key:'ArrowRight'});
  expect(latest.modules.find(m=>m.id===noise.id)?.x).toBe(x+10);
  expect(()=>validatePatch(latest)).not.toThrow();
 });
 it('Escape cancels a pending cable without reaching the global panic handler',()=>{
  const outer=vi.fn();
  render(<div onKeyDown={outer}><PatchCanvas patch={PRESETS[0]} selectedId="out" onSelect={()=>{}} onChange={()=>{}} onMessage={()=>{}}/></div>);
  const port=screen.getByRole('button',{name:'Oscillator Audio audio output'});
  fireEvent.click(port);fireEvent.keyDown(port,{key:'Escape'});
  expect(outer).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:'Cancel cable'})).toBeNull();
 });
});
