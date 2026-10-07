(function(root){
  'use strict';
  const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=x=>x==null?'unavailable':Number(x).toFixed(1)+'%';
  const rowFor=t=>root._dashboardDecision?.rows.find(r=>r.ticker===t);
  const overlays=new Map(),status=new Map();
  let prior=null;
  const researchBase=new URL('.',document.currentScript.src);
  let reviewedState={status:'disabled',items:[]},lastReviewedSuccess=null;
  const reviewedLoader=root.ADReviewedResearch.createLoader(async path=>{
    const res=await fetch(new URL(path+'?v='+Date.now(),researchBase),{cache:'no-store'});if(!res.ok)throw Error('Research unavailable');
    const bytes=await res.text();if(bytes.length>327680)throw Error('Research bundle too large');return JSON.parse(bytes);
  },state=>{
    reviewedState=state;if(['current','historical'].includes(state.status))lastReviewedSuccess=state.generated_at;
    if(root._currentModalTicker)root._openStockModal?.(root._currentModalTicker);
  },async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join(''));
  function authority(d){return d.authority==='validated_dashboard_decision'?'Validated dashboard decision':'Compatibility estimate';}
  function funding(r,d){
    if(!r.selected_rank)return '0% DCA · '+r.exclusion_reasons.join('; ');
    if(d.budget.status==='zero')return '0% funded · remaining budget is zero · indicative weight '+pct(r.allocation_pct);
    if(d.budget.status==='unknown')return pct(r.allocation_pct)+' indicative weight · funding unavailable';
    return pct(r.allocation_pct)+' of remaining budget'+(d.audience==='private'?' · $'+r.allocation_amount.toFixed(2):'');
  }
  function issuesHtml(issues){return issues.length?'<details class="ad-details"><summary>Review needed ('+issues.length+')</summary><ul>'+issues.map(x=>'<li>'+e(x)+'</li>').join('')+'</ul></details>':'';}
  function banner(d){return '<div class="ad-snapshot"><strong>'+authority(d)+'</strong><span>As of '+e(d.as_of||'unavailable')+' · Chart: '+e(d.chart_status)+'</span><small>Snapshot '+e(d.snapshot_id||'unversioned')+' · '+e(d.policy_version)+'</small>'+issuesHtml(d.issues)+'</div>';}
  function alloc(el,d){
    if(!el||!d)return;
    const rows=d.selected_tickers.map(t=>rowFor(t));
    el.innerHTML=banner(d)+(rows.length?'<div class="alloc-scroll"><table class="alloc-table ad-table"><thead><tr><th>Buy rank</th><th>Ticker</th><th>Action</th><th>Canonical allocation</th></tr></thead><tbody>'+rows.map(r=>'<tr data-decision-ticker="'+e(r.ticker)+'"><td>#'+r.selected_rank+'</td><td><button class="ad-ticker" data-ad-open="'+e(r.ticker)+'">'+e(r.ticker)+'</button></td><td>'+e(r.effective_action)+'</td><td>'+e(funding(r,d))+(r.visibility_reasons.length?'<small>Action Center: '+e(r.visibility_reasons.join('; '))+'</small>':'')+'</td></tr>').join('')+'</tbody></table></div>':'<p>No eligible candidates. Prior allocations and new picks cleared.</p>')+
      '<p class="ad-muted">Budget basis: '+e(d.budget.basis)+'. Indicative allocation '+pct(d.budget.allocated_pct)+' + unallocated '+pct(d.budget.unallocated_pct)+' = 100%.'+(d.budget.status==='known'?' Funded $'+d.budget.allocated_amount.toFixed(2)+' + cash $'+d.budget.unallocated_amount.toFixed(2)+' = $'+d.budget.amount.toFixed(2)+'. Cash includes cent rounding.':'')+'</p>';
  }
  function actions(el,d){
    if(!el||!d)return;
    el.innerHTML='<p class="ad-muted">Operational order is separate from buy rank. Funding matches DCA Allocation.</p><div class="action-grid">'+d.action_tickers.map(t=>{
      const r=rowFor(t);return '<article class="acard ad-action" data-decision-ticker="'+e(t)+'"><div class="ad-eyebrow">'+e(r.effective_action)+(r.selected_rank?' · Buy rank #'+r.selected_rank:' · No funding rank')+'</div><button class="ad-ticker" data-ad-open="'+e(t)+'">'+e(t)+'</button><p>'+e(funding(r,d))+'</p><small>Input confidence: '+(r.confidence.value==null?'unavailable':r.confidence.value+'/10')+' · Chart-integrated: '+(r.chart_confidence.value==null?'unavailable':r.chart_confidence.value+'/100')+'</small>'+issuesHtml(r.issues)+'</article>';
    }).join('')+'</div>'+(!d.action_tickers.length?'<p>No operational cards meet the current visibility rules.</p>':'')+
      '<details class="ad-details"><summary>Non-funded and visibility explanations</summary>'+d.rows.filter(r=>!r.action_center_visible||!r.selected_rank).map(r=>'<p><button class="ad-ticker" data-ad-open="'+e(r.ticker)+'">'+e(r.ticker)+'</button> · '+e([...r.exclusion_reasons,...r.visibility_reasons].join('; ')||'Not selected for this surface')+'</p>').join('')+'</details>';
  }
  function citation(s){
    try {root.ADResearch.safeURL(s.url);return '<a href="'+e(s.url)+'" target="_blank" rel="noopener noreferrer">'+e(s.title||s.id||'Source')+'</a> · '+e(s.published_at||'source date unavailable');}
    catch(_){return 'Source URL unavailable · '+e(s.published_at||'source date unavailable');}
  }
  function research(t,d,r,now){
    let doc=overlays.get(t),state=status.get(t)||{};
    if(doc){try{if(d.chart_status!=='compatible')throw Error('Research preview requires current compatible chart/decision versions');root.ADResearch.validate(doc,{ticker:t,now,snapshot_id:d.snapshot_id,chart_snapshot_id:d.chart_snapshot_id});}catch(err){overlays.delete(t);state={...state,error:err.message};status.set(t,state);doc=null;}}
    const reviewed=reviewedState.items.find(x=>x.doc.ticker===t);
    let historical=false,isReviewed=false;
    if(!doc&&reviewed&&root.AD_RESEARCH_CONFIG?.enabled===true&&d.chart_status==='compatible'&&Date.parse(reviewed.doc.expires_at)>now){
      doc=reviewed.doc;isReviewed=true;
      historical=doc.source_snapshot_ids.decision!==d.snapshot_id||doc.source_snapshot_ids.chart!==d.chart_snapshot_id;
    }
    let content='';
    if(doc){
      const disagree=root.ADResearch.conflict(doc,r);
      const labels={agree:'Agree',reservations:'Agree with reservations',disagree:'Disagree',insufficient_evidence:'Insufficient evidence'};
      const refs=ids=>ids.map(id=>citation(doc.sources.find(s=>s.id===id))).join(' · ');
      content='<div class="ad-research-content"><strong>'+(isReviewed?(historical?'Prior-snapshot research · Current decision has not been reviewed':'Reviewed research'):'Synthetic research preview')+(disagree?' · Review needed: evidence disagrees or is uncertain':'')+'</strong><p>Canonical action and allocation remain unchanged. Interpretations are research commentary.</p>'+
        (doc.daily_plan?'<p class="ad-daily-plan"><b>'+(historical?'Historical daily plan':'Daily plan')+'</b><br>'+e(doc.daily_plan.text)+'<small>'+refs(doc.daily_plan.source_ids)+'</small></p>':'')+
        (doc.verdict?'<p><b>'+(historical?'Historical agent verdict: ':'Agent verdict: ')+e(labels[doc.verdict.assessment])+'</b><br>'+e(doc.verdict.summary)+'<small>'+refs(doc.verdict.source_ids)+'</small></p>':'<p>Agent verdict unavailable in this legacy research version.</p>')+
        (doc.news?'<p><b>News sentiment: '+e(doc.news.sentiment.replaceAll('_',' '))+'</b> · Coverage: '+e(doc.news.coverage)+'<br>'+e(doc.news.summary)+'<small>'+refs(doc.news.source_ids)+'</small><small>News window: '+e(doc.news.window_start)+' to '+e(doc.news.window_end)+'</small></p>':'<p>News coverage unavailable in this legacy research version. No inference of no risks.</p>')+
        '<details class="ad-details"><summary>Research evidence and reassessment</summary>'+
        doc.factual_evidence.map(f=>'<p><b>'+e(f.direction)+':</b> '+e(f.text)+' <small>'+f.source_ids.map(id=>citation(doc.sources.find(s=>s.id===id))).join(' · ')+'</small></p>').join('')+
        doc.interpretations.map(i=>'<p>Interpretation ('+e(i.stance)+'): '+e(i.text)+'</p>').join('')+
        doc.scenarios.map(s=>'<p>Reassess if '+e(s.condition)+'. '+e(s.implication)+' Next check: '+e(s.check_at||'unavailable')+'</p>').join('')+
        '<p>Research-reported changes: '+e(doc.prior_run_id?(doc.changes_since_prior.join('; ')||'Unavailable')+' (prior run reference supplied, comparison unverified)':'Prior research comparison unavailable')+'</p></details><p>Unknowns: '+e(doc.unknowns.join('; ')||'None supplied; completeness unverified')+'</p></div>';
    }
    return '<section class="ad-research"><div class="ad-eyebrow">Daily research</div><strong>'+e(root.AD_RESEARCH_CONFIG?.enabled===true?'Reviewed feed: '+reviewedState.status+' · Agent schedule not verified':'Disabled / not connected')+'</strong><p class="ad-muted">Last successful reviewed update: '+e(lastReviewedSuccess||'never')+'<br>Last successful fixture import: '+e(state.last_success||'never')+'<br>Research date: '+e(doc?.research_as_of||state.research_as_of||'unavailable')+' · Expiry: '+e(doc?.expires_at||state.expires_at||'unavailable')+'</p><label class="ad-import">Preview / import synthetic fixture<input type="file" accept="application/json,.json" data-ad-import="'+e(t)+'"></label> <button class="ad-button" data-ad-remove="'+e(t)+'">Remove preview</button>'+(state.error?'<p role="alert">'+e(state.error)+'</p>':'')+content+'<details class="ad-details"><summary>Research workflow</summary><p>Dot reviews the top five canonical funding candidates. Public output requires review. Research drafts and reviewed versions are separate from the brain. This page cannot schedule an agent, read a journal, approve a draft or publish research.</p></details></section>';
  }
  function bestPlay(t,now=Date.now()){
    const d=root._dashboardDecision,r=rowFor(t);
    if(!d||!r)return '<section class="ad-best"><h3>Best Play</h3><p>Decision unavailable for this ticker. No allocation or action is inferred.</p></section>';
    const facts=[]; const gaps=[];
    if(r.price!=null)facts.push('Snapshot price '+r.price);
    if(r.rsi!=null)facts.push('RSI '+r.rsi);
    if(r.above_200!=null)facts.push(r.above_200?'Above MA200':'Below MA200');
    if(r.sma50!=null)facts.push('MA50 '+r.sma50);
    const ev=r.evidence||{};
    const validFacts=Array.isArray(ev.facts)?ev.facts.filter(f=>f&&typeof f.text==='string'&&['supporting','opposing','neutral'].includes(f.direction)):[];
    const events=Array.isArray(ev.events)?ev.events.filter(f=>f&&typeof f.title==='string'):[];
    const dated=events.filter(x=>typeof x.date==='string'&&root.ADDecision.stamp(x.date+'T00:00:00Z'));
    const today=new Date(now).toISOString().slice(0,10);
    const next=dated.filter(x=>x.date>=today).sort((a,b)=>a.date.localeCompare(b.date))[0];
    if(!facts.length&&!validFacts.length)gaps.push('Setup evidence unavailable');
    if(!validFacts.some(x=>x.direction==='opposing'))gaps.push('Opposing evidence unavailable; this is not evidence of no headwinds');
    if(!events.length)gaps.push('Event coverage unavailable');
    if(events.some(x=>!dated.includes(x)))gaps.push('Some event dates unavailable');
    if(r.chart_confidence.value==null)gaps.push('Chart-integrated confidence unavailable');
    if(r.confidence.value==null)gaps.push('Input confidence unavailable');
    let change='Prior compatible comparison unavailable';
    const old=prior?.snapshot_id!==d.snapshot_id&&prior?.authority==='validated_dashboard_decision'&&d.authority==='validated_dashboard_decision'&&prior?.rows.find(x=>x.ticker===t);
    if(old && Date.parse(prior.as_of)<Date.parse(d.as_of)){
      const changes=[];
      if(old.effective_action!==r.effective_action)changes.push(old.effective_action+' → '+r.effective_action);
      if(Math.abs(old.allocation_pct-r.allocation_pct)>1e-9)changes.push('Indicative weight '+pct(old.allocation_pct)+' → '+pct(r.allocation_pct));
      if(old.price!=null&&r.price!=null&&old.price!==r.price)changes.push('Price '+old.price+' → '+r.price);
      if(old.rsi!=null&&r.rsi!=null&&old.rsi!==r.rsi)changes.push('RSI '+old.rsi+' → '+r.rsi);
      if(JSON.stringify(old.evidence)!==JSON.stringify(r.evidence))changes.push('Supplied evidence updated');
      change=changes.join('; ')||'Action, allocation and supplied setup unchanged since '+prior.as_of;
    }
    const conditions=r.entry_zone&&r.entry_zone.every(root.ADDecision.finite)?'Revisit supplied entry zone '+r.entry_zone.join(' to ')+'.':'Entry/revisit condition unavailable.';
    const invalidation=r.stop_loss!=null?'Supplied invalidation level: '+r.stop_loss+'. Trigger timing and rationale unverified.':'Invalidation unavailable.';
    const line=(label,body)=>'<div class="ad-plan-line"><span>'+label+'</span><div>'+body+'</div></div>';
    return '<section class="ad-best" data-best-play="'+e(t)+'"><div class="ad-eyebrow">BEST PLAY · '+e(t)+'</div><h3>'+e(r.effective_action||'Action unavailable')+(r.selected_rank?' <small>Buy rank #'+r.selected_rank+'</small>':'')+'</h3><p class="ad-stance">'+e(funding(r,d))+'</p><p class="ad-muted">'+authority(d)+' · '+e(d.as_of||'as-of unavailable')+'</p>'+
      line('Changed',e(change))+line('Setup',e(facts.join(' · ')||'Unavailable')+'<small>Source: main snapshot '+e(r.source_snapshot_id||'unversioned')+'</small>')+
      line('Evidence',validFacts.length?validFacts.map(f=>'<p>'+e(f.direction)+': '+e(f.text)+'<small>'+citation({url:f.source_url,published_at:f.source_date})+'</small></p>').join(''):'Supporting/opposing sourced analysis unavailable.')+
      line('Catalysts',events.length?events.map(f=>'<p>'+e(f.title)+' · '+e(dated.includes(f)?f.date+(f.date<today?' (past)':f.date===today?' (today, UTC date)':' (upcoming)'):'date unavailable')+'<small>'+citation({url:f.source_url,published_at:f.source_date})+'</small></p>').join(''):'Event data unavailable. No claim of “no events.”')+
      line('Reassess',e(conditions+' '+invalidation))+line('Next dated check',e(next?next.date+' · '+next.title:'Unavailable'))+
      line('Data gaps',e(gaps.join('; ')||'Coverage is limited to supplied snapshot evidence.'))+
      '<details class="ad-details"><summary>Decision provenance and exclusions</summary><p>Raw: '+e(r.raw_action||'unavailable')+' · Chart: '+e(r.chart_action||'unavailable')+' · Effective: '+e(r.effective_action||'unavailable')+'</p><p>Input confidence '+(r.confidence.value==null?'unavailable':r.confidence.value+'/10')+' · Chart-integrated '+(r.chart_confidence.value==null?'unavailable':r.chart_confidence.value+'/100')+'</p><p>Held status: '+e(r.held_status)+' · Budget basis: '+e(d.budget.basis)+'</p><p>Decision '+e(r.source_snapshot_id||'unversioned')+' · Chart '+e(r.chart_snapshot_id||'unversioned')+'</p>'+issuesHtml([...r.issues,...r.exclusion_reasons,...r.visibility_reasons])+'</details>'+research(t,d,r,now)+'</section>';
  }
  document.addEventListener('click',ev=>{
    const open=ev.target.closest('[data-ad-open]');if(open){root._openStockModal?.(open.dataset.adOpen);return;}
    const remove=ev.target.closest('[data-ad-remove]');if(remove){overlays.delete(remove.dataset.adRemove);status.set(remove.dataset.adRemove,{...status.get(remove.dataset.adRemove),error:'Preview removed'});root._openStockModal?.(remove.dataset.adRemove);}
  });
  document.addEventListener('change',async ev=>{
    const input=ev.target.closest('[data-ad-import]');if(!input)return;
    const t=input.dataset.adImport,file=input.files[0];if(!file)return;
    overlays.delete(t);
    try{
      if(file.size>65536)throw Error('Fixture exceeds 64 KiB');
      const doc=JSON.parse(await file.text()),d=root._dashboardDecision;
      if(d.chart_status!=='compatible')throw Error('Research preview requires current compatible chart/decision versions');
      const valid=root.ADResearch.validate(doc,{ticker:t,now:Date.now(),snapshot_id:d.snapshot_id,chart_snapshot_id:d.chart_snapshot_id});
      overlays.set(t,valid);status.set(t,{last_success:new Date().toISOString(),research_as_of:valid.research_as_of,expires_at:valid.expires_at});
    }catch(err){status.set(t,{...status.get(t),error:err.message});}
    if(root._currentModalTicker===t)root._openStockModal?.(t);
  });
  root.ADView={escape:e,alloc,actions,bestPlay,setPrior(d){prior=d;},clearResearch(){overlays.clear();reviewedLoader.cancel();},funding,
    refreshResearch(){return reviewedLoader.refresh(root._dashboardDecision,root.AD_RESEARCH_CONFIG?.enabled===true);},
    expireResearch(now){let changed=false;const kept=reviewedState.items.filter(x=>Date.parse(x.doc.expires_at)>now);if(kept.length!==reviewedState.items.length){reviewedState={...reviewedState,status:'expired',items:kept};changed=true;}for(const [t,doc] of overlays){if(Date.parse(doc.expires_at)<=now){overlays.delete(t);status.set(t,{...status.get(t),error:'Research preview expired'});changed=true;}}return changed;}};
})(globalThis);
