import { MODULE_SPECS } from './modules';
import type { Cable, Macro, ModuleType, Patch, PatchModule } from './types';
const module = (id: string, type: ModuleType, x: number, y: number, params: PatchModule['params'] = {}): PatchModule => ({id,type,x,y,params:{...Object.fromEntries(MODULE_SPECS[type].params.map(p=>[p.id,p.default])),...params}});
const cable = (from:string, fromPort:string, to:string, toPort:string): Cable => ({id:`${from}-${fromPort}-${to}-${toPort}`,from,fromPort,to,toPort});
const wire = (from:string,to:string) => cable(from,'audio',to,'audio');
const macro = (id:string,name:string,description:string,value:number,mappings:Macro['mappings']):Macro => ({id,name,description,value,mappings});
const baseModules = (kind:Patch['category']):PatchModule[] => {
 const isPad=kind==='pad', isAmbient=kind==='ambient', isLead=kind==='lead';
 return [
  module('keys','keyboard',30,35),
  ...(!isPad && !isLead ? [module('seq','sequencer',30,230,{rate:isAmbient?1:4,gate:isAmbient?.9:.54})]:[]),
  module('osc','oscillator',300,35,{waveform:isPad?'sawtooth':isAmbient?'sine':isLead?'sawtooth':'square',level:isPad?.19:isAmbient?.3:.27,detune:isPad?-7:0}),
  ...(isPad?[module('osc2','oscillator',300,440,{waveform:'triangle',level:.25,detune:7}),module('mix','mixer',565,420,{a:.65,b:.6})]:[]),
  module('env','envelope',565,35,{attack:isPad?.65:isAmbient?1.2:.008,decay:isAmbient?1.5:.24,sustain:isPad?.8:isAmbient?.6:isLead?.65:.25,release:isPad?2.4:isAmbient?4:isLead?.45:.12}),
  module('filter','filter',835,35,{cutoff:isPad?1700:isAmbient?2800:isLead?2800:850,resonance:isPad?1.4:isAmbient?.8:isLead?2.2:5.2}),
  module('lfo','lfo',835,440,{rate:isPad?.14:isAmbient?.08:isLead?5.2:.32,depth:isPad?.18:isAmbient?.32:isLead?.035:.12}),
  module('amp','amplifier',1100,35,{gain:isPad?.58:isAmbient?.58:.7}),
  module('delay','delay',1365,35,{time:isAmbient?.68:isLead?.27:.34,feedback:isAmbient?.55:isPad?.32:.26,mix:isAmbient?.38:isLead?.28:isPad?.2:.1}),
  module('reverb','reverb',1630,35,{size:isAmbient?.92:isPad?.8:.4,mix:isAmbient?.55:isPad?.42:isLead?.22:.08}),
  module('out','output',1895,35),
 ];
};
const build = (id:string,name:string,description:string,category:Patch['category'],tempo:number,notes:number[],active:number[]):Patch => {
 const pad=category==='pad',ambient=category==='ambient';
 const cables=[cable('keys','note','osc','note'),cable('keys','gate','env','gate'),wire('osc','filter'),wire('filter','amp'),cable('env','cv','amp','gain'),wire('amp','delay'),wire('delay','reverb'),wire('reverb','out'),cable('lfo','cv',category==='lead'?'osc':'filter',category==='lead'?'fm':'cutoff')];
 if(category==='bass'||ambient)cables.push(cable('seq','note','osc','note'),cable('seq','gate','env','gate'));
 if(pad){cables.splice(cables.findIndex(c=>c.from==='osc'&&c.to==='filter'),1);cables.push(cable('keys','note','osc2','note'),cable('osc','audio','mix','a'),cable('osc2','audio','mix','b'),wire('mix','filter'));}
 return {version:1,id,name,description,category,tempo,master:.36,modules:baseModules(category),cables,steps:Array.from({length:16},(_,i)=>({note:notes[i%notes.length],active:active.includes(i),velocity:i%4===0?.85:.65})),macros:[
  macro('brightness','Color','From velvet to electric',.4,[{moduleId:'filter',param:'cutoff',min:140,max:10000,curve:'exp'}]),
  macro('shape',pad||ambient?'Bloom':'Bite',pad||ambient?'Let every note unfold':'Soft edges, sharp attitude',.3,pad||ambient?[{moduleId:'env',param:'attack',min:.02,max:2.4},{moduleId:'env',param:'release',min:.3,max:5}]:[{moduleId:'filter',param:'resonance',min:.5,max:12},{moduleId:'env',param:'decay',min:.08,max:.85}]),
  macro('motion','Motion','A little movement goes a long way',.25,[{moduleId:'lfo',param:'depth',min:0,max:category==='lead'?.15:.7},{moduleId:'lfo',param:'rate',min:category==='lead'?3:.05,max:category==='lead'?8:2,curve:'exp'}]),
  macro('space','Space','Intimate room to infinite sky',ambient?.7:pad?.55:.2,[{moduleId:'reverb',param:'mix',min:0,max:.7},{moduleId:'delay',param:'mix',min:0,max:.45}]),
 ]};
};
export const PRESETS: Patch[] = [
 build('after-hours','After hours','A warm, elastic bassline. Give it a little bite.', 'bass',108,[36,36,43,36,36,46,43,36,36,48,43,46,36,43,34,36],[0,2,3,6,8,10,11,14]),
 build('velvet-sky','Velvet sky','Slow waves of color. Hold a chord and let it bloom.', 'pad',76,[60,64,67,71],[0,4,8,12]),
 build('neon-thread','Neon thread','A bright voice with a little wander in its step.', 'lead',112,[60,62,64,67],[0,2,4,6,8,10,12,14]),
 build('drift','Drift','An ever-changing little world. Just press play.', 'ambient',56,[57,64,69,71,76,64,60,67,72,69,64,76,67,71,60,64],[0,2,4,5,8,10,12,14]),
];
export function copyPreset(patch:Patch):Patch{return structuredClone(patch);}
export function applyMacro(patch:Patch,id:string,value:number):Patch {
 const found=patch.macros.find(m=>m.id===id);if(!found)return patch;
 const v=Math.max(0,Math.min(1,value));
 return {...patch,macros:patch.macros.map(m=>m.id===id?{...m,value:v}:m),modules:patch.modules.map(m=>{const mappings=found.mappings.filter(x=>x.moduleId===m.id);if(!mappings.length)return m; const params={...m.params};mappings.forEach(x=>{params[x.param]=x.curve==='exp'?x.min*Math.pow(x.max/x.min,v):x.min+(x.max-x.min)*v;});return {...m,params};})};
}
export const noteName=(midi:number)=>`${['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((midi%12)+12)%12]}${Math.floor(midi/12)-1}`;
