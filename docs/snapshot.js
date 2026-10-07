(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ADSnapshot=api;})(globalThis,function(){
  'use strict';
  function createLoader(fetchJSON,commit){
    let generation=0,lastAsOf=-Infinity;
    async function refresh(){
      const ticket=++generation;
      let data,charts=null,chart_error=null,manifest=null;
      try{manifest=await fetchJSON('decision-manifest.json');}catch(e){if(e.status!==404){if(ticket===generation)commit({data:null,charts:null,chart_error:'manifest unavailable'});return;}}
      if(ticket!==generation)return;
      if(manifest){
        const safe=p=>typeof p==='string'&&/^(?:snapshots\/[a-zA-Z0-9_-]+\/)(?:data|analysis)\.json$/.test(p);
        if(manifest.schema_version!==1||typeof manifest.snapshot_id!=='string'||!manifest.snapshot_id||typeof manifest.chart_snapshot_id!=='string'||!manifest.chart_snapshot_id||!safe(manifest.data_path)||!safe(manifest.analysis_path)){
          if(ticket===generation)commit({data:null,charts:null,chart_error:'invalid manifest'});return;
        }
        const results=await Promise.allSettled([fetchJSON(manifest.data_path),fetchJSON(manifest.analysis_path)]);
        if(ticket!==generation)return;
        if(results[0].status==='fulfilled')data=results[0].value;
        if(results[1].status==='fulfilled')charts=results[1].value;else chart_error='missing';
        if(!data||data.snapshot_id!==manifest.snapshot_id){data=null;charts=null;chart_error='main version mismatch';}
        else if(charts&&(charts.snapshot_id!==manifest.chart_snapshot_id||charts.source_snapshot_id!==data.snapshot_id)){charts=null;chart_error='mismatch';}
      }else{
        const results=await Promise.allSettled([fetchJSON('data.json'),fetchJSON('charts/analysis.json')]);
        if(ticket!==generation)return;
        if(results[0].status==='fulfilled')data=results[0].value;
        if(results[1].status==='fulfilled')charts=results[1].value;else chart_error='missing';
      }
      if(ticket!==generation)return;
      if(!data)commit({data:null,charts:null,chart_error:'main unavailable'});
      else {
        const asOf=Date.parse(data.generated_at);
        if(Number.isFinite(asOf)&&asOf<lastAsOf){commit({data:null,charts:null,chart_error:'out-of-order snapshot'});return;}
        if(Number.isFinite(asOf))lastAsOf=asOf;
        commit({data,charts,chart_error,manifest});
      }
    }
    return {refresh,cancel(){generation++;}};
  }
  return {createLoader};
});
