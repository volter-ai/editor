(async () => {
  await editor.document.run(async ctx => { if (ctx.ceilingSampler) { try { await ctx.ceilingSampler.stop(); } finally { delete ctx.ceilingSampler; } } });
  for (let i=0;i<9;i++) await editor.frameCost({frames:40,quality:'navigation',pixelRatio:1});
  const baseline=await editor.frameCost({frames:40,quality:'navigation',pixelRatio:1});
  const setup=await editor.document.run(ctx => {
    const p=new Profiler({sampleInterval:1,maxBufferSize:20000});
    ctx.ceilingSampler=p; return {interval:p.sampleInterval,timeOrigin:performance.timeOrigin,start:performance.now()};
  });
  const costs=[],windows=[]; let trace;
  try {
    for(let i=0;i<8;i++) {
      const start=await editor.document.run(ctx=>performance.now());
      costs.push(await editor.frameCost({frames:40,quality:'navigation',pixelRatio:1}));
      const end=await editor.document.run(ctx=>performance.now());windows.push({start,end});
    }
  } finally {
    trace=await editor.document.run(async ctx=>{try{return await ctx.ceilingSampler.stop();}finally{delete ctx.ceilingSampler;}});
  }
  for(const c of costs) if(c.devicePixelRatio!==1 || c.drawn.calls!==baseline.drawn.calls || c.drawn.triangles!==baseline.drawn.triangles) throw new Error('Sampling draw parity failed');
  return {baseline,setup,costs,windows,trace};
})()
