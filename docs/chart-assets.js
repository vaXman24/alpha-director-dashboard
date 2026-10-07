(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ADChartAssets=api;})(globalThis,function(root){
  'use strict';
  const base=root.document?.currentScript?new URL('.',root.document.currentScript.src):null;
  const cache=new Map();
  function valid(record,ticker){
    return !!record&&/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(ticker)&&record.asset_audience==='public-no-cost'&&
      /^charts\/public\/slot-[01]\/[A-Z0-9][A-Z0-9.^=-]{0,19}\.png$/.test(record.asset_path||'')&&
      record.asset_path.split('/').at(-1)===ticker+'.png'&&/^[a-f0-9]{64}$/.test(record.asset_sha256||'');
  }
  async function verifiedBytes(record,ticker,fetchBytes,hash){
    if(!valid(record,ticker))throw Error('Unverified chart metadata');
    const bytes=new Uint8Array(await fetchBytes(record.asset_path,record.asset_sha256));
    const magic=[137,80,78,71,13,10,26,10];
    if(bytes.length>2*1024*1024||!magic.every((b,i)=>bytes[i]===b)||await hash(bytes)!==record.asset_sha256)throw Error('Chart content mismatch');
    return bytes;
  }
  async function render(element,record,ticker,snapshot){
    if(!element)return;
    element.textContent='Loading verified price chart…';
    try{
      if(!valid(record,ticker))throw Error('Unavailable');
      const key=record.asset_sha256;
      let bytes=cache.get(key);
      if(!bytes){
        bytes=await verifiedBytes(record,ticker,async(path,hash)=>{
          const response=await fetch(new URL(path+'?sha256='+hash,base),{cache:'no-store',signal:AbortSignal.timeout(15000)});
          if(!response.ok||Number(response.headers.get('Content-Length'))>2*1024*1024)throw Error('Unavailable');
          return response.arrayBuffer();
        },async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join(''));
        if(cache.size>=12)cache.delete(cache.keys().next().value);cache.set(key,bytes);
      }
      if(!element.isConnected)return;
      const img=document.createElement('img'),caption=document.createElement('small');
      const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
      img.alt='Verified public price chart for '+ticker;
      img.onload=img.onerror=()=>URL.revokeObjectURL(url);img.src=url;
      caption.textContent='Raw brain levels and technical context. Best Play above gives the canonical action and allocation. Chart snapshot '+snapshot;
      element.replaceChildren(img,caption);
    }catch(_){if(element.isConnected)element.textContent='Compatible public chart unavailable. Data may be refreshing; no previous image is reused.';}
  }
  return {valid,verifiedBytes,render};
});
