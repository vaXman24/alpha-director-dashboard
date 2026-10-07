(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./research.js'):root.ADResearch,typeof module==='object'&&module.exports?require('./decision.js'):root.ADDecision);if(typeof module==='object'&&module.exports)module.exports=api;else root.ADReviewedResearch=api;})(globalThis,function(R,D){
  'use strict';
  function exact(x,fields){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(x,k)))throw Error('Invalid reviewed research envelope');}
  async function validate(bundle,decision,now,digest){
    exact(bundle,['schema_version','generated_at','expires_at','source_snapshot_ids','items']);
    exact(bundle.source_snapshot_ids,['decision','chart']);
    if(bundle.schema_version!==1||!D.stamp(bundle.generated_at)||!D.stamp(bundle.expires_at)||Date.parse(bundle.generated_at)>now||Date.parse(bundle.expires_at)<=now||Date.parse(bundle.expires_at)<=Date.parse(bundle.generated_at))throw Error('Reviewed research expired or invalid');
    if(!Array.isArray(bundle.items)||!bundle.items.length||bundle.items.length>5)throw Error('Invalid reviewed research items');
    if(!decision||decision.chart_status!=='compatible')throw Error('Research requires a compatible current decision');
    const historical=bundle.source_snapshot_ids.decision!==decision.snapshot_id||bundle.source_snapshot_ids.chart!==decision.chart_snapshot_id;
    const seen=new Set(),items=[];
    for(const item of bundle.items){
      exact(item,['research_sha256','approved_at','research']);
      if(!D.stamp(item.approved_at)||Date.parse(item.approved_at)>Date.parse(bundle.generated_at)||Date.parse(item.approved_at)<Date.parse(item.research?.generated_at)||! /^[a-f0-9]{64}$/.test(item.research_sha256))throw Error('Invalid research review metadata');
      if(item.research.schema_version!==3||item.research.fixture!==null)throw Error('Reviewed channel requires real research v3');
      if(await digest(R.canonicalJSON(item.research))!==item.research_sha256)throw Error('Research content hash mismatch');
      const doc=R.validate(item.research,{ticker:item.research.ticker,now,snapshot_id:bundle.source_snapshot_ids.decision,chart_snapshot_id:bundle.source_snapshot_ids.chart,allowRealResearch:true});
      if(Date.parse(bundle.expires_at)>Date.parse(doc.expires_at)||Date.parse(bundle.generated_at)<Date.parse(doc.generated_at)||seen.has(doc.ticker))throw Error('Invalid research version set');
      seen.add(doc.ticker);
      // Previous-snapshot research is context only, never a current verdict or action input.
      if(decision.rows.some(r=>r.ticker===doc.ticker))items.push({doc,historical,approved_at:item.approved_at});
    }
    return D.freeze({status:historical?'historical':'current',generated_at:bundle.generated_at,items});
  }
  function createLoader(fetchJSON,commit,digest){
    let sequence=0,latestTime=-Infinity;
    return {async refresh(decision,enabled,now=Date.now()){
      const ticket=++sequence;commit({status:enabled?'loading':'disabled',items:[]});
      if(!enabled)return;
      try{
        const bundle=await fetchJSON('research/reviewed.json');if(ticket!==sequence)return;
        const result=await validate(bundle,decision,now,digest);if(ticket!==sequence)return;
        const time=Date.parse(result.generated_at);if(time<latestTime)throw Error('Out-of-order reviewed research');
        latestTime=time;commit(result);
      }catch(_){if(ticket===sequence)commit({status:'unavailable',items:[]});}
    },cancel(){sequence++;commit({status:'unavailable',items:[]});}};
  }
  return {validate,createLoader};
});
