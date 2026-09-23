import { useRef, useState } from 'react';
import { AudioEngine } from './audio/engine';
import { runAudioVerification, type AudioVerification } from './audio/verify';
import { PRESETS } from './presets';
import { createShareUrl, readSharedPatch } from './storage';

/** Explicitly opt-in test surface. It does not run as part of the instrument. */
export default function Verification(){
 const [results,setResults]=useState<AudioVerification[]>([]);const [running,setRunning]=useState(false);const engine=useRef<AudioEngine|null>(null);
 const run=async()=>{setRunning(true);setResults([]);const audio=new AudioEngine();engine.current=audio;const report=(r:AudioVerification)=>setResults(items=>[...items,r]);try{
  const url=createShareUrl(PRESETS[1]);const parsed=new URL(url);const restored=readSharedPatch(parsed.hash);
  report({check:'Share link preserves the current deployment subpath',passed:parsed.pathname===location.pathname&&restored?.name===PRESETS[1].name,measured:`${parsed.pathname}; restored ${restored?.name}`});
  await runAudioVerification(audio,report);
 }catch(e){report({check:'Verification ran',passed:false,measured:String(e)});}finally{audio.dispose();engine.current=null;setRunning(false);}};
 return <main className="verification"><a href={import.meta.env.BASE_URL}>← Back to Patchbay</a><h1>Instrument check.</h1><p>This opt-in check plays quiet audio for about 6 seconds. It measures the real audio graph and decodes a recording. Numerical results do not replace listening, touch testing, or checking the layout.</p><button className="primary-button" disabled={running} onClick={run}>{running?'Running audio checks…':'Run checks and enable audio'}</button><button className="wide-button" onClick={()=>engine.current?.panic()}>Silence audio</button><pre>{navigator.userAgent}{'\n'}Viewport {innerWidth} × {innerHeight}, device pixel ratio {devicePixelRatio}</pre><div role="status">{results.map((r,i)=><article key={i} className={`verification-result ${r.passed?'passed':'failed'}`}><strong>{r.passed?'PASS':'FAIL'} · {r.check}</strong><p>{r.measured}</p></article>)}{results.length>0&&!running&&<strong>{results.filter(r=>r.passed).length}/{results.length} checks passed.</strong>}</div><p>Afterward, return to the instrument and run the manual checklist in BUILD_REPORT.md. A passing check verifies the measurements listed, not every feature.</p></main>;
}
