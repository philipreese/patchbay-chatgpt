import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, WheelEvent } from 'react';
import { Focus, Grip, Minus, Plus, Trash2, X } from 'lucide-react';
import { MODULE_SPECS, MODULE_TYPES, canConnect, createModule } from '../modules';
import type { Cable, ModuleType, ParamSpec, Patch, PatchModule, Port, SignalType } from '../types';
import './PatchCanvas.css';

interface Props {
  patch: Patch;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (patch: Patch) => void;
  onMessage: (message: string) => void;
}

type View = { x: number; y: number; zoom: number };
type Pending = { moduleId: string; portId: string; signal: SignalType };
type Gesture =
  | { kind: 'pan'; pointerId: number; startX: number; startY: number; origin: View }
  | { kind: 'drag'; pointerId: number; moduleId: string; startX: number; startY: number; originX: number; originY: number; moved: boolean };

const NODE_WIDTH = 220;
const HEADER_HEIGHT = 62;
const PORT_PADDING = 8;
const PORT_ROW = 30;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.7;
const SIGNAL_COLORS: Record<SignalType, string> = {
  audio: '#d6ef8b', cv: '#c4b4ed', note: '#aabdf5', gate: '#f19b78',
};
const MODULE_GROUPS: { title: string; types: ModuleType[] }[] = [
  { title: 'Sources', types: ['oscillator', 'noise', 'keyboard', 'sequencer'] },
  { title: 'Shape & move', types: ['filter', 'envelope', 'lfo', 'amplifier'] },
  { title: 'Mix & space', types: ['mixer', 'delay', 'reverb'] },
];

function nodeHeight(module: PatchModule) {
  const spec = MODULE_SPECS[module.type];
  const ports = Math.max(spec.inputs.length, spec.outputs.length, 1);
  return HEADER_HEIGHT + PORT_PADDING * 2 + ports * PORT_ROW + (spec.params.length ? 18 + spec.params.length * 52 + 12 : 15);
}

function portPoint(module: PatchModule, direction: 'in' | 'out', portId: string) {
  const spec = MODULE_SPECS[module.type];
  const index = (direction === 'in' ? spec.inputs : spec.outputs).findIndex(port => port.id === portId);
  return { x: module.x + (direction === 'in' ? 0 : NODE_WIDTH), y: module.y + HEADER_HEIGHT + PORT_PADDING + PORT_ROW * (index + 0.5) };
}

function cableGeometry(patch: Patch, cable: Cable, positions: Record<string, { x: number; y: number }>) {
  const source = patch.modules.find(module => module.id === cable.from);
  const target = patch.modules.find(module => module.id === cable.to);
  if (!source || !target) return null;
  const from = portPoint({ ...source, ...positions[source.id] }, 'out', cable.fromPort);
  const to = portPoint({ ...target, ...positions[target.id] }, 'in', cable.toPort);
  const bend = Math.max(55, Math.min(180, Math.abs(to.x - from.x) * 0.48));
  return {
    path: `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`,
    midpoint: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
    from, to,
  };
}

function formatValue(value: string | number, param: ParamSpec) {
  if (typeof value === 'string') return value;
  const digits = param.step < 0.01 ? 3 : param.step < 1 ? 2 : 0;
  return `${Number(value.toFixed(digits))}${param.unit ? ` ${param.unit}` : ''}`;
}

function valueToSlider(value: number, param: ParamSpec) {
  if (param.scale === 'log') return Math.log(value / param.min) / Math.log(param.max / param.min) * 1000;
  return (value - param.min) / (param.max - param.min) * 1000;
}

function sliderToValue(slider: number, param: ParamSpec) {
  const fraction = slider / 1000;
  const raw = param.scale === 'log' ? param.min * Math.pow(param.max / param.min, fraction) : param.min + (param.max - param.min) * fraction;
  const stepped = Math.round(raw / param.step) * param.step;
  return Math.max(param.min, Math.min(param.max, Number(stepped.toFixed(4))));
}

function freshId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `cable-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PatchCanvas({ patch, selectedId, onSelect, onChange, onMessage }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View>({ x: 80, y: 70, zoom: 1 });
  const [view, setView] = useState(viewRef.current);
  const [pending, setPending] = useState<Pending | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const positionsRef = useRef(positions);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; view: View; midpoint: { x: number; y: number } } | null>(null);

  const updateView = useCallback((next: View) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const fit = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    if (!patch.modules.length) {
      updateView({ x: width / 2, y: height / 2, zoom: 1 });
      return;
    }
    const minX = Math.min(...patch.modules.map(module => module.x));
    const minY = Math.min(...patch.modules.map(module => module.y));
    const maxX = Math.max(...patch.modules.map(module => module.x + NODE_WIDTH));
    const maxY = Math.max(...patch.modules.map(module => module.y + nodeHeight(module)));
    const zoom = Math.max(MIN_ZOOM, Math.min(1.15, Math.min((width - 100) / Math.max(1, maxX - minX), (height - 90) / Math.max(1, maxY - minY))));
    updateView({ x: width / 2 - (minX + maxX) / 2 * zoom, y: height / 2 - (minY + maxY) / 2 * zoom, zoom });
  }, [patch.modules, updateView]);

  // Refit a newly loaded patch; ordinary edits keep the user's view in place.
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const frame = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(frame);
  }, [patch.id]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => { if (!gesture.current) fitRef.current(); });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pending && !patch.modules.some(module => module.id === pending.moduleId)) setPending(null);
  }, [patch.modules, pending]);

  const zoomAt = useCallback((nextZoom: number, clientX?: number, clientY?: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    const current = viewRef.current;
    const x = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const y = (clientY ?? rect.top + rect.height / 2) - rect.top;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    updateView({ x: x - (x - current.x) * zoom / current.zoom, y: y - (y - current.y) * zoom / current.zoom, zoom });
  }, [updateView]);

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomAt(viewRef.current.zoom * Math.exp(-event.deltaY * 0.0012), event.clientX, event.clientY);
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).closest('.pb-canvas-grid, .pb-cable-layer')) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current = { kind: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: viewRef.current };
  }

  function startDrag(event: PointerEvent<HTMLElement>, module: PatchModule) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    viewport.current?.setPointerCapture(event.pointerId);
    gesture.current = {
      kind: 'drag', pointerId: event.pointerId, moduleId: module.id, startX: event.clientX, startY: event.clientY,
      originX: module.x, originY: module.y, moved: false,
    };
    onSelect(module.id);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!pinch.current) pinch.current = { distance, view: viewRef.current, midpoint };
      else {
        const origin = pinch.current;
        const rect = viewport.current?.getBoundingClientRect();
        if (rect) {
          const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, origin.view.zoom * distance / Math.max(origin.distance, 1)));
          const initialX = origin.midpoint.x - rect.left;
          const initialY = origin.midpoint.y - rect.top;
          updateView({
            x: midpoint.x - rect.left - (initialX - origin.view.x) * zoom / origin.view.zoom,
            y: midpoint.y - rect.top - (initialY - origin.view.y) * zoom / origin.view.zoom,
            zoom,
          });
        }
      }
      return;
    }
    const action = gesture.current;
    if (!action || action.pointerId !== event.pointerId) return;
    if (action.kind === 'pan') {
      updateView({ ...action.origin, x: action.origin.x + event.clientX - action.startX, y: action.origin.y + event.clientY - action.startY });
    } else {
      const x = Math.round(action.originX + (event.clientX - action.startX) / viewRef.current.zoom);
      const y = Math.round(action.originY + (event.clientY - action.startY) / viewRef.current.zoom);
      if (Math.hypot(event.clientX - action.startX, event.clientY - action.startY) > 3) action.moved = true;
      const next = { ...positionsRef.current, [action.moduleId]: { x, y } };
      positionsRef.current = next;
      setPositions(next);
    }
  }

  function endPointer(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const action = gesture.current;
    if (!action || action.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (action.kind === 'drag') {
      const position = positionsRef.current[action.moduleId];
      if (position && action.moved) {
        onChange({ ...patch, modules: patch.modules.map(module => module.id === action.moduleId ? { ...module, ...position } : module) });
      }
      const { [action.moduleId]: _discarded, ...rest } = positionsRef.current;
      void _discarded;
      positionsRef.current = rest;
      setPositions(rest);
    }
  }

  function addModule(type: ModuleType) {
    const rect = viewport.current?.getBoundingClientRect();
    const current = viewRef.current;
    const offset = patch.modules.length % 4 * 28;
    const x = Math.round(((rect?.width ?? 900) / 2 - current.x) / current.zoom - NODE_WIDTH / 2 + offset);
    const y = Math.round(((rect?.height ?? 600) / 2 - current.y) / current.zoom - 90 + offset);
    const module = createModule(type, x, y);
    onChange({ ...patch, modules: [...patch.modules, module] });
    onSelect(module.id);
    setAddOpen(false);
    onMessage(`${MODULE_SPECS[type].name} added. Drag its header to place it.`);
  }

  function removeModule(module: PatchModule) {
    if (module.type === 'output') return;
    const cablesRemoved = patch.cables.filter(cable => cable.from === module.id || cable.to === module.id).length;
    const modules = patch.modules.filter(item => item.id !== module.id);
    onChange({ ...patch, modules, cables: patch.cables.filter(cable => cable.from !== module.id && cable.to !== module.id) });
    if (pending?.moduleId === module.id) setPending(null);
    if (selectedId === module.id && modules.length) onSelect(modules[0].id);
    onMessage(`${MODULE_SPECS[module.type].name} removed${cablesRemoved ? ` with ${cablesRemoved} cable${cablesRemoved === 1 ? '' : 's'}` : ''}.`);
  }

  function choosePort(module: PatchModule, port: Port, direction: 'in' | 'out') {
    if (direction === 'out') {
      if (pending?.moduleId === module.id && pending.portId === port.id) {
        setPending(null);
        onMessage('Cable cancelled.');
      } else {
        setPending({ moduleId: module.id, portId: port.id, signal: port.signal });
        onMessage(`${port.signal.toUpperCase()} cable ready. Tap a matching input to connect; Escape cancels.`);
      }
      return;
    }
    if (!pending) {
      onMessage('Tap an output port first, then tap this input.');
      return;
    }
    const check = canConnect(patch, pending.moduleId, pending.portId, module.id, port.id);
    if (!check.ok) {
      onMessage(check.reason ?? 'These ports cannot connect.');
      return;
    }
    const cable: Cable = { id: freshId(), from: pending.moduleId, fromPort: pending.portId, to: module.id, toPort: port.id };
    onChange({ ...patch, cables: [...patch.cables, cable] });
    setPending(null);
    onMessage(`${pending.signal.toUpperCase()} cable connected. Tap its × to disconnect.`);
  }

  function setParameter(moduleId: string, id: string, value: string | number) {
    onChange({ ...patch, modules: patch.modules.map(module => module.id === moduleId ? { ...module, params: { ...module.params, [id]: value } } : module) });
  }

  const drawnCables = useMemo(() => patch.cables.map(cable => ({ cable, geometry: cableGeometry(patch, cable, positions) })).filter(item => item.geometry !== null), [patch, positions]);
  const activeSource = pending && patch.modules.find(module => module.id === pending.moduleId);

  return (
    <section className="pb-canvas" aria-label="Modular patch canvas" onKeyDown={event => {
      if (event.key === 'Escape') { setPending(null); setAddOpen(false); onMessage('Cable cancelled.'); }
    }}>
      <div className="pb-canvas-toolbar">
        <div className="pb-add-wrap">
          <button type="button" className="pb-toolbar-primary" onClick={() => setAddOpen(open => !open)} aria-expanded={addOpen} aria-haspopup="menu">
            <Plus size={16} aria-hidden="true" /> Add module
          </button>
          {addOpen && (
            <div className="pb-add-menu" role="menu" aria-label="Add module">
              <div className="pb-add-menu-heading">Build your signal chain</div>
              {MODULE_GROUPS.map(group => <div key={group.title} className="pb-add-group">
                <div className="pb-add-group-title">{group.title}</div>
                {group.types.map(type => <button type="button" role="menuitem" className="pb-add-item" key={type} onClick={() => addModule(type)}>
                  <span className="pb-add-glyph" style={{ '--module-accent': MODULE_SPECS[type].color } as CSSProperties}>{MODULE_SPECS[type].short.slice(0, 1)}</span>
                  <span><strong>{MODULE_SPECS[type].name}</strong><small>{MODULE_SPECS[type].description}</small></span>
                </button>)}
              </div>)}
            </div>
          )}
        </div>
        <div className="pb-toolbar-spacer" />
        <span className="pb-toolbar-stat" aria-label={`${patch.modules.length} modules, ${patch.cables.length} cables`}>{patch.modules.length} modules <span>·</span> {patch.cables.length} cables</span>
        <div className="pb-toolbar-zoom" aria-label="Canvas zoom controls">
          <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomAt(viewRef.current.zoom / 1.2)}><Minus size={16} /></button>
          <span>{Math.round(view.zoom * 100)}%</span>
          <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomAt(viewRef.current.zoom * 1.2)}><Plus size={16} /></button>
        </div>
        <button type="button" className="pb-fit-button" onClick={fit} title="Fit all modules" aria-label="Fit all modules"><Focus size={16} /><span>Fit</span></button>
      </div>
      <div className="pb-canvas-viewport" ref={viewport} onWheel={onWheel} onPointerDown={startPan} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}>
        <div className="pb-canvas-grid" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px` }} aria-hidden="true" />
        <div className="pb-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <svg className="pb-cable-layer" width="1" height="1" aria-hidden="true">
            {drawnCables.map(({ cable, geometry }) => {
              if (!geometry) return null;
              const source = patch.modules.find(module => module.id === cable.from);
              const signal = source ? MODULE_SPECS[source.type].outputs.find(port => port.id === cable.fromPort)?.signal : 'audio';
              return <g key={cable.id}>
                <path d={geometry.path} stroke="#0b100d" strokeWidth="8" fill="none" />
                <path d={geometry.path} stroke={SIGNAL_COLORS[signal ?? 'audio']} strokeWidth="3" fill="none" />
              </g>;
            })}
            {pending && activeSource && (() => {
              const point = portPoint({ ...activeSource, ...positions[activeSource.id] }, 'out', pending.portId);
              return <circle cx={point.x} cy={point.y} r="10" fill="none" stroke={SIGNAL_COLORS[pending.signal]} strokeWidth="2" opacity="0.6" />;
            })()}
          </svg>
          {drawnCables.map(({ cable, geometry }) => geometry && <button
            key={cable.id} type="button" className="pb-cable-remove"
            style={{ left: geometry.midpoint.x, top: geometry.midpoint.y, '--cable-color': SIGNAL_COLORS[(patch.modules.find(module => module.id === cable.from) && MODULE_SPECS[patch.modules.find(module => module.id === cable.from)!.type].outputs.find(port => port.id === cable.fromPort)?.signal) || 'audio'] } as CSSProperties}
            title={`Disconnect ${cable.fromPort} → ${cable.toPort}`}
            aria-label={`Disconnect ${MODULE_SPECS[patch.modules.find(module => module.id === cable.from)!.type].name} ${cable.fromPort} from ${MODULE_SPECS[patch.modules.find(module => module.id === cable.to)!.type].name} ${cable.toPort}`}
            onClick={() => { onChange({ ...patch, cables: patch.cables.filter(item => item.id !== cable.id) }); onMessage('Cable disconnected.'); }}
          ><X size={11} strokeWidth={2.5} /></button>)}
          {patch.modules.map(module => {
            const spec = MODULE_SPECS[module.type];
            const selected = selectedId === module.id;
            const position = positions[module.id] ?? module;
            return <article key={module.id} className={`pb-node ${selected ? 'pb-node-selected' : ''}`} style={{ left: position.x, top: position.y, '--module-accent': spec.color } as CSSProperties} aria-label={`${spec.name} module`}>
              <div className="pb-node-heading" onPointerDown={event => startDrag(event, module)}>
                <span className="pb-node-led" aria-hidden="true" />
                <div className="pb-node-title"><span>{spec.short}</span><strong>{spec.name}</strong></div>
                <Grip size={15} className="pb-node-grip" aria-hidden="true" />
                {module.type !== 'output' && <button type="button" className="pb-node-delete" title={`Remove ${spec.name}`} aria-label={`Remove ${spec.name}`} onPointerDown={event => event.stopPropagation()} onClick={() => removeModule(module)}><Trash2 size={14} /></button>}
              </div>
              <div className="pb-node-ports" style={{ height: PORT_PADDING * 2 + PORT_ROW * Math.max(spec.inputs.length, spec.outputs.length, 1) }}>
                <div className="pb-port-column pb-port-inputs">
                  {spec.inputs.map(port => <button key={port.id} type="button"
                    className={`pb-port pb-port-in ${patch.cables.some(cable => cable.to === module.id && cable.toPort === port.id) ? 'pb-port-connected' : ''} ${pending?.signal === port.signal ? 'pb-port-compatible' : ''}`}
                    style={{ '--port-color': SIGNAL_COLORS[port.signal] } as CSSProperties}
                    title={`${port.signal.toUpperCase()} input: ${port.label}`} aria-label={`${spec.name} ${port.label} ${port.signal} input${patch.cables.some(cable => cable.to === module.id && cable.toPort === port.id) ? ', connected' : ''}`}
                    onClick={() => choosePort(module, port, 'in')}><span className="pb-port-dot" /><span>{port.label}</span></button>)}
                </div>
                <div className="pb-port-column pb-port-outputs">
                  {spec.outputs.map(port => <button key={port.id} type="button"
                    className={`pb-port pb-port-out ${pending?.moduleId === module.id && pending.portId === port.id ? 'pb-port-pending' : ''}`}
                    style={{ '--port-color': SIGNAL_COLORS[port.signal] } as CSSProperties}
                    title={`${port.signal.toUpperCase()} output: ${port.label}`} aria-label={`${spec.name} ${port.label} ${port.signal} output`}
                    aria-pressed={pending?.moduleId === module.id && pending.portId === port.id}
                    onClick={() => choosePort(module, port, 'out')}><span>{port.label}</span><span className="pb-port-dot" /></button>)}
                </div>
              </div>
              {spec.params.length > 0 ? <div className="pb-node-params">
                <div className="pb-node-section-label">CONTROLS</div>
                {spec.params.map(param => {
                  const raw = module.params[param.id] ?? param.default;
                  return <label className="pb-param" key={param.id}>
                    <span className="pb-param-line"><span>{param.label}</span><output>{formatValue(raw, param)}</output></span>
                    {param.options ? <select value={String(raw)} aria-label={`${spec.name} ${param.label}`} onChange={event => {
                      const value = typeof param.default === 'number' ? Number(event.target.value) : event.target.value;
                      setParameter(module.id, param.id, value);
                    }}>
                      {param.options.map(option => <option value={option} key={option}>{option === '1' ? '1/4' : option === '2' ? '1/8' : option === '4' ? '1/16' : option}</option>)}
                    </select> : <input type="range" min={0} max={1000} step={1} value={valueToSlider(Number(raw), param)}
                      aria-label={`${spec.name} ${param.label}`} aria-valuetext={formatValue(raw, param)}
                      onChange={event => setParameter(module.id, param.id, sliderToValue(Number(event.target.value), param))} />}
                  </label>;
                })}
              </div> : <div className="pb-node-empty">{module.type === 'keyboard' ? 'Play from the keyboard below' : 'Final sound output'}</div>}
            </article>;
          })}
        </div>
      </div>
      <div className={`pb-canvas-hint ${pending ? 'pb-canvas-hint-active' : ''}`} role="status" aria-live="polite">
        <span className="pb-hint-light" />
        {pending ? <>Connecting <strong>{pending.signal.toUpperCase()}</strong> · tap a matching input <button type="button" onClick={() => setPending(null)} aria-label="Cancel cable">Cancel</button></>
          : <>Tap an output, then an input to patch <span className="pb-hint-divider">·</span> Drag modules to arrange <span className="pb-hint-divider">·</span> Drag empty space to pan</>}
      </div>
    </section>
  );
}

export default PatchCanvas;
