(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./decision.js'):root.ADDecision);if(typeof module==='object'&&module.exports)module.exports=api;else root.ADResearch=api;})(globalThis,function(D){
  'use strict';
  const fields=['schema_version','fixture','ticker','generated_at','research_as_of','expires_at','source_snapshot_ids','sources','author','run_id','factual_evidence','interpretations','scenarios','unknowns','changes_since_prior','prior_run_id'];
  const privateKeys=/^(shares|qty|quantity|balance|holdings|held_status|avg|cost_basis|portfolio|monthly_dca|allocation|allocation_pct|allocation_usd|action|effective_action|trade|sizing|budget|token|password|secret)$/i;
  const instruction=/\b(?:buy|sell|trim|exit|allocate|deploy|trade|position size|stop.loss|take.profit)\b/i;
  function text(value,label,max=600){
    if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Invalid '+label);
    if(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||/javascript:|data:text|onerror\s*=|onload\s*=|\b(?:api[_ -]?key|password|secret|token)\s*[:=]|\b(?:balances?|holdings|my shares|cost basis|my portfolio|wallet address)\b/i.test(value))throw Error('Unsafe or private '+label);
    return value;
  }
  function keys(obj,allowed,label){if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('Invalid '+label);for(const key of Object.keys(obj))if(!allowed.includes(key)||privateKeys.test(key))throw Error('Unexpected '+label+' field');if(allowed.some(k=>!Object.hasOwn(obj,k)))throw Error('Missing '+label+' field');}
  function list(x,label,max=8){if(!Array.isArray(x)||x.length>max)throw Error('Invalid '+label);return x;}
  function url(value){
    text(value,'source URL',1000);const u=new URL(value);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.hostname==='localhost'||/^(?:127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(u.hostname))throw Error('Unsafe source URL');
    return value;
  }
  function validate(doc,context){
    keys(doc,doc?.schema_version===3?[...fields,'verdict','news','daily_plan']:doc?.schema_version===2?[...fields,'verdict','news']:fields,'research');
    const real=doc.schema_version===3&&doc.fixture===null&&context.allowRealResearch===true;
    if(!real&&(![1,2].includes(doc.schema_version)||doc.fixture!=='synthetic'))throw Error('Only synthetic fixture imports are enabled; real research requires the reviewed workflow');
    if(D.ticker(doc.ticker)!==context.ticker||doc.ticker!==context.ticker)throw Error('Wrong ticker');
    for(const k of ['generated_at','research_as_of','expires_at'])if(!D.stamp(doc[k]))throw Error('Invalid '+k);
    const generated=Date.parse(doc.generated_at),asof=Date.parse(doc.research_as_of),expiry=Date.parse(doc.expires_at);
    if(asof>generated||generated>context.now||expiry<=generated||expiry<=context.now)throw Error('Expired or invalid research dates');
    keys(doc.source_snapshot_ids,['decision','chart'],'source snapshots');
    if(!context.snapshot_id||!context.chart_snapshot_id||doc.source_snapshot_ids.decision!==context.snapshot_id||doc.source_snapshot_ids.chart!==context.chart_snapshot_id)throw Error('Research snapshot mismatch');
    text(doc.author,'author',100);text(doc.run_id,'run ID',100);
    if(doc.prior_run_id!=null)text(doc.prior_run_id,'prior run ID',100);
    const ids=new Set();
    list(doc.sources,'sources',12).forEach(s=>{keys(s,['id','url','published_at','title'],'source');text(s.id,'source ID',60);if(ids.has(s.id))throw Error('Duplicate source ID');ids.add(s.id);url(s.url);text(s.title,'source title',160);if(!D.stamp(s.published_at)||Date.parse(s.published_at)>asof)throw Error('Invalid source date');});
    function evidence(x,label,max=600){text(x,label,max);if(instruction.test(x))throw Error('Research cannot issue action or sizing instructions');}
    list(doc.factual_evidence,'facts').forEach(f=>{keys(f,['text','source_ids','direction'],'fact');evidence(f.text,'fact');if(!['supporting','opposing','neutral'].includes(f.direction))throw Error('Invalid evidence direction');if(!list(f.source_ids,'citations',8).length||f.source_ids.some(id=>!ids.has(id)))throw Error('Fact requires valid citations');});
    list(doc.interpretations,'interpretations').forEach(f=>{keys(f,['text','stance','source_ids'],'interpretation');evidence(f.text,'interpretation');if(!['bullish','bearish','uncertain'].includes(f.stance))throw Error('Invalid interpretation stance');if(!list(f.source_ids,'citations',8).length||f.source_ids.some(id=>!ids.has(id)))throw Error('Interpretation requires valid citations');});
    list(doc.scenarios,'scenarios').forEach(s=>{keys(s,['condition','implication','check_at','source_ids'],'scenario');evidence(s.condition,'scenario condition');evidence(s.implication,'scenario implication');if(s.check_at!=null&&(!D.stamp(s.check_at)||Date.parse(s.check_at)<asof))throw Error('Invalid scenario check date');if(!list(s.source_ids,'citations',8).length||s.source_ids.some(id=>!ids.has(id)))throw Error('Scenario requires citations');});
    list(doc.unknowns,'unknowns').forEach(x=>evidence(x,'unknown'));
    list(doc.changes_since_prior,'changes').forEach(x=>evidence(x,'change'));
    if(doc.changes_since_prior.length&&!doc.prior_run_id)throw Error('Research changes require a prior run reference');
    if([2,3].includes(doc.schema_version)){
      function citations(refs,label,required){
        list(refs,label,8);
        if((required&&!refs.length)||new Set(refs).size!==refs.length||refs.some(id=>!ids.has(id)))throw Error('Invalid '+label);
      }
      const v=doc.verdict,n=doc.news;
      keys(v,['assessment','summary','source_ids'],'verdict');
      if(!['agree','reservations','disagree','insufficient_evidence'].includes(v.assessment))throw Error('Invalid verdict');
      evidence(v.summary,'verdict summary');citations(v.source_ids,'verdict citations',v.assessment!=='insufficient_evidence');
      if(doc.schema_version===3){
        keys(doc.daily_plan,['text','source_ids'],'daily plan');evidence(doc.daily_plan.text,'daily plan',1500);
        const count=wordCount(doc.daily_plan.text);if(count<40||count>70)throw Error('Daily plan must contain 40 to 70 words');
        citations(doc.daily_plan.source_ids,'daily plan citations',v.assessment!=='insufficient_evidence');
      }
      keys(n,['sentiment','coverage','summary','window_start','window_end','source_ids'],'news');
      if(!['positive','mixed','negative','insufficient_evidence'].includes(n.sentiment))throw Error('Invalid news sentiment');
      if(!['reviewed','partial','unavailable'].includes(n.coverage))throw Error('Invalid news coverage');
      evidence(n.summary,'news summary');
      if(!D.stamp(n.window_start)||!D.stamp(n.window_end)||Date.parse(n.window_start)>Date.parse(n.window_end)||Date.parse(n.window_end)>asof)throw Error('Invalid news window');
      citations(n.source_ids,'news citations',n.sentiment!=='insufficient_evidence');
      if((n.coverage==='unavailable'&&(n.sentiment!=='insufficient_evidence'||n.source_ids.length))||(!n.source_ids.length&&n.coverage!=='unavailable'))throw Error('Missing news must remain unavailable');
      const urls=new Set();
      for(const id of n.source_ids){
        const s=doc.sources.find(x=>x.id===id),date=Date.parse(s.published_at),normalized=new URL(s.url).href.replace(/\/$/,'');
        if(date<Date.parse(n.window_start)||date>Date.parse(n.window_end))throw Error('News citation outside research window');
        if(urls.has(normalized))throw Error('Duplicate news source');urls.add(normalized);
      }
      if((v.assessment==='insufficient_evidence'||n.coverage==='unavailable')&&!doc.unknowns.length)throw Error('Missing evidence requires an explicit data gap');
    }
    return D.freeze(D.copy(doc));
  }
  function conflict(doc,row){return (doc.verdict&&doc.verdict.assessment!=='agree')||(doc.news&&['negative','mixed','insufficient_evidence'].includes(doc.news.sentiment)&&['BUY','STRONG BUY'].includes(row.effective_action))||doc.interpretations.some(i=>i.stance==='uncertain'||i.stance==='bullish'&&!['BUY','STRONG BUY'].includes(row.effective_action)||i.stance==='bearish'&&['BUY','STRONG BUY'].includes(row.effective_action));}
  function canonicalJSON(value){
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';
  }
  // Hyphenated words count once. Punctuation-only tokens do not count; Unicode words are supported.
  function wordCount(value){return typeof value==='string'?value.trim().split(/\s+/u).filter(token=>/[\p{L}\p{N}]/u.test(token)).length:0;}
  return {validate,conflict,safeURL:url,canonicalJSON,wordCount};
});
