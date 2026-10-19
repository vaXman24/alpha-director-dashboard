(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AlphaMarketSession=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Published NYSE equity calendar. Outside this bounded coverage we report unknown.
  const source='https://www.nyse.com/trade/hours-calendars';
  const holidays=new Set([
    '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
    '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
    '2028-01-17','2028-02-21','2028-04-14','2028-05-29','2028-06-19','2028-07-04','2028-09-04','2028-11-23','2028-12-25'
  ]);
  const early=new Set(['2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24']);
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  function parts(date){return Object.fromEntries(fmt.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
  function dateKey(p){return `${p.year}-${p.month}-${p.day}`;}
  function session(key){const year=Number(key.slice(0,4)),day=new Date(key+'T12:00:00Z').getUTCDay();return {known:year>=2026&&year<=2028,open:day!==0&&day!==6&&!holidays.has(key),close:early.has(key)?780:960,early:early.has(key)};}
  function openingUtc(key){
    // Solve ET 09:30 using Intl's zone offset, independent of the browser's own zone.
    let ms=Date.parse(key+'T14:30:00Z');
    for(let i=0;i<2;i++){const p=parts(new Date(ms));const wall=Date.parse(dateKey(p)+`T${p.hour}:${p.minute}:00Z`);ms+=Date.parse(key+'T09:30:00Z')-wall;}
    return ms;
  }
  function status(now=new Date()){
    if(!Number.isFinite(now.getTime()))return {state:'unknown',source};
    const p=parts(now),key=dateKey(p),s=session(key),minute=Number(p.hour)*60+Number(p.minute);
    if(!s.known)return {state:'unknown',source};
    if(s.open&&minute>=570&&minute<s.close)return {state:'open',minutes:s.close-minute,early:s.early,source};
    // Label only the core equity session: extended trading varies by venue and broker.
    for(let offset=0;offset<12;offset++){
      const key2=new Date(Date.parse(key+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10),next=session(key2);
      if(!next.known)return {state:'closed',minutes:null,source};
      if(next.open){const at=openingUtc(key2);if(at>now.getTime())return {state:'closed',minutes:Math.ceil((at-now.getTime())/60000),early:s.early,source};}
    }
    return {state:'unknown',source};
  }
  return {status,session,source};
});
