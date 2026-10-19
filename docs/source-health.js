(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ADSourceHealth=api;})(globalThis,function(){
  'use strict';
  const labels={market:'Market prices',sectors:'Sectors',earnings:'Earnings',insiders:'Insider filings',sentiment:'Market sentiment',crypto:'Crypto',prediction_markets:'Prediction markets',trends:'Social trends',events:'Events',analysis:'Investment analysis'};
  const descriptions={ok:'Available',partial:'Partial coverage',stale:'Out of date',unavailable:'Unavailable',disabled:'Disabled',unknown:'Status not supplied'};
  const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
  function statusFor(data,id,now=Date.now()){
    const envelope=data?.source_health;
    const source=envelope?.schema_version===1&&envelope.sources&&typeof envelope.sources==='object'?envelope.sources[id]:null;
    if(!source||typeof source!=='object')return {id,label:labels[id]||id,status:'unknown',description:descriptions.unknown,provider:null,as_of:null,last_success_at:null,expires_at:null,fallback_used:false};
    let status=Object.hasOwn(descriptions,source.status)?source.status:'unknown';
    const asOf=timestamp(source.as_of),lastSuccess=timestamp(source.last_success_at),expires=timestamp(source.expires_at);
    if((asOf&&Date.parse(asOf)>now+60000)||(lastSuccess&&Date.parse(lastSuccess)>now+60000))status='unknown';
    if(status==='ok'&&!asOf&&!lastSuccess)status='unknown';
    if(['ok','partial'].includes(status)&&expires&&Date.parse(expires)<=now)status='stale';
    return {id,label:labels[id]||id,status,description:descriptions[status],provider:typeof source.provider==='string'?source.provider.slice(0,100):null,as_of:asOf,last_success_at:lastSuccess,expires_at:expires,fallback_used:source.fallback_used===true};
  }
  function render(target,data,now=Date.now()){
    if(!target)return;
    const doc=target.ownerDocument,details=doc.createElement('details'),summary=doc.createElement('summary');
    const wasOpen=target.querySelector('details')?.open||false;
    details.open=wasOpen;details.className='ad-details';summary.textContent='Data source health';details.appendChild(summary);
    const list=doc.createElement('div');list.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;padding:12px 0';
    const rows=Object.keys(labels).map(id=>statusFor(data,id,now));
    const issues=rows.filter(row=>row.status!=='ok').length;
    summary.textContent+=' · '+(issues?issues+' sources need attention':'All sources available');
    for(const row of rows){
      const card=doc.createElement('div');card.dataset.sourceId=row.id;card.dataset.sourceStatus=row.status;card.style.cssText='border:1px solid var(--border);border-radius:6px;padding:10px;font-size:11px;line-height:1.6';
      const title=doc.createElement('strong');title.textContent=row.label+' · '+row.description;title.style.color=row.status==='ok'?'var(--g)':row.status==='unknown'?'var(--t2)':'var(--a)';card.appendChild(title);
      for(const text of [row.provider?'Provider: '+row.provider:'Provider not supplied',row.as_of?'As of: '+formatTime(row.as_of):'Observation time unavailable',row.last_success_at?'Last successful update: '+formatTime(row.last_success_at):'Last successful update unavailable',row.fallback_used?'Alternative source in use':null]){
        if(!text)continue;const line=doc.createElement('div');line.textContent=text;card.appendChild(line);
      }
      list.appendChild(card);
    }
    details.appendChild(list);target.replaceChildren(details);
  }
  function formatTime(value){return new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Jerusalem'})+' IL';}
  return {statusFor,render};
});
