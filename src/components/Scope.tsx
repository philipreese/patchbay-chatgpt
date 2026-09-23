import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import type { Patch } from '../types';
import { MODULE_SPECS } from '../modules';
interface Props { engine:AudioEngine; patch:Patch; selectedId:string|null; onSelect:(id:string)=>void; ready:boolean; }
export default function Scope({engine,patch,selectedId,onSelect,ready}:Props){
 const canvas=useRef<HTMLCanvasElement>(null);const [reading,setReading]=useState({peak:0,rms:0});
 const inspectable=(m:Patch['modules'][number])=>MODULE_SPECS[m.type].outputs.some(p=>p.signal==='audio'||p.signal==='cv')||m.type==='output';
 const selected=patch.modules.find(m=>m.id===selectedId&&inspectable(m))||patch.modules.find(m=>m.type==='output');
 const effectiveId=selected?.id;
 const isCV=selected?MODULE_SPECS[selected.type].outputs.some(p=>p.signal==='cv')&&!MODULE_SPECS[selected.type].outputs.some(p=>p.signal==='audio'):false;const signal=selected?.type==='output'?'Master output':selected?`${MODULE_SPECS[selected.type].name} · ${selected.id}`:'Master output';
 useEffect(()=>{
  let frame=0,lastUpdate=0; const wave=new Float32Array(2048),bins=new Uint8Array(1024);
  const draw=(now:number)=>{const el=canvas.current;if(!el)return;const ctx=el.getContext('2d');if(!ctx)return;
   const rect=el.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);if(el.width!==Math.round(rect.width*dpr)||el.height!==Math.round(rect.height*dpr)){el.width=Math.round(rect.width*dpr);el.height=Math.round(rect.height*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);
   const analyser=engine.getAnalyser(effectiveId);if(analyser){analyser.getFloatTimeDomainData(wave);analyser.getByteFrequencyData(bins);}else{wave.fill(0);bins.fill(0);}
   ctx.strokeStyle='#ffffff09';ctx.lineWidth=1;for(let x=0;x<w;x+=w/12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=0;y<h;y+=h/6){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
   let peak=0,sum=0;for(let i=0;i<wave.length;i++){const v=wave[i];peak=Math.max(peak,Math.abs(v));sum+=v*v;}
   const rms=Math.sqrt(sum/wave.length);if(now-lastUpdate>160){setReading({peak,rms});lastUpdate=now;}
   const mid=h*.32,amp=h*.29;ctx.lineWidth=1.8;ctx.strokeStyle=ready?'#d6ef8b':'#718063';ctx.shadowColor='#d6ef8b';ctx.shadowBlur=ready?8:0;ctx.beginPath();
   // Stable rising zero crossing keeps pitched notes readable without inventing signal.
   let start=0;for(let i=1;i<512;i++){if(wave[i-1]<0&&wave[i]>=0){start=i;break;}}
   for(let x=0;x<w;x++){const i=start+Math.floor(x/w*1024),y=mid-wave[i]*amp/Math.max(.03,peak); x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();ctx.shadowBlur=0;
   const count=64,gap=3,bw=(w-gap*(count-1))/count;for(let i=0;i<count;i++){const startBin=Math.floor(Math.pow(i/count,2)*bins.length),endBin=Math.max(startBin+1,Math.floor(Math.pow((i+1)/count,2)*bins.length));let sumBin=0;for(let j=startBin;j<endBin;j++)sumBin=Math.max(sumBin,bins[j]);const bh=sumBin/255*h*.27;ctx.fillStyle=`rgba(241,155,120,${.18+sumBin/255*.6})`;ctx.fillRect(i*(bw+gap),h-12-bh,bw,Math.max(1,bh));}
   frame=requestAnimationFrame(draw);
  }; frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
 },[engine,effectiveId,ready]);
 const selectable=patch.modules.filter(inspectable);
 return <div className="scope-panel"><div className="scope-top"><span className="eyebrow"><span className={`status-light ${ready?'live':''}`}/> SIGNAL OBSERVATORY</span><label className="scope-select"><span className="sr-only">Inspect signal</span><select aria-label="Inspect signal" value={effectiveId||''} onChange={e=>onSelect(e.target.value)}>{selectable.map(m=><option key={m.id} value={m.id}>{MODULE_SPECS[m.type].name} · {m.id}</option>)}</select></label></div><div className="scope-drawing"><canvas ref={canvas} aria-label={`Live waveform and spectrum of ${signal}`}/><span className="scope-wave-label">WAVEFORM <small>AUTO SCALE · TIME →</small></span><span className="scope-spectrum-label">SPECTRUM <small>LOW → HIGH</small></span>{!ready&&<div className="scope-wait">Your next favorite sound<br/><i>is one touch away.</i></div>}</div><div className="scope-footer"><span>{signal}</span><span className="level-value">{isCV?`${reading.rms.toFixed(3)} CV RMS`:reading.rms>.0001?`${(20*Math.log10(reading.rms)).toFixed(1)} dBFS`:'−∞ dBFS'}<i className="level-track"><i style={{width:`${Math.min(100,reading.peak*100)}%`}}/></i></span></div></div>;
}
