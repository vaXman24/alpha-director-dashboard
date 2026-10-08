(function(root){
  'use strict';
  const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=x=>x==null?'unavailable':Number(x).toFixed(1)+'%';
  const rowFor=t=>root._dashboardDecision?.rows.find(r=>r.ticker===t);
  const overlays=new Map(),status=new Map();
  let actionFilter='all';
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
  function dateTime(value){
    if(!value||!Number.isFinite(Date.parse(value)))return 'Update time unavailable';
    return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
  }
  function issuesHtml(issues){
    if(!issues.length)return '';
    // Group repeated ticker diagnostics without dropping their original text or affected tickers.
    const groups=new Map();
    issues.forEach(x=>{const m=String(x).match(/^([A-Z0-9.\-]{1,12}): (.+)$/),key=m?m[2]:String(x);if(!groups.has(key))groups.set(key,[]);if(m)groups.get(key).push(m[1]);});
    return '<details class="ad-details ad-review"><summary>Review notes · '+groups.size+' '+(groups.size===1?'topic':'topics')+'</summary><ul>'+Array.from(groups,([note,tickers])=>'<li>'+e(note)+(tickers.length?'<small>Affected: '+e(tickers.join(', '))+'</small>':'')+'</li>').join('')+'</ul></details>';
  }
  const tone=r=>({'STRONG BUY':'buy',BUY:'buy',WATCH:'watch',WAIT:'watch',TRIM:'trim',EXIT:'exit'}[r.effective_action]||'neutral');
  const badge=r=>'<span class="ad-action-badge ad-tone-'+tone(r)+'">'+e(r.effective_action||'Unavailable')+'</span>';
  function budgetNote(d){
    return d.budget.status==='unknown'?'Funding unavailable. Percentages are indicative weights, not confirmed funding.':d.budget.status==='zero'?'Remaining budget is zero. No funding is allocated; indicative weights are shown for reference.':'Percentages apply to the remaining budget.';
  }
  function allocation(r,d){
    const funded=d.budget.status==='known',zero=d.budget.status==='zero',selected=!!r.selected_rank;
    return '<div class="ad-allocation"><strong>'+(!selected||zero?'0%':pct(r.allocation_pct))+'</strong><span>'+(!selected?'DCA allocation':zero?'Funded':funded?'of remaining budget':'Indicative weight')+'</span></div>'+
      (selected&&zero?'<small class="ad-allocation-note">'+pct(r.allocation_pct)+' indicative weight</small>':'')+
      (selected&&funded&&d.audience==='private'?'<small class="ad-allocation-note">$'+r.allocation_amount.toFixed(2)+'</small>':'');
  }
  // Rank colors identify parts of one allocation, not a new conviction or risk score.
  const rankColors=['#6ca8ff','#67d5df','#a99afa','#f0bb78','#e99cce'];
  function allocationStory(rows,d){
    if(!rows.length)return '';
    const remainder=d.budget.unallocated_pct;
    return '<section class="ad-allocation-story" aria-label="Allocation overview"><div class="ad-story-heading"><div><p class="ad-eyebrow">THE ALLOCATION AT A GLANCE</p><h3>'+rows.length+' '+(rows.length===1?'ranked candidate':'ranked candidates')+'</h3><p>Buy rank sets the order. Bar length shows the weight.</p></div><span class="ad-funding-state">'+(d.budget.status==='unknown'?'Indicative only':d.budget.status==='zero'?'No funding available':'Remaining budget')+'</span></div><div class="ad-distribution" aria-hidden="true">'+rows.map((r,i)=>'<span style="flex-basis:'+Math.max(0,Math.min(100,r.allocation_pct))+'%;background:'+rankColors[i]+'"></span>').join('')+(remainder>0?'<span class="ad-cash-segment" style="flex-basis:'+remainder+'%"></span>':'')+'</div><div class="ad-distribution-legend">'+rows.map((r,i)=>'<button data-ad-open="'+e(r.ticker)+'"><i style="background:'+rankColors[i]+'" aria-hidden="true"></i>'+e(r.ticker)+' <b>'+pct(r.allocation_pct)+'</b></button>').join('')+(remainder>0?'<span><i class="ad-cash-segment" aria-hidden="true"></i>Unallocated <b>'+pct(remainder)+'</b></span>':'')+'</div><p class="ad-story-caption ad-budget-note">'+e(budgetNote(d))+'</p></section>';
  }
  function filterGroup(r){return ['TRIM','EXIT'].includes(r.effective_action)?'risk':['BUY','STRONG BUY'].includes(r.effective_action)?'buy':'watch';}
  function filterBar(d){
    const rows=d.action_tickers.map(t=>d.rows.find(r=>r.ticker===t));
    const choices=[['all','All actions'],['buy','Buy'],['watch','Watch / wait'],['risk','Reduce risk']];
    if(actionFilter!=='all'&&!rows.some(r=>filterGroup(r)===actionFilter))actionFilter='all';
    return '<div class="ad-filter-bar" aria-label="Filter operational actions">'+choices.map(([key,label])=>{
      const count=key==='all'?rows.length:rows.filter(r=>filterGroup(r)===key).length;
      return '<button class="ad-filter ad-filter-'+key+'" data-ad-filter="'+key+'" aria-pressed="'+(actionFilter===key)+'" '+(!count&&key!=='all'?'disabled':'')+'>'+label+' <span>'+count+'</span></button>';
    }).join('')+'</div>';
  }
  function banner(d){return '<div class="ad-snapshot"><div class="ad-status-row"><span class="ad-status '+(d.authority==='validated_dashboard_decision'?'ad-status-ok':'')+'">'+authority(d)+'</span><time datetime="'+e(d.as_of||'')+'">Updated '+e(dateTime(d.as_of))+'</time></div>'+
    (d.chart_status!=='compatible'?'<p class="ad-status-warning">Chart analysis: '+e(d.chart_status)+'. See source details before relying on this view.</p>':'')+
    '<details class="ad-details ad-provenance"><summary>Sources &amp; validation'+(d.issues.length?' · Review needed':'')+'</summary><p>As of '+e(d.as_of||'unavailable')+'<br>Chart: '+e(d.chart_status)+'<br>Snapshot '+e(d.snapshot_id||'unversioned')+'<br>Policy '+e(d.policy_version)+'</p>'+issuesHtml(d.issues)+'</details></div>';}
  function alloc(el,d){
    if(!el||!d)return;
    el.closest('.section')?.classList.add('ad-decision-section');
    const rows=d.selected_tickers.map(t=>d.rows.find(r=>r.ticker===t));
    el.innerHTML=allocationStory(rows,d)+banner(d)+(rows.length?'<div class="ad-list-heading"><span>Buy rank / ticker</span><span>Allocation</span></div><ol class="ad-allocation-list" aria-label="DCA allocation in buy rank order">'+rows.map((r,i)=>'<li class="ad-allocation-row" style="--rank-color:'+rankColors[i]+'" data-decision-ticker="'+e(r.ticker)+'"><span class="ad-rank" aria-label="Buy rank '+r.selected_rank+'">#'+r.selected_rank+'</span><div class="ad-allocation-name"><button class="ad-ticker" data-ad-open="'+e(r.ticker)+'">'+e(r.ticker)+'</button>'+badge(r)+'</div><div class="ad-allocation-value">'+allocation(r,d)+'</div><div class="ad-weight-track" aria-hidden="true"><span style="width:'+Math.max(0,Math.min(100,r.allocation_pct))+'%"></span></div>'+(r.visibility_reasons.length?'<p class="ad-visibility-note">Not shown in Action Center: '+e(r.visibility_reasons.join('; '))+'</p>':'')+'</li>').join('')+'</ol>':'<p class="ad-empty">No eligible candidates. Prior allocations and new picks cleared.</p>')+
      '<div class="ad-reconciliation"><span>Indicative allocation <b>'+pct(d.budget.allocated_pct)+'</b></span><span>Unallocated <b>'+pct(d.budget.unallocated_pct)+'</b></span></div><details class="ad-details"><summary>Budget basis &amp; reconciliation</summary><p>Budget basis: '+e(d.budget.basis)+'. Indicative allocation '+pct(d.budget.allocated_pct)+' + unallocated '+pct(d.budget.unallocated_pct)+' = 100%.'+(d.budget.status==='known'&&d.audience==='private'?' Funded $'+d.budget.allocated_amount.toFixed(2)+' + cash $'+d.budget.unallocated_amount.toFixed(2)+' = $'+d.budget.amount.toFixed(2)+'. Cash includes cent rounding.':'')+'</p></details>';
  }
  function actions(el,d){
    if(!el||!d)return;
    el.closest('.section')?.classList.add('ad-decision-section');
    el.innerHTML='<div class="ad-action-intro"><div><p class="ad-eyebrow">ACTION OVERVIEW</p><h3>Signals, in priority order.</h3></div><p class="ad-action-legend"><span class="ad-tone-buy">Buy</span><span class="ad-tone-watch">Watch / wait</span><span class="ad-tone-trim">Trim</span><span class="ad-tone-exit">Exit</span></p></div>'+filterBar(d)+'<div class="ad-action-context"><p>Operational order <span>Cards follow action priority. Buy rank shows DCA funding order. Counts cover visible cards only.</span></p><p>'+e(budgetNote(d))+'</p></div><div class="action-grid ad-action-grid">'+d.action_tickers.filter(t=>actionFilter==='all'||filterGroup(d.rows.find(r=>r.ticker===t))===actionFilter).map(t=>{
      const r=d.rows.find(r=>r.ticker===t);return '<article class="acard ad-action ad-tone-'+tone(r)+'" data-decision-ticker="'+e(t)+'"><div class="ad-card-heading"><button class="ad-ticker" data-ad-open="'+e(t)+'">'+e(t)+'</button>'+badge(r)+'</div><p class="ad-card-rank">'+(r.selected_rank?'Buy rank <b>#'+r.selected_rank+'</b>':'Not ranked for DCA')+'</p>'+allocation(r,d)+(!r.selected_rank?'<p class="ad-exclusion">'+e(r.exclusion_reasons.join('; ')||'No DCA allocation')+'</p>':'')+'<dl class="ad-confidence"><div><dt>Input confidence</dt><dd>'+(r.confidence.value==null?'Unavailable':r.confidence.value+'<small>/10</small>')+'</dd></div><div><dt>Chart-integrated</dt><dd>'+(r.chart_confidence.value==null?'Unavailable':r.chart_confidence.value+'<small>/100</small>')+'</dd></div></dl>'+issuesHtml(r.issues)+'</article>';
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
    const evidencePanels=validFacts.length?'<div class="ad-evidence-grid">'+[['supporting','What supports it','+'],['opposing','What challenges it','!']].map(([direction,label,icon])=>'<section class="ad-evidence ad-evidence-'+direction+'"><h4><span aria-hidden="true">'+icon+'</span>'+label+'</h4>'+(validFacts.filter(f=>f.direction===direction).map(f=>'<p>'+e(f.text)+'<small>'+citation({url:f.source_url,published_at:f.source_date})+'</small></p>').join('')||'<p>Evidence unavailable.</p>')+'</section>').join('')+'</div>'+validFacts.filter(f=>f.direction==='neutral').map(f=>'<p>'+e(f.text)+'<small>'+citation({url:f.source_url,published_at:f.source_date})+'</small></p>').join(''):'Supporting/opposing sourced analysis unavailable.';
    return '<section class="ad-best ad-tone-'+tone(r)+'" data-best-play="'+e(t)+'"><div class="ad-best-hero"><div class="ad-eyebrow">BEST PLAY · '+e(t)+'</div><p class="ad-hero-label">Today’s stance</p><h3>'+e(r.effective_action||'Action unavailable')+(r.selected_rank?' <small>Buy rank #'+r.selected_rank+'</small>':'')+'</h3><p class="ad-stance">'+e(funding(r,d))+'</p><p class="ad-muted">'+authority(d)+' · '+e(dateTime(d.as_of))+'</p></div>'+
      line('Changed',e(change))+line('Setup',e(facts.join(' · ')||'Unavailable')+'<small>Source: main snapshot '+e(r.source_snapshot_id||'unversioned')+'</small>')+
      line('Evidence',evidencePanels)+
      line('Catalysts',events.length?events.map(f=>'<p>'+e(f.title)+' · '+e(dated.includes(f)?f.date+(f.date<today?' (past)':f.date===today?' (today, UTC date)':' (upcoming)'):'date unavailable')+'<small>'+citation({url:f.source_url,published_at:f.source_date})+'</small></p>').join(''):'Event data unavailable. No claim of “no events.”')+
      line('Reassess',e(conditions+' '+invalidation))+line('Next dated check',e(next?next.date+' · '+next.title:'Unavailable'))+
      line('Data gaps',e(gaps.join('; ')||'Coverage is limited to supplied snapshot evidence.'))+
      '<details class="ad-details"><summary>Decision provenance and exclusions</summary><p>Raw: '+e(r.raw_action||'unavailable')+' · Chart: '+e(r.chart_action||'unavailable')+' · Effective: '+e(r.effective_action||'unavailable')+'</p><p>Input confidence '+(r.confidence.value==null?'unavailable':r.confidence.value+'/10')+' · Chart-integrated '+(r.chart_confidence.value==null?'unavailable':r.chart_confidence.value+'/100')+'</p><p>Held status: '+e(r.held_status)+' · Budget basis: '+e(d.budget.basis)+'</p><p>Decision '+e(r.source_snapshot_id||'unversioned')+' · Chart '+e(r.chart_snapshot_id||'unversioned')+'</p>'+issuesHtml([...r.issues,...r.exclusion_reasons,...r.visibility_reasons])+'</details>'+research(t,d,r,now)+'</section>';
  }
  document.addEventListener('click',ev=>{
    const filter=ev.target.closest('[data-ad-filter]');if(filter){
      if(!['all','buy','watch','risk'].includes(filter.dataset.adFilter))return;
      actionFilter=filter.dataset.adFilter;actions(document.querySelector('#action-center'),root._dashboardDecision);
      document.querySelector('[data-ad-filter="'+actionFilter+'"]')?.focus({preventScroll:true});return;
    }
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
  root.ADView={escape:e,alloc,actions,bestPlay,dateTime,setPrior(d){prior=d;},clearResearch(){overlays.clear();reviewedLoader.cancel();},funding,
    refreshResearch(){return reviewedLoader.refresh(root._dashboardDecision,root.AD_RESEARCH_CONFIG?.enabled===true);},
    expireResearch(now){let changed=false;const kept=reviewedState.items.filter(x=>Date.parse(x.doc.expires_at)>now);if(kept.length!==reviewedState.items.length){reviewedState={...reviewedState,status:'expired',items:kept};changed=true;}for(const [t,doc] of overlays){if(Date.parse(doc.expires_at)<=now){overlays.delete(t);status.set(t,{...status.get(t),error:'Research preview expired'});changed=true;}}return changed;}};
})(globalThis);
