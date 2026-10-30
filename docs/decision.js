(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ADDecision = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const POLICY = 'dashboard-integrity-v2';
  const ACTIONS = ['STRONG BUY','BUY','WATCH','WAIT','TRIM','EXIT'];
  const ORDER = ['STRONG BUY','BUY','WATCH','TRIM','EXIT'];
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const stamp = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x)) && Number.isFinite(Date.parse(x.slice(0,10)+'T00:00:00Z')) && new Date(x.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===x.slice(0,10);
  const copy = x => structuredClone(x);
  const freeze = x => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
  const ticker = x => typeof x === 'string' && /^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(x.toUpperCase()) ? x.toUpperCase() : null;
  const buys = a => a === 'BUY' || a === 'STRONG BUY';
  function effective(raw, chart) {
    if (raw === 'TRIM') return ['TRIM',80];
    if (raw === 'EXIT') return ['EXIT',85];
    const tables = {
      'STRONG BUY': {buy:['STRONG BUY',95],hold:['BUY',75],wait:['BUY',65],skip:['WATCH',45],other:['BUY',70]},
      BUY: {buy:['BUY',90],hold:['BUY',70],wait:['WATCH',55],skip:['WAIT',35],other:['BUY',65]},
      WAIT: {buy:['WAIT',50],hold:['WAIT',60],wait:['WAIT',80],skip:['WAIT',90],other:['WAIT',70]}
    };
    const fallback = {buy:['BUY',60],hold:['WAIT',55],wait:['WAIT',60],skip:['WAIT',70],other:['WAIT',50]};
    return (tables[raw] || fallback)[chart] || (tables[raw] || fallback).other;
  }
  function number(value, name, issues, min=-Infinity, max=Infinity) {
    if (value == null) return null;
    if (!finite(value) || value < min || value > max) { issues.push('Invalid '+name); return null; }
    return value;
  }
  function normalize(data, audience) {
    const issues = [];
    const isPublic = audience !== 'private';
    const records = (value,name) => {if(value==null)return [];if(!Array.isArray(value)){issues.push('Invalid '+name+' list');return [];}return value;};
    const groups = [ ['portfolio',records(data.portfolio?.positions,'portfolio')], ['outside',records(data.outside_opps,'outside')], ['crypto',records(data.crypto?.positions,'crypto')] ];
    const seen = new Set(), rows=[];
    for (const [origin, records] of groups) for (const p of records) {
      if(!p||typeof p!=='object'||Array.isArray(p)){issues.push('Invalid position record');continue;}
      const t = ticker(p.ticker || p.symbol);
      if (!t) { issues.push('Invalid ticker record'); continue; }
      if (seen.has(t)) { issues.push('Duplicate ticker '+t); const old=rows.find(x=>x.ticker===t); old.issues.push('Duplicate ticker'); continue; }
      seen.add(t);
      const errors=[];
      const raw = typeof p.action === 'string' ? p.action.trim().toUpperCase() : null;
      if (!ACTIONS.includes(raw)) errors.push('Raw action unavailable or invalid');
      if(p.above_200!=null&&typeof p.above_200!=='boolean')errors.push('Invalid MA200 flag');
      if(p._discovery!=null&&typeof p._discovery!=='boolean')errors.push('Invalid discovery flag');
      // The producer supplies two bounds; chart_builder already renders min/max.
      // A price below MA50 reverses those bounds without invalidating the signal.
      let entryZone=null,entryZoneReordered=false;
      if(p.entry_zone!=null){
        if(!Array.isArray(p.entry_zone)||p.entry_zone.length!==2||!p.entry_zone.every(x=>finite(x)&&x>=0))errors.push('Invalid entry zone');
        else {entryZone=[Math.min(...p.entry_zone),Math.max(...p.entry_zone)];entryZoneReordered=p.entry_zone[0]>p.entry_zone[1];}
      }
      // The legacy producer and score consumer explicitly use /10. Never infer a scale from magnitude.
      const scale = p.confidence_scale || 'legacy_0_10';
      const knownScale = ['legacy_0_10','0_10'].includes(scale);
      if (p.confidence != null && !knownScale) errors.push('Unresolved confidence scale');
      const confidence = knownScale ? number(p.confidence,'input confidence /10',errors,0,10) : null;
      const backendPct=number(p.allocation_pct,'backend allocation percentage',errors,0,100);
      let held = 'unknown';
      if (!isPublic) {
        const qty = p.shares ?? p.qty;
        const n = number(qty,'private held status input',errors,0);
        if (n != null) held = n > 0 ? 'held' : 'not_held';
      }
      rows.push({ticker:t,origin,source_index:rows.length,raw_action:raw,
        confidence:{value:confidence,scale:'0_10',source:scale},held_status:held,
        backend_allocation_pct:backendPct,backend_allocation_present:p.allocation_usd!=null||backendPct!=null,
        discovery:p._discovery===true,tier:p._tier || null,
        risk: typeof p.risk==='string' ? p.risk : null,
        upside_pct:number(p.upside_pct,'upside',errors), rsi:number(p.rsi,'RSI',errors,0,100),
        above_200:typeof p.above_200==='boolean'?p.above_200:null,
        price:number(p.price,'price',errors,0), stop_loss:number(p.stop_loss,'supplied invalidation level',errors,0),
        entry_zone:entryZone,entry_zone_reordered:entryZoneReordered,
        sma50:number(p.sma50,'MA50',errors,0), sma200:number(p.sma200,'MA200',errors,0),
        decision_data_status:p.decision_data_status||null,quote_session:p.quote_session||null,issues:errors});
    }
    const budgetIssues=[];
    const remaining=number(data.monthly_remaining,'remaining budget',budgetIssues,0);
    const monthly=number(data.monthly_dca,'monthly budget',budgetIssues,0);
    const used=number(data.monthly_used,'used budget',budgetIssues,0);
    for(const v of [remaining,monthly,used])if(v!=null&&(v>Number.MAX_SAFE_INTEGER/100||Math.abs(v*100-Math.round(v*100))>1e-7))budgetIssues.push('Budget must be representable in USD cents');
    let amount=null, basis='unavailable';
    if (!isPublic && !budgetIssues.length) {
      if (remaining!=null) { amount=remaining; basis='monthly_remaining'; }
      else if (monthly!=null && used!=null) { amount=Math.max(0,monthly-used); basis='monthly_dca_minus_used'; }
      else if (monthly!=null) { basis='gross_monthly_only'; budgetIssues.push('Remaining budget unavailable; gross budget is not remaining cash'); }
      if(remaining!=null&&monthly!=null&&used!=null&&Math.abs(remaining-Math.max(0,monthly-used))>0.005)budgetIssues.push('Remaining budget disagrees with monthly minus used; explicit remaining basis retained for review');
    }
    const deployed=number(data.monthly_deployed_pct,'deployed percentage',budgetIssues,0,100);
    // Public percentages already exist in the approved public contract. No dollar conversion or ownership inference.
    if (isPublic && deployed===100) { amount=0; basis='public_cycle_fully_deployed'; }
    const yissues=[]; const yld=number(data.market?.t10y?.price,'10Y yield',yissues,0);
    const vix=number(data.market?.vix?.price ?? data.market?.vix?.level,'VIX',yissues,0);
    return {rows,issues:[...issues,...yissues],yield:yld,vix,audience:isPublic?'public':'private',
      budget:{amount,basis,status:amount===0?'zero':amount==null?'unknown':'known',issues:budgetIssues,remaining_cycle_pct:deployed==null?null:100-deployed}};
  }
  function chartState(data, charts, now, error) {
    if (error) return {status:error,records:{},issues:['Chart analysis '+error]};
    if (!charts) return {status:'missing',records:{},issues:['Chart analysis unavailable']};
    if (charts.schema_version===2) {
      if(typeof charts.snapshot_id!=='string'||!charts.snapshot_id)return {status:'invalid',records:{},issues:['Chart snapshot ID unavailable']};
      if (typeof data.snapshot_id!=='string' || !data.snapshot_id || charts.source_snapshot_id!==data.snapshot_id) return {status:'mismatch',records:{},issues:['Chart/main snapshot mismatch']};
      if (!stamp(charts.generated_at) || !stamp(charts.expires_at) || Date.parse(charts.expires_at)<=Date.parse(charts.generated_at) || Date.parse(charts.generated_at)>now) return {status:'invalid',records:{},issues:['Invalid chart timestamps']};
      if (Date.parse(charts.expires_at)<=now) return {status:'expired',records:{},issues:['Chart analysis expired']};
      return {status:'compatible',records:charts.tickers || {},issues:[],id:charts.snapshot_id,as_of:charts.generated_at,expires_at:charts.expires_at};
    }
    if (charts.schema_version!=null) return {status:'invalid',records:{},issues:['Unsupported chart schema']};
    return {status:'legacy',records:charts,issues:['Legacy chart provenance/freshness unverified']};
  }
  function score(p,yld) {
    const riskW={LOW:1,MEDIUM:.72,HIGH:.45,'VERY HIGH':.25};
    const upside=Math.max(2,Math.min(100,p.upside_pct ?? 0));
    // Preserve legacy score defaults; their use is disclosed separately.
    const conf=p.confidence.value==null?.65:p.confidence.value/10;
    const rsi=p.rsi==null?1:p.rsi>85?.55:p.rsi>75?.8:p.rsi>65?.95:1.1;
    const action=p.effective_action==='STRONG BUY'?1.3:p.effective_action==='BUY'?1:p.effective_action==='WATCH'?.55:0;
    const y=yld??0;
    const yf=y<=0?1:y>5?(p.risk==='LOW'?1.05:p.risk==='MEDIUM'?.90:.78):y>4.5?(p.risk==='LOW'?1.02:p.risk==='MEDIUM'?.95:.87):y>3.5?1:['HIGH','VERY HIGH'].includes(p.risk)?1.1:1;
    return upside**1.5*(riskW[p.risk]||.55)*conf*rsi*(p.above_200?1.2:.75)*action*yf*(p.chart_confidence.value==null?.7:p.chart_confidence.value/100);
  }
  function percentages(scored) {
    const total=scored.reduce((s,p)=>s+p.score,0)||1;
    let pcts=scored.map(p=>p.score/total*100);
    for(let k=0;k<6;k++) {
      let excess=0; pcts=pcts.map(v=>{if(v>35){excess+=v-35;return 35;}return v;});
      if(excess<1e-9) break;
      const under=pcts.map((_,i)=>i).filter(i=>pcts[i]<35-1e-9),sum=under.reduce((s,i)=>s+pcts[i],0);
      if(!under.length||sum<=0)break;
      under.forEach(i=>{pcts[i]+=excess*pcts[i]/sum;});
    }
    pcts.forEach((v,i)=>{if(v>0&&v<5){const big=pcts.indexOf(Math.max(...pcts)),need=5-v;if(big!==i&&pcts[big]-need>=5){pcts[big]-=need;pcts[i]=5;}}});
    return pcts.map(v=>Math.min(35,v));
  }
  function computeDashboardDecision(input, now=Date.now()) {
    if (!finite(now)) throw new Error('Invalid clock');
    const data=input.data || {}, n=normalize(data,input.audience), ch=chartState(data,input.charts,now,input.chart_error);
    if(stamp(data.expires_at)&&Date.parse(data.expires_at)<=now){ch.records={};ch.status='main expired';ch.issues.push('Chart action withheld because the main snapshot expired');}
    const issues=[...n.issues,...n.budget.issues,...ch.issues];
    if(data.schema_version!==2)issues.push('Main schema version unverified');
    if (typeof data.snapshot_id!=='string'||!data.snapshot_id) issues.push('Main snapshot ID unavailable or invalid');
    if (!stamp(data.generated_at)) issues.push('Main as-of unavailable');
    if (!stamp(data.expires_at)) issues.push('Main expiry unavailable');
    else if (Date.parse(data.expires_at)<=now) issues.push('Main snapshot expired');
    else if (!stamp(data.generated_at) || Date.parse(data.generated_at)>now || Date.parse(data.expires_at)<=Date.parse(data.generated_at)) issues.push('Invalid main timestamps');
    if(n.yield==null)issues.push('Missing yield uses neutral factor 1.0');
    const rows=n.rows.map(p=>{
      const local=[...p.issues], defaults=[];
      if(p.entry_zone_reordered)local.push('Entry zone bounds displayed low to high; source endpoint order was reversed');
      if(p.backend_allocation_present)local.push('Backend allocation is a separate legacy result: raw actions, gross monthly basis, no chart factor; public allocation basis: '+(data.allocation_basis||'legacy per-list denominator')+'');
      const a=ch.records[p.ticker]?.analysis;
      let action=p.raw_action, cc=null, rec=null, evidence=null;
      if (a && ['buy','hold','wait','skip'].includes(a.chart_rec)) {
        const expected=effective(p.raw_action,a.chart_rec);
        if (a.effective_action!==expected[0] || a.confidence_pct!==expected[1]) local.push('Effective-action mapping discrepancy; raw action retained');
        else { action=expected[0];cc=expected[1];rec=a.chart_rec;evidence=ch.status==='compatible'?safeEvidence(a.evidence):null; }
      } else local.push('Ticker chart recommendation unavailable');
      if(p.confidence.value==null)defaults.push('input confidence factor 0.65');
      if(cc==null)defaults.push('chart confidence factor 0.70');
      if(p.above_200==null)defaults.push('unknown MA200 uses legacy below factor');
      if(p.rsi==null)defaults.push('missing RSI factor 1.0');
      if(!['LOW','MEDIUM','HIGH','VERY HIGH'].includes(p.risk))defaults.push('missing or unknown risk factor 0.55');
      const exclusion=[];
      if(data.entry_policy_version==='trend-confirmed-v1'&&buys(action)&&p.above_200!==true){
        action='WAIT';cc=null;rec=null;
        exclusion.push('Entry withheld: existing brain policy requires price above SMA200');
      }
      if(p.price==null||p.price<=0||(data.market_integrity_version===1&&p.decision_data_status!=='ok')){
        action='WAIT';cc=null;rec=null;
        exclusion.push('Recommendation withheld: stale/missing market inputs');
      }
      if(!buys(action))exclusion.push('Effective action '+(action||'unavailable')+' receives no DCA');
      if(p.origin==='crypto')exclusion.push('Outside existing equity DCA universe');
      if(p.upside_pct==null)exclusion.push('Upside unavailable');
      else if(p.upside_pct>200)exclusion.push('Upside above 200% quarantine');
      else if(p.origin==='outside'&&p.upside_pct<8)exclusion.push('Outside opportunity requires at least 8% upside');
      else if(p.origin==='portfolio'&&p.upside_pct<=0)exclusion.push('Portfolio candidate requires positive upside');
      if(p.issues.length)exclusion.push('Invalid or ambiguous input requires review');
      const gate=!p.discovery||p.held_status==='held'||p.tier==='confirmed';
      const operational=['TRIM','EXIT'].includes(action);
      const visibility=[];
      if(!gate)visibility.push('Discovery not confirmed; held exception unavailable or false');
      if(operational&&p.held_status!=='held')visibility.push(p.held_status==='unknown'?'Held status unknown for this audience':'Not held');
      if(!ORDER.includes(action))visibility.push('Not in existing Action Center action tiers');
      if(p.discovery&&!gate&&buys(action))local.push('Legacy conflict: DCA admits discovery candidate excluded by Action Center gate');
      if(buys(action)&&p.above_200===false)local.push('Historical policy discrepancy: below-MA200 entry prohibition is not the existing DCA filter; strategy review needed');
      if(buys(action)&&n.vix!=null&&n.vix>=28)local.push('Elevated VIX: macro-risk review required; the current brain prompt does not define an automatic entry veto at this level');
      const row={...p,effective_action:action,chart_action:rec,chart_confidence:{value:cc,scale:'0_100',source:'effective-action-table'},
        source_snapshot_id:data.snapshot_id||null,chart_snapshot_id:ch.id||null,as_of:data.generated_at||null,chart_as_of:ch.as_of||null,budget_basis:n.budget.basis,
        evidence,issues:local,score_defaults:defaults,eligibility:!exclusion.length,exclusion_reasons:exclusion,
        visibility_reasons:visibility,operational,selected_rank:null,allocation_pct:0,funded_pct:n.budget.status==='unknown'?null:0,allocation_amount:n.budget.status==='unknown'?null:0};
      row.score=score(row,n.yield);
      if(!finite(row.score)){row.score=0;row.eligibility=false;row.exclusion_reasons.push('Non-finite allocation score');}
      return row;
    });
    const selected=rows.filter(p=>p.eligibility).sort((a,b)=>b.score-a.score||a.source_index-b.source_index).slice(0,5);
    const pcts=percentages(selected);
    selected.forEach((p,i)=>{
      p.selected_rank=i+1;p.allocation_pct=pcts[i];
      p.funded_pct=n.budget.status==='zero'?0:n.budget.status==='known'?pcts[i]:null;
      // Cent-floor accounting prevents displayed funding exceeding available cash/cap. Remainder remains cash.
      p.allocation_amount=n.budget.amount==null?null:Math.floor((n.budget.amount*pcts[i]/100+1e-9)*100)/100;
    });
    for(const p of rows) {
      if(p.eligibility&&!p.selected_rank)p.exclusion_reasons.push('Outside selected top five');
      if(p.selected_rank&&p.score===0)p.exclusion_reasons.push('Zero score receives zero allocation');
      if(p.selected_rank&&n.budget.status==='zero')p.exclusion_reasons.push('Remaining budget is zero');
      if(p.selected_rank&&n.budget.status==='unknown')p.exclusion_reasons.push('Funding unavailable; allocation is an indicative weight');
      if(p.origin==='outside'&&p.selected_rank==null)p.visibility_reasons.push('Outside opportunity is not in the selected DCA top five');
      if(p.origin==='crypto')p.visibility_reasons.push('Crypto is outside the equity Action Center');
      p.action_center_visible=!p.visibility_reasons.length&&(p.origin==='portfolio'||p.origin==='outside'&&p.selected_rank!=null);
      p.operational_order=ORDER.indexOf(p.effective_action);
      p.operational_score=(p.chart_confidence.value==null?.7:p.chart_confidence.value/100)*.6+(p.confidence.value??5)/10*.15+Math.min(p.upside_pct??0,100)/100*.25;
      if(p.issues.length||p.score_defaults.length)issues.push(...p.issues.map(x=>p.ticker+': '+x),...p.score_defaults.map(x=>p.ticker+': legacy default '+x));
    }
    const authority=issues.length?'compatibility_estimate':'validated_dashboard_decision';
    const totalPct=selected.reduce((s,p)=>s+p.allocation_pct,0);
    const allocated=n.budget.amount==null?null:Math.round(selected.reduce((s,p)=>s+p.allocation_amount,0)*100)/100;
    return freeze({schema_version:1,policy_version:POLICY,snapshot_id:data.snapshot_id||null,as_of:data.generated_at||null,
      audience:n.audience,authority,issues:[...new Set(issues)],chart_status:ch.status,chart_snapshot_id:ch.id||null,
      budget:{...n.budget,allocated_amount:allocated,unallocated_amount:allocated==null?null:Math.round((n.budget.amount-allocated)*100)/100,
        allocated_pct:totalPct,unallocated_pct:100-totalPct},rows,selected_tickers:selected.map(p=>p.ticker),
      action_tickers:rows.filter(p=>p.action_center_visible).sort((a,b)=>a.operational_order-b.operational_order||b.operational_score-a.operational_score||a.source_index-b.source_index).map(p=>p.ticker)});
  }
  function safeEvidence(input){
    if(!input||typeof input!=='object')return null;
    const text=x=>typeof x==='string'&&x.length<=1000&&!/[<>\u0000-\u0008]/.test(x)?x:null;
    return {facts:(Array.isArray(input.facts)?input.facts:[]).slice(0,12).map(f=>({text:text(f?.text),direction:['supporting','opposing','neutral'].includes(f?.direction)?f.direction:'neutral',source_url:text(f?.source_url),source_date:text(f?.source_date)})).filter(f=>f.text),
      events:(Array.isArray(input.events)?input.events:[]).slice(0,12).map(f=>({title:text(f?.title),date:text(f?.date),rationale:text(f?.rationale),source_url:text(f?.source_url),source_date:text(f?.source_date)})).filter(f=>f.title)};
  }
  return {POLICY,computeDashboardDecision,normalize,effective,percentages,finite,stamp,ticker,freeze,copy};
});


