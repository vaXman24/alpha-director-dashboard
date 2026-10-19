(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ADLocalState=api;})(globalThis,function(){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  function tickers(value){
    return [...new Set((Array.isArray(value)?value:[]).filter(x=>typeof x==='string').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9.\-]{1,20}$/.test(x)))];
  }
  function favoritesState(saved,legacy=[]){
    if(saved&&saved.schema_version===2&&Number.isSafeInteger(saved.local_revision)&&saved.local_revision>=0&&Array.isArray(saved.pending)&&Array.isArray(saved.remote_favorites)&&saved.pending.every(o=>o&&tickers([o.ticker])[0]===o.ticker&&typeof o.present==='boolean'&&Number.isSafeInteger(o.revision)&&o.revision>0&&o.revision<=saved.local_revision))return copy(saved);
    const local=tickers(legacy);
    return {schema_version:2,local_revision:local.length,remote_revision:null,remote_updated:null,remote_favorites:[],initialized:false,pending:local.map((t,i)=>({ticker:t,present:true,revision:i+1}))};
  }
  function favoriteList(state){
    let list=tickers(state.remote_favorites);
    for(const op of state.pending){list=list.filter(t=>t!==op.ticker);if(op.present)list.push(op.ticker);}
    return list;
  }
  function editFavorites(state,next){
    const out=copy(state),before=favoriteList(state),after=tickers(next);
    for(const t of new Set([...before,...after])){
      const present=after.includes(t);if(before.includes(t)===present)continue;
      out.pending=out.pending.filter(o=>o.ticker!==t);
      out.pending.push({ticker:t,present,revision:++out.local_revision});
    }
    return out;
  }
  function mergeFavorites(state,remote,authoritative=false){
    if(!remote||!Array.isArray(remote.favorites))return copy(state);
    const incoming=Date.parse(remote.updated),known=Date.parse(state.remote_updated);
    if(!authoritative&&Number.isFinite(known)&&(!Number.isFinite(incoming)||incoming<known))return copy(state);
    // A CDN mirror can lag within the same second. Only the API may supersede
    // a known revision at that timestamp; server writes have unique revisions.
    if(!authoritative&&state.remote_revision&&incoming===known&&remote.revision!==state.remote_revision)return copy(state);
    const out=copy(state);out.remote_favorites=tickers(remote.favorites);out.remote_revision=typeof remote.revision==='string'?remote.revision:null;
    out.remote_updated=Number.isFinite(incoming)?remote.updated:null;out.initialized=true;return out;
  }
  function acknowledgeFavorites(state,remote,sentRevision){
    const out=copy(state);out.pending=out.pending.filter(o=>o.revision>sentRevision);
    return mergeFavorites(out,remote,true);
  }
  function snapshotId(data){
    if(typeof data?.snapshot_id==='string'&&data.snapshot_id)return 'snapshot:'+data.snapshot_id;
    if(typeof data?.generated_at==='string'&&Number.isFinite(Date.parse(data.generated_at)))return 'generated:'+data.generated_at;
    return null;
  }
  function replayableTrade(trade,id){
    return !!id&&trade?.source_snapshot_id===id&&['ADDED','TRIMMED','EXITED'].includes(trade.action)&&Number.isFinite(trade.shares)&&trade.shares>0&&Number.isFinite(trade.price)&&trade.price>0;
  }
  function replayPosition(position,trades,id){
    if(!Number.isFinite(position.shares)||position.shares<0||!Number.isFinite(position.avg)||position.avg<0)return {...position};
    const ordered=trades.filter(t=>replayableTrade(t,id)).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||(a.ts||0)-(b.ts||0));
    if(!ordered.length)return {...position};
    let shares=position.shares,avg=position.avg,cost=shares*avg;
    for(const t of ordered){
      if(t.action==='ADDED'){const n=shares+t.shares;avg=(cost+t.shares*t.price)/n;shares=n;cost=shares*avg;}
      else if(t.action==='TRIMMED'){shares=Math.max(0,shares-t.shares);cost=shares*avg;}
      else {shares=0;cost=0;}
    }
    const price=Number.isFinite(position.price)?position.price:0,value=shares*price;
    return {...position,shares:Math.round(shares*1e4)/1e4,avg:Math.round(avg*100)/100,cost:Math.round(cost),value:Math.round(value),pnl_pct:cost>0?Math.round((value/cost-1)*1000)/10:0,_userEdited:true};
  }
  return {tickers,favoritesState,favoriteList,editFavorites,mergeFavorites,acknowledgeFavorites,snapshotId,replayableTrade,replayPosition};
});
