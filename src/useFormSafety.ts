import { useEffect, useRef, useState } from 'react';
export function useFormSafety(data: object, onClose:()=>void) {
 const original=useRef(JSON.stringify(data)),lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dirty=original.current!==JSON.stringify(data);
 useEffect(()=>{
    const unload=(e:BeforeUnloadEvent)=>{if(dirty||lock.current){e.preventDefault();e.returnValue='';}};
    const navigate=(e:Event)=>{if(lock.current||(dirty&&!window.confirm('Discard your unsaved changes?')))e.preventDefault();};
    window.addEventListener('beforeunload',unload);window.addEventListener('ledger:navigate',navigate);
    return()=>{window.removeEventListener('beforeunload',unload);window.removeEventListener('ledger:navigate',navigate);};
 },[dirty]);
 return {busy,error,close:()=>{if(!lock.current&&(!dirty||window.confirm('Discard your unsaved changes?')))onClose();},
 start:()=>{if(lock.current)return false;lock.current=true;setBusy(true);setError('');return true;},
 fail:(e:unknown)=>setError(e instanceof Error?e.message:'Unable to save. Your entries remain in the form. Retry after checking your connection.'),
 finish:()=>{lock.current=false;setBusy(false);}};
}
