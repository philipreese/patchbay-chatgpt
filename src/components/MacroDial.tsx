import { useRef } from 'react';
import type { Macro, Patch } from '../types';
interface Props { macro:Macro; patch:Patch; index:number; onChange:(value:number)=>void; }
export default function MacroDial({macro,patch,index,onChange}:Props){
 const drag=useRef<{pointer:number;y:number;x:number;value:number}|null>(null);const input=useRef<HTMLInputElement>(null);
 const custom=macro.mappings.some(map=>{const expected=map.curve==='exp'?map.min*Math.pow(map.max/map.min,macro.value):map.min+(map.max-map.min)*macro.value;const actual=Number(patch.modules.find(m=>m.id===map.moduleId)?.params[map.param]);return !Number.isFinite(actual)||Math.abs(actual-expected)>Math.max(.001,Math.abs(expected)*.001);});
 return <div className={`macro-control macro-${index}`}><div className="macro-knob" style={{'--angle':`${-135+macro.value*270}deg`,'--fill':`${macro.value*270}deg`} as React.CSSProperties}
  onPointerDown={e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();input.current?.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={pointer:e.pointerId,y:e.clientY,x:e.clientX,value:macro.value};}}
  onPointerMove={e=>{const d=drag.current;if(!d||d.pointer!==e.pointerId)return;const amount=(d.y-e.clientY+e.clientX-d.x)/180;onChange(Math.max(0,Math.min(1,d.value+amount)));}}
  onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null} onLostPointerCapture={()=>drag.current=null}>
  <span/><input ref={input} type="range" min="0" max="1" step="0.005" value={macro.value} aria-label={macro.name} aria-valuetext={custom?'Custom module settings. Adjust to apply this macro.':`${Math.round(macro.value*100)} percent`} onChange={e=>onChange(Number(e.target.value))}/></div><span className="macro-text"><strong>{macro.name}<small>{custom?'CUSTOM':Math.round(macro.value*100)}</small></strong><span>{macro.description}</span></span></div>;
}
