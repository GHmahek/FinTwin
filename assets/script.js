/* ============================================================
   FinTwin — dashboard controller
   Two modes share one set of charts:
     explore → the cleaned BudgetWise dataset (platform view or one user's twin)
     mine    → whatever the visitor has typed in or imported (localStorage)
   ============================================================ */
(function(){
  const DATA = window.FINTWIN_DATA;
  const Ledger = window.FinTwinLedger;
  const Advisor = window.FinTwinAdvisor;
  const $ = (id) => document.getElementById(id);

  const PALETTE = ['#F2A33A','#4B7A99','#1C9A88','#E0605C','#8E7CC3','#6AA84F','#C27BA0','#76A5AF'];
  const INCOME_CATS = ['Salary','Freelance','Bonus','Other'];
  const EXPENSE_CATS = ['Food','Rent','Utilities','Travel','Entertainment','Shopping','Health','Education','Investment','Savings','Other'];

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function styleVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function fmtCompact(n){
    const sign = n < 0 ? '-' : '';
    n = Math.abs(n);
    if(n >= 1e7) return sign + '₹' + (n/1e7).toFixed(2) + ' Cr';
    if(n >= 1e5) return sign + '₹' + (n/1e5).toFixed(2) + ' L';
    if(n >= 1e3) return sign + '₹' + (n/1e3).toFixed(1) + 'K';
    return sign + '₹' + n.toFixed(0);
  }
  function fmtFull(n){
    const sign = n < 0 ? '-' : '';
    return sign + '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
  }

  /* ---------------- state ---------------- */
  const state = { mode:'explore', uid:'' };
  let trendChart, catChart, payChart, cityChart;

  /* ---------------- explore controls ---------------- */
  const userIds = Object.keys(DATA.users).sort();
  const sel = $('userSelect');
  (function fillSelect(){
    const all = document.createElement('option');
    all.value = ''; all.textContent = 'Platform overview (all users)';
    sel.appendChild(all);
    userIds.forEach(uid => {
      const o = document.createElement('option');
      o.value = uid; o.textContent = uid + ' · ' + DATA.users[uid].txn_count + ' txns';
      sel.appendChild(o);
    });
  })();

  /* ---------------- charts ---------------- */
  function nextMonthLabels(months, n){
    let [y,m] = months[months.length-1].split('-').map(Number);
    const out = [];
    for(let i=0;i<n;i++){ m++; if(m>12){ m=1; y++; } out.push(y + '-' + String(m).padStart(2,'0')); }
    return out;
  }
  function monthTickLabel(ym){
    const [y,m] = ym.split('-').map(Number);
    const names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return names[m-1] + " '" + String(y).slice(2);
  }

  function buildTrend(d){
    const months = d.months;
    const fMonths = nextMonthLabels(months, d.income_forecast.length);
    const labels = months.concat(fMonths).map(monthTickLabel);
    const pad = new Array(fMonths.length).fill(null);
    const incActual = d.income_series.concat(pad);
    const expActual = d.expense_series.concat(pad);
    const lastI = d.income_series[d.income_series.length-1];
    const lastE = d.expense_series[d.expense_series.length-1];
    const incForecast = new Array(months.length-1).fill(null).concat([lastI]).concat(d.income_forecast);
    const expForecast = new Array(months.length-1).fill(null).concat([lastE]).concat(d.expense_forecast);

    const inc = styleVar('--inc'), exp = styleVar('--exp'), muted = styleVar('--mute');
    const few = months.length < 8;
    const line = (label, data, color, dashed) => ({
      label, data, borderColor:color, backgroundColor:color, tension:0.35,
      pointRadius: few && !dashed ? 4 : 0, pointHoverRadius:5, borderWidth: dashed ? 2 : 3,
      borderDash: dashed ? [6,5] : [], spanGaps: dashed
    });
    if(trendChart) trendChart.destroy();
    trendChart = new Chart($('trendChart'), {
      type:'line',
      data:{ labels, datasets:[
        line('Income', incActual, inc, false), line('Income (forecast)', incForecast, inc, true),
        line('Expense', expActual, exp, false), line('Expense (forecast)', expForecast, exp, true)
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        plugins:{ legend:{ display:false }, tooltip:{
          filter:(item) => item.raw !== null,
          callbacks:{ label:(ctx)=> ctx.dataset.label.replace(' (forecast)',' (forecast)') + ': ' + fmtFull(ctx.raw) }
        }},
        scales:{
          x:{ grid:{ display:false }, ticks:{ color:muted, maxRotation:0, autoSkip:true, maxTicksLimit:12 } },
          y:{ grid:{ color:styleVar('--border') }, ticks:{ color:muted, callback:(v)=>fmtCompact(v) } }
        }
      }
    });
  }

  function ranked(el, obj, limit){
    const entries = Object.entries(obj).filter(e => e[1] > 0).sort((a,b)=>b[1]-a[1]).slice(0, limit || 99);
    const max = entries.length ? entries[0][1] : 1;
    const total = entries.reduce((t,e)=>t+e[1],0) || 1;
    el.innerHTML = entries.length ? entries.map(([k,v]) => `
      <li><span>${esc(k)}</span><span class="bar"><i style="width:${Math.max(2, v/max*100)}%"></i></span>
      <span class="amt num">${Math.round(v/total*100)}% · ${fmtCompact(v)}</span></li>`).join('')
      : '<li style="display:block;color:var(--mute)">Nothing to show yet.</li>';
  }

  function buildCity(d){
    const entries = Object.entries(d.location_breakdown).sort((a,b)=>b[1]-a[1]);
    if(cityChart) cityChart.destroy();
    cityChart = new Chart($('cityChart'), {
      type:'bar',
      data:{ labels:entries.map(e=>e[0]), datasets:[{
        data:entries.map(e=>e[1]),
        backgroundColor:styleVar('--bar'),
        borderRadius:8, maxBarThickness:36
      }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(ctx)=>fmtFull(ctx.raw) } } },
        scales:{
          x:{ grid:{ display:false }, ticks:{ color:styleVar('--text-mute') } },
          y:{ grid:{ color:styleVar('--border') }, ticks:{ color:styleVar('--text-mute'), callback:(v)=>fmtCompact(v) } }
        }
      }
    });
  }

  /* ---------------- anomaly graph ----------------
     Every transaction is one dot. Normal ones are grey; flagged ones are coloured and
     use different shapes so the meaning does not depend on colour alone.
     Extreme and negative amounts are pinned to the top / bottom edge (their real value
     is in the tooltip) so a single ₹99,99,99,999 typo cannot flatten everything else. */
  let anomChart;
  const KINDS = [
    { name:'Normal',                      color:'rgba(100,120,138,0.35)', style:'circle',  r:3 },
    { name:'Unusually high for category', color:'#F2A33A',                style:'circle',  r:7 },
    { name:'Extreme amount (top edge)',    color:'#E0605C',                style:'triangle',r:9 },
    { name:'Negative amount (bottom edge)',color:'#4B7A99',                style:'rectRot', r:8 },
  ];
  function dateTick(ms){
    const dt = new Date(ms);
    const names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return names[dt.getMonth()] + " '" + String(dt.getFullYear()).slice(2);
  }

  function buildAnomalyChart(d){
    const pts = (d.points || []).map(p => ({ t: Date.parse(p[0] + 'T00:00:00'), date:p[0], amt:p[1], cat:p[2], kind:p[3] }));
    const counts = [0,0,0,0];
    pts.forEach(p => counts[p.kind]++);
    const flagged = counts[1] + counts[2] + counts[3];

    // summary line above the graph
    let summary;
    if(!pts.length) summary = 'No transactions to plot yet.';
    else if(!flagged) summary = 'Nothing flagged: all ' + pts.length.toLocaleString('en-IN') + ' transactions look normal.';
    else {
      const parts = [];
      if(counts[1]) parts.push(counts[1] + ' unusually high');
      if(counts[2]) parts.push(counts[2] + ' extreme');
      if(counts[3]) parts.push(counts[3] + ' negative');
      summary = d.points_sampled
        ? '<b>' + flagged + '</b> flagged transactions (' + parts.join(', ') + '), drawn with a random sample of ' + counts[0].toLocaleString('en-IN') + ' of the ' + d.normal_total.toLocaleString('en-IN') + ' normal ones.'
        : '<b>' + flagged + '</b> of ' + pts.length.toLocaleString('en-IN') + ' transactions flagged (' + parts.join(', ') + ').';
    }
    $('anomSummary').innerHTML = summary;

    // y range comes from the regular spending; extremes/negatives are pinned to the edges
    const regular = pts.filter(p => p.kind <= 1).map(p => p.amt);
    const cap = Math.max((regular.length ? Math.max.apply(null, regular) : 0) * 1.12, 1000);
    const floor = -cap * 0.05;
    const yOf = p => p.kind === 2 ? Math.min(p.amt, cap) : p.kind === 3 ? floor : p.amt;

    const times = pts.map(p => p.t);
    let xMin = times.length ? Math.min.apply(null, times) : Date.now();
    let xMax = times.length ? Math.max.apply(null, times) : Date.now();
    const pad = Math.max((xMax - xMin) * 0.03, 12 * 86400000);
    xMin -= pad; xMax += pad;

    const datasets = KINDS.map((k, i) => ({
      label: k.name,
      data: pts.filter(p => p.kind === i).map(p => ({ x:p.t, y:yOf(p), amt:p.amt, cat:p.cat, date:p.date, kind:p.kind })),
      backgroundColor: k.color, borderColor: i === 0 ? 'transparent' : '#FFFFFF', borderWidth: i === 0 ? 0 : 1.5,
      pointStyle: k.style, pointRadius: k.r, pointHoverRadius: k.r + 3,
      order: i === 0 ? 5 : i
    }));

    const muted = styleVar('--mute');
    if(anomChart) anomChart.destroy();
    anomChart = new Chart($('anomChart'), {
      type:'scatter',
      data:{ datasets },
      options:{
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'nearest', intersect:true },
        plugins:{
          legend:{ position:'top', align:'start', labels:{
            color:styleVar('--ink'), usePointStyle:true, boxWidth:9, boxHeight:9, padding:14, font:{size:12},
            filter:(item, data) => data.datasets[item.datasetIndex].data.length > 0
          }},
          tooltip:{ callbacks:{
            title:(items) => items.length ? items[0].raw.cat + ' · ' + items[0].raw.date : '',
            label:(ctx) => {
              const r = ctx.raw;
              const note = r.kind === 1 ? 'unusually high for ' + r.cat.toLowerCase()
                         : r.kind === 2 ? 'extreme amount'
                         : r.kind === 3 ? 'negative amount, likely a typing error' : 'normal';
              return fmtFull(r.amt) + ' (' + note + ')';
            }
          }}
        },
        scales:{
          x:{ type:'linear', min:xMin, max:xMax, grid:{ display:false },
              ticks:{ color:muted, maxRotation:0, maxTicksLimit:8, callback:(v) => dateTick(v) } },
          y:{ min:floor * 1.6, max:cap * 1.04, grid:{ color:styleVar('--border') },
              ticks:{ color:muted, callback:(v) => v < 0 ? '' : fmtCompact(v) } }
        }
      }
    });
  }

  /* ---------------- score as weather ---------------- */
  function scoreColor(v){
    if(v >= 60) return styleVar('--inc');
    if(v >= 40) return styleVar('--sun');
    return styleVar('--exp');
  }
  function weatherFor(v){
    if(v >= 75) return 'Clear skies';
    if(v >= 60) return 'Mostly sunny';
    if(v >= 45) return 'Partly cloudy';
    if(v >= 30) return 'Overcast';
    return 'Stormy';
  }
  const SKY = [ // [min score, top, bottom]
    [75,'#BFE0F5','#F7F2E2'], [60,'#C7E1F1','#F3F0E4'], [45,'#C9D6E0','#EEEDE6'],
    [30,'#AEBBC7','#E3E5E5'], [0,'#8C99A8','#D3D6D9']
  ];

  function buildScene(h){
    const v = Math.max(0, Math.min(100, Math.round(h.overall)));
    // the sun climbs as the score rises
    const y = 235 - v * 1.9, x = 120 + v * 1.3;
    $('sun').style.transform = 'translate(' + x + 'px,' + y + 'px)';
    $('sun').style.opacity = String(0.35 + v / 100 * 0.65);
    const clouds = document.querySelectorAll('#clouds .cloud');
    const cover = 1 - v / 100;                       // 0 = none, 1 = heavy
    clouds.forEach((c, i) => {
      c.style.opacity = String(Math.min(1, Math.max(0.12, cover * 1.5 - i * 0.18 + 0.1)));
      c.style.transform = 'translateX(' + Math.round((i - 1) * (1 - cover) * 22) + 'px)';
    });
    const sky = SKY.find(s => v >= s[0]);
    $('skyTop').setAttribute('stop-color', sky[1]);
    $('skyBottom').setAttribute('stop-color', sky[2]);
    $('gaugeNum').textContent = v;
    $('verdict').textContent = weatherFor(v);
    $('verdict').style.color = v >= 60 ? styleVar('--inc') : v >= 40 ? styleVar('--sun-deep') : styleVar('--exp');
    $('sceneTitle').textContent = 'Financial health score ' + v + ' out of 100: ' + weatherFor(v);

    const subs = [
      ['Savings', h.savings, 'How much of income is kept'],
      ['Spending stability', h.stability, 'How even spending is month to month'],
      ['Anomaly-free', h.anomaly_free, 'Share of transactions that look normal'],
      ['Category spread', h.diversification, 'Not leaning on one category'],
    ];
    $('subscores').innerHTML = subs.map(([label,val,why]) => `
      <div class="sub-row">
        <div class="top"><span>${label}</span><span class="num">${val.toFixed(0)}</span></div>
        <div class="track"><div class="fill" style="width:${Math.max(2,val)}%;background:${scoreColor(val)}"></div></div>
        <div class="why">${why}</div>
      </div>`).join('');
  }

  function buildKpis(h){
    const hasIncome = h.total_income > 0;
    const cards = [
      { l:'Earned', v:fmtCompact(h.total_income), c:'inc' },
      { l:'Spent', v:fmtCompact(h.total_expense), c:'exp' },
      { l:'Kept', v:fmtCompact(h.net_savings), c:'',
        d: h.net_savings >= 0 ? ['good','money left after spending'] : ['bad','spending more than earning'] },
      { l:'Savings rate', v: hasIncome ? h.savings_rate_pct.toFixed(1) + '%' : 'n/a', c:'',
        d: hasIncome ? ['', 'of every ₹100 earned, ₹' + Math.round(h.savings_rate_pct) + ' is kept'] : ['bad','add some income to see this'] },
    ];
    $('kpiGrid').innerHTML = cards.map(c => `
      <div class="stat ${c.c}"><div class="l">${c.l}</div><div class="v num">${c.v}</div>${c.d ? `<div class="d ${c.d[0]}">${c.d[1]}</div>` : ''}</div>`).join('');
  }

  function buildAnomalies(list, showUser){
    const box = $('anomalyList');
    if(!list.length){
      box.innerHTML = '<div class="anomaly-empty">Nothing flagged. Spending looks consistent.</div>';
      return;
    }
    box.innerHTML = list.map(a => `
      <div class="anomaly-row">
        <div class="date">${esc(a.date)}</div>
        <div>
          <div class="reason">${esc(a.reason)}</div>
          <div class="meta">${esc(a.category)}${showUser ? ' · ' + esc(a.user) : ''}${a.location && a.location!=='Unknown' ? ' · ' + esc(a.location) : ''}</div>
        </div>
        <div class="amt num">${fmtFull(a.amount)}</div>
      </div>`).join('');
  }

  function buildQuality(){
    const q = DATA.quality;
    const tiles = [
      [q.raw_rows.toLocaleString('en-IN'), 'Raw transactions ingested'],
      [q.duplicates_removed.toLocaleString('en-IN'), 'Duplicate rows removed'],
      [q.usable_rows.toLocaleString('en-IN'), 'Usable after cleaning'],
      [q.category_variants_fixed + ' → ' + q.category_canonical, 'Category spellings unified'],
      [q.payment_variants_fixed + ' → ' + q.payment_canonical, 'Payment mode variants unified'],
      [q.location_variants_fixed + ' → ' + q.location_canonical, 'City name variants unified'],
      [q.currency_symbols_normalized.toLocaleString('en-IN'), 'Mixed-currency values normalised (₹ / $ / Rs. / INR)'],
      [q.negative_amounts_flagged + q.extreme_outliers_flagged, 'Data-entry errors & extreme outliers caught'],
    ];
    $('qualityGrid').innerHTML = tiles.map(([n,l]) => `<div><dt class="num">${n}</dt><dd>${l}</dd></div>`).join('');
  }

  /* ---------------- machine learning section (from pipeline, sample data only) ---------------- */
  const MODEL_NAMES = {
    last_month:'Repeat last month', avg_6_months:'Average of last 6 months', linear_trend:'Linear trend',
    ridge_seasonal:'Ridge regression + month of year', random_forest:'Random forest on past 3 months'
  };
  function buildMl(){
    const ml = DATA.ml;
    if(!ml) return;
    const a = ml.anomaly;
    $('mlIsoText').textContent = 'Instead of fixed rules, an Isolation Forest of ' + a.trees + ' trees learns what a normal transaction looks like and isolates the odd ones. It flagged '
      + a.flagged_by_model + ' of ' + a.rows_scored.toLocaleString('en-IN') + ' transactions. It agreed with the rules on ' + a.flagged_by_both + ' of the '
      + a.flagged_by_rules + ' they flagged (' + a.rules_caught_by_model_pct + '%), and found ' + a.model_only + ' the rules missed. The top ones are below, with the model\'s oddness score on the right (higher is odder).';
    $('mlIsoList').innerHTML = a.model_only_examples.map(e => `
      <div class="anomaly-row"><div class="date">${esc(e.date)}</div>
      <div><div class="reason">${esc(e.category)} ${e.type === 'Income' ? 'income' : 'spend'} of ${fmtFull(e.amount)}</div>
      <div class="meta">${esc(e.user)} · ${esc(e.payment)} · missed by the rules</div></div>
      <div class="amt num">${e.score.toFixed(2)}</div></div>`).join('');
    const bt = ml.forecast_backtest;
    $('mlBtText').textContent = 'Each model was asked to predict one month ahead, over and over, for the last ' + bt.months_tested + ' months of the data. Error is the average miss as a percentage of typical monthly value, so lower is better.';
    $('mlBtBody').innerHTML = bt.rows.map(r => `
      <tr class="${r.name === bt.best ? 'best' : ''}"><td>${esc(MODEL_NAMES[r.name] || r.name)}<span class="tagline">${esc(r.kind)}</span></td>
      <td class="r num">${r.income_mape_pct}%</td><td class="r num">${r.expense_mape_pct}%</td><td class="r num">${r.avg_mape_pct}%</td></tr>`).join('');
    $('mlBtNote').textContent = 'Honest result: on this dataset the monthly totals are mostly noise, so the simple 6-month average beats every learned model. The dashboard keeps the linear trend because it is easy to explain and runs in the browser.';
  }

  /* if the Chart.js file is missing, say so instead of leaving empty boxes */
  function showChartsMissing(){
    document.querySelectorAll('.chart-box').forEach(box => {
      if(box.querySelector('.chart-missing')) return;
      const m = document.createElement('div');
      m.className = 'chart-missing';
      m.textContent = 'Charts could not load. Make sure the folder assets/vendor/ (with chart.umd.js) sits next to index.html, then refresh.';
      box.appendChild(m);
    });
  }

  /* ---------------- render ---------------- */
  let lastMineScore = null;

  function currentDataset(){
    if(state.mode === 'mine') return Ledger.computeDataset(Ledger.load());
    return state.uid ? DATA.users[state.uid] : DATA.overall;
  }
  function show(el, on){ el.classList.toggle('hidden', !on); }

  function narrativeFor(d, subject){
    const h = d.health;
    const parts = [];
    if(h.total_income > 0) parts.push('Of every ₹100 earned, ₹' + Math.round(Math.max(0, h.savings_rate_pct)) + ' is kept.');
    const cats = Object.entries(d.category_breakdown).sort((a,b)=>b[1]-a[1]);
    if(cats.length && h.total_expense > 0) parts.push(cats[0][0] + ' takes the biggest share of spending (' + Math.round(cats[0][1] / h.total_expense * 100) + '%).');
    if(d.income_forecast && d.income_forecast.length) parts.push('Next month looks like ' + fmtCompact(d.income_forecast[0]) + ' in and ' + fmtCompact(d.expense_forecast[0]) + ' out.');
    return parts.join(' ');
  }

  function render(){
    const mine = state.mode === 'mine';
    const d = currentDataset();

    $('tabExplore').classList.toggle('active', !mine);
    $('tabMine').classList.toggle('active', mine);
    show($('exploreControls'), !mine);
    show($('qualitySection'), !mine);
    show($('mlSection'), !mine && !state.uid);

    window.FinTwinActive = { mode: state.mode, uid: state.uid, dataset: d };
    $('footerMeta').textContent = mine
      ? 'Your entries are stored only in this browser.'
      : DATA.quality.usable_rows.toLocaleString('en-IN') + ' clean transactions from ' + DATA.overall.user_count + ' users (sample data).';

    const empty = mine && !d;
    show($('mineEmpty'), empty);
    show($('dash'), !empty);
    $('overviewBtn').style.display = (!mine && state.uid) ? '' : 'none';
    sel.value = state.uid;

    const subject = mine ? 'you' : (state.uid ? state.uid : 'the whole platform');
    if(empty){
      $('heroKicker').textContent = 'My money';
      $('heroTitle').textContent = 'No forecast yet';
      $('heroNarrative').textContent = 'Add a few entries or import a bank statement and your sky will fill in.';
      $('sourceNote').textContent = '';
      buildScene({ overall:50, savings:0, stability:0, anomaly_free:0, diversification:0 });
      $('verdict').textContent = '';
      return;
    }

    const v = Math.round(d.health.overall);
    $('heroKicker').textContent = mine ? 'Your report · ' + d.txn_count + ' entries'
      : state.uid ? 'Report for ' + state.uid + ' · ' + d.txn_count + ' transactions'
      : 'Platform report · ' + DATA.overall.user_count + ' users · 2021 to 2024';
    $('heroTitle').textContent = weatherFor(v) + ' for ' + subject;
    $('heroNarrative').textContent = narrativeFor(d, subject);
    $('sourceNote').textContent = mine
      ? 'Built only from what you added. It never leaves this browser.'
      : 'Sample data from the BudgetWise dataset. Switch to My money to see your own.';

    const label = mine ? 'Your' : (state.uid ? state.uid + "'s" : 'Platform');
    $('trendHeading').textContent = label + ' income and spending, with the next three months';

    const cities = Object.keys(d.location_breakdown).filter(k => k !== 'Unknown');
    show($('citySection'), cities.length > 0);
    $('cityNote').textContent = mine ? 'Where your entries were recorded.' : (state.uid ? "Cities this user's transactions were recorded in." : 'Total transaction value by city.');
    $('anomNote').textContent = mine ? 'Entries that look unusual for their category, or like typing slips.'
      : (state.uid ? 'Flagged as unusual or as likely data errors.' : 'The highest-value flagged transactions across the platform.');
    $('anomGraphNote').textContent = mine
      ? 'Every entry you added, with unusual ones highlighted so you can catch a mistake or a one-off splurge.'
      : (state.uid ? 'Every transaction over time, with unusual ones highlighted.'
                   : 'All flagged transactions over time, with a sample of normal ones for comparison.');

    const safe = (fn, arg) => { try{ fn(arg); }catch(err){ console.error('FinTwin: ' + fn.name + ' failed', err); } };
    safe(buildKpis, d.health);
    safe(buildScene, d.health);
    safe(() => ranked($('catList'), d.category_breakdown, 8));
    safe(() => ranked($('payList'), d.payment_breakdown, 6));
    if(typeof Chart === 'undefined'){
      showChartsMissing();
    } else {
      safe(buildTrend, d);
      safe(buildAnomalyChart, d);
      if(cities.length) safe(buildCity, d);
    }
    safe(() => buildAnomalies(d.anomalies, !mine && !state.uid));

    // one suggestion from the rules advisor, with a way into the chat
    const tip = Advisor.generateReply('how can I save more', d);
    $('twinTip').innerHTML = '<span>' + esc(tip) + '</span><button class="btn btn-ghost btn-sm" type="button" data-open-chat data-ask="Why is my score what it is?">Ask why</button>';
    $('twinTip').querySelector('[data-open-chat]').addEventListener('click', () => {
      $('chatFab').click();
      if(!$('chatPanel').classList.contains('open')) $('chatFab').click();
      setTimeout(() => $('chatInput').focus(), 80);
    });

    if(mine){
      if(lastMineScore !== null && lastMineScore < 70 && d.health.overall >= 70) confetti();
      lastMineScore = d.health.overall;
    }
  }

  /* ---------------- confetti (fires when your score crosses 70) ---------------- */
  function confetti(){
    const colors = PALETTE;
    for(let i=0;i<46;i++){
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = (Math.random()*100) + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random()*0.35) + 's';
      p.style.transform = 'rotate(' + Math.floor(Math.random()*360) + 'deg)';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 2400);
    }
  }

  /* ---------------- mode + explore wiring ---------------- */
  function setMode(m){ state.mode = m; render(); window.scrollTo({ top:0, behavior:'smooth' }); }
  $('tabExplore').addEventListener('click', () => setMode('explore'));
  $('tabMine').addEventListener('click', () => setMode('mine'));
  sel.addEventListener('change', () => { state.uid = sel.value; render(); });
  $('overviewBtn').addEventListener('click', () => { state.uid = ''; render(); });
  $('randomBtn').addEventListener('click', () => {
    state.uid = userIds[Math.floor(Math.random()*userIds.length)];
    render();
  });

  /* ---------------- modal: add / import ---------------- */
  const backdrop = $('modalBackdrop');
  let entryType = 'Expense';

  function todayISO(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function fillCategories(){
    const list = entryType === 'Income' ? INCOME_CATS : EXPENSE_CATS;
    $('fCategory').innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join('');
  }
  function setType(t){
    entryType = t;
    $('typeExpense').classList.toggle('active', t === 'Expense');
    $('typeIncome').classList.toggle('active', t === 'Income');
    fillCategories();
  }
  function setPane(p){
    const add = p === 'add';
    $('paneAdd').classList.toggle('active', add);
    $('paneImport').classList.toggle('active', !add);
    $('paneTabAdd').classList.toggle('active', add);
    $('paneTabImport').classList.toggle('active', !add);
  }
  function renderMyList(){
    const list = Ledger.load().slice().sort((a,b) => String(b.date).localeCompare(String(a.date))).slice(0,40);
    show($('myListWrap'), list.length > 0);
    $('myList').innerHTML = list.map(t => `
      <div class="my-row">
        <span>${esc(t.date)} · ${esc(t.category)} · <b>${t.transaction_type === 'Income' ? '+' : '−'}${fmtFull(t.amount)}</b></span>
        <button type="button" data-del="${esc(t.id)}" aria-label="Delete entry">remove</button>
      </div>`).join('');
  }
  function openModal(pane){
    setPane(pane || 'add');
    $('fDate').value = todayISO();
    $('addMsg').textContent = ''; setImportMsg('');
    resetImport();
    renderMyList();
    setTimeout(() => { const f = pane === 'import' ? $('importFile') : $('fAmount'); if(f && pane !== 'import') f.focus(); }, 50);
    backdrop.classList.add('open'); backdrop.setAttribute('aria-hidden','false');
  }
  function closeModal(){ backdrop.classList.remove('open'); backdrop.setAttribute('aria-hidden','true'); }
  function afterDataChange(){
    state.mode = 'mine';
    renderMyList();
    render();
  }

  document.querySelectorAll('[data-open-modal]').forEach(b => b.addEventListener('click', () => openModal(b.getAttribute('data-open-modal'))));
  document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
  backdrop.addEventListener('click', e => { if(e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && backdrop.classList.contains('open')) closeModal(); });
  $('paneTabAdd').addEventListener('click', () => setPane('add'));
  $('paneTabImport').addEventListener('click', () => setPane('import'));
  $('typeExpense').addEventListener('click', () => setType('Expense'));
  $('typeIncome').addEventListener('click', () => setType('Income'));

  $('addForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseFloat($('fAmount').value);
    if(!(amount > 0)){ $('addMsg').textContent = 'Enter an amount greater than zero.'; return; }
    Ledger.addTransaction({
      date: $('fDate').value, type: entryType, category: $('fCategory').value,
      amount, payment_mode: $('fPay').value, location: $('fCity').value, notes: $('fNotes').value
    });
    $('fAmount').value = ''; $('fNotes').value = '';
    $('addMsg').textContent = 'Saved. Your score just updated. Add another or close this window.';
    afterDataChange();
  });

  /* ---------------- import: choose → review → confirm ---------------- */
  const CATS_ALL = EXPENSE_CATS.concat(['Salary','Freelance','Bonus']).filter((c,i,a)=>a.indexOf(c)===i);
  let pending = null, pendingFile = null;

  function setImportMsg(t, err){ const m = $('importMsg'); m.textContent = t; m.classList.toggle('err', !!err); }
  function resetImport(){
    pending = null; pendingFile = null; batch = null;
    show($('fileReport'), false); $('fileReport').innerHTML = '';
    show($('importStep1'), true); show($('importStep2'), false); show($('pwBox'), false);
    $('importFile').value = ''; $('pwInput').value = '';
  }

  function friendly(err){
    const c = err && err.code;
    if(c === 'SCANNED') return 'This PDF looks like a scan (a picture of a page), so there is no text to read. Download the statement as a CSV or a text PDF from your bank instead.';
    if(c === 'NO_ROWS') return 'No transactions could be found. Try your bank\'s CSV export, or check that the file is a statement with dates and amounts.';
    if(c === 'PDF_LIB_MISSING') return 'The PDF reader did not load. Keep the assets/vendor folder next to index.html.';
    if(c === 'WRONG_PASSWORD') return 'That password did not work. Try again.';
    return 'That file could not be read. ' + (err && err.message ? err.message : '');
  }

  /* ---- several files at once ----
     Every file is parsed on its own, so one bad file never blocks the others. Password-protected
     PDFs wait in a queue and are asked for one by one; when the queue is empty everything is
     merged into a single review table. */
  let batch = null;   // { rows:[], skipped:0, report:[{name,status,ok}], locked:[{file,wrong}] }

  function renderReport(){
    const ul = $('fileReport');
    ul.innerHTML = '';
    if(!batch || batch.report.length < 2 && !batch.report.some(r => !r.ok)){ show(ul, false); return; }
    batch.report.forEach(r => {
      const li = document.createElement('li');
      li.className = r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'wait';
      const fn = document.createElement('span'); fn.className = 'fn'; fn.textContent = r.name;
      const st = document.createElement('span'); st.className = 'st'; st.textContent = ' — ' + r.status;
      li.appendChild(fn); li.appendChild(st); ul.appendChild(li);
    });
    show(ul, true);
  }
  function setReport(name, status, ok){
    const e = batch.report.find(r => r.name === name);
    if(e){ e.status = status; e.ok = ok; } else batch.report.push({ name, status, ok });
  }

  async function parseOne(file, password){
    try{
      const res = await FinTwinStatement.parseFile(file, password);
      res.rows.forEach(r => { r.file = file.name; });
      batch.rows = batch.rows.concat(res.rows);
      batch.skipped += res.skipped || 0;
      batch.orders.push(res.order);
      setReport(file.name, res.rows.length + ' transaction' + (res.rows.length === 1 ? '' : 's') + ' found', true);
      return true;
    }catch(err){
      if(err && (err.code === 'PASSWORD' || err.code === 'WRONG_PASSWORD')){
        if(!batch.locked.some(l => l.file === file)) batch.locked.push({ file, wrong: false });
        setReport(file.name, 'password needed', null);
        return false;
      }
      setReport(file.name, friendly(err), false);
      return false;
    }
  }

  function nextStep(){
    renderReport();
    if(batch.locked.length){
      const cur = batch.locked[0];
      $('pwLabel').textContent = '"' + cur.file.name + '" is password-protected. Enter its password.'
        + (batch.locked.length > 1 ? ' (' + (batch.locked.length - 1) + ' more locked)' : '');
      show($('pwBox'), true); $('pwInput').value = ''; $('pwInput').focus();
      setImportMsg(cur.wrong ? friendly({ code:'WRONG_PASSWORD' }) : '', cur.wrong);
      return;
    }
    show($('pwBox'), false);
    if(!batch.rows.length){
      setImportMsg(batch.report.length > 1 ? 'None of these files had readable transactions. See the list above.' : (batch.report[0] ? batch.report[0].status : 'No transactions found.'), true);
      return;
    }
    const files = batch.report.filter(r => r.ok === true).length;
    const rows = FinTwinStatement.markBatchDuplicates(batch.rows);
    const okFiles = batch.report.filter(r => r.ok === true).map(r => r.name);
    const order = batch.orders.find(o => o) || null;
    pending = { rows, skipped: batch.skipped, order, multi: files > 1 };
    showReview(pending, files > 1 ? files + ' files' : okFiles[0] || 'the file');
    const failed = batch.report.filter(r => r.ok === false).length;
    setImportMsg(failed ? failed + ' file' + (failed === 1 ? '' : 's') + ' could not be read and ' + (failed === 1 ? 'was' : 'were') + ' left out.' : '', !!failed);
  }

  async function handleFiles(fileList){
    const files = Array.from(fileList || []).filter(Boolean);
    if(!files.length) return;
    batch = { rows: [], skipped: 0, report: [], locked: [], orders: [] };
    files.forEach(f => batch.report.push({ name: f.name, status: 'reading...', ok: null }));
    setImportMsg('Reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '...');
    renderReport();
    for(const f of files) await parseOne(f);
    setImportMsg('');
    nextStep();
  }

  async function unlockCurrent(){
    if(!batch || !batch.locked.length) return;
    const cur = batch.locked[0];
    const ok = await parseOne(cur.file, $('pwInput').value);
    if(ok) batch.locked.shift();
    else if(batch.locked[0] && batch.locked[0].file === cur.file && batch.report.find(r => r.name === cur.file.name).status === 'password needed'){
      cur.wrong = true;
    } else batch.locked.shift();   // failed for another reason: drop it, the list shows why
    nextStep();
  }
  function skipCurrent(){
    if(!batch || !batch.locked.length) return;
    const cur = batch.locked.shift();
    setReport(cur.file.name, 'skipped (password not given)', false);
    nextStep();
  }

  // the chat's paperclip uses this too
  window.FinTwinImport = { open(files){ openModal('import'); handleFiles(files); } };

  function showReview(res, name){
    show($('importStep1'), false); show($('importStep2'), true);
    show($('reviewFileTh'), !!res.multi);
    const n = res.rows.length, dupes = res.rows.filter(r => r.duplicate).length;
    $('reviewLead').textContent = 'Found ' + n + ' transaction' + (n === 1 ? '' : 's') + ' in ' + name
      + (res.order ? ' (dates read as ' + (res.order === 'md' ? 'month first' : 'day first') + ')' : '')
      + '.' + (dupes ? ' ' + dupes + ' look like duplicates (already saved, or repeated in another file) and are unticked.' : '')
      + (res.skipped ? ' ' + res.skipped + ' line' + (res.skipped === 1 ? '' : 's') + ' skipped.' : '')
      + ' Check the type and category, untick anything wrong, then add.';
    const body = $('reviewBody'); body.innerHTML = '';
    res.rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if(!r.include) tr.className = 'off';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = r.include; cb.setAttribute('aria-label', 'Include row ' + (i+1));
      cb.addEventListener('change', () => { r.include = cb.checked; tr.classList.toggle('off', !cb.checked); updateConfirm(); });
      const td0 = document.createElement('td'); td0.appendChild(cb);
      const td1 = document.createElement('td'); td1.textContent = r.date;
      if(r.duplicate){ const b = document.createElement('span'); b.className = 'dupe'; b.textContent = r.dupLabel || 'already added'; td1.appendChild(b); }
      const typeSel = document.createElement('select'); typeSel.setAttribute('aria-label','Type');
      ['Expense','Income'].forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t === 'Expense' ? 'Spent' : 'Earned'; typeSel.appendChild(o); });
      typeSel.value = r.type;
      const catSel = document.createElement('select'); catSel.setAttribute('aria-label','Category');
      (CATS_ALL.indexOf(r.category) < 0 ? CATS_ALL.concat([r.category]) : CATS_ALL).forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o); });
      catSel.value = r.category;
      typeSel.addEventListener('change', () => { r.type = typeSel.value; amt.className = 'amt num ' + (r.type === 'Income' ? 'income' : ''); amt.textContent = (r.type === 'Income' ? '+' : '−') + fmtFull(r.amount); updateConfirm(); });
      catSel.addEventListener('change', () => { r.category = catSel.value; });
      const td2 = document.createElement('td'); td2.appendChild(typeSel);
      const td3 = document.createElement('td'); td3.appendChild(catSel);
      const amt = document.createElement('td'); amt.className = 'amt num ' + (r.type === 'Income' ? 'income' : ''); amt.textContent = (r.type === 'Income' ? '+' : '−') + fmtFull(r.amount);
      const td5 = document.createElement('td'); td5.className = 'note'; td5.textContent = r.notes || ''; td5.title = r.notes || '';
      [td0, td1, td2, td3, amt, td5].forEach(td => tr.appendChild(td));
      if(res.multi){ const tdf = document.createElement('td'); const ft = document.createElement('span'); ft.className = 'file-tag'; ft.textContent = r.file || ''; ft.title = r.file || ''; tdf.appendChild(ft); tr.appendChild(tdf); }
      body.appendChild(tr);
    });
    $('reviewAll').checked = res.rows.every(r => r.include);
    updateConfirm();
  }
  function updateConfirm(){
    const picked = pending ? pending.rows.filter(r => r.include).length : 0;
    $('reviewConfirm').textContent = picked ? 'Add ' + picked + ' row' + (picked === 1 ? '' : 's') : 'Nothing selected';
    $('reviewConfirm').disabled = !picked;
  }

  $('importFile').addEventListener('change', e => { handleFiles(e.target.files); });
  $('pwBtn').addEventListener('click', unlockCurrent);
  $('pwSkip').addEventListener('click', skipCurrent);
  $('pwInput').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); unlockCurrent(); } });
  const drop = $('dropZone');
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const fl = e.dataTransfer && e.dataTransfer.files; if(fl && fl.length) handleFiles(fl); });

  $('importBtn').addEventListener('click', () => {
    const res = FinTwinStatement.parseText($('importText').value || '');
    if(!res || !res.rows || !res.rows.length){ setImportMsg('No rows found. Each line needs at least a date and an amount.', true); return; }
    pending = res; showReview(res, 'the pasted text'); setImportMsg('');
  });
  $('reviewAll').addEventListener('change', () => {
    if(!pending) return;
    const on = $('reviewAll').checked;
    pending.rows.forEach(r => { r.include = on; });
    document.querySelectorAll('#reviewBody tr').forEach(tr => { tr.classList.toggle('off', !on); tr.querySelector('input[type=checkbox]').checked = on; });
    updateConfirm();
  });
  $('reviewBack').addEventListener('click', () => { resetImport(); setImportMsg(''); });
  $('reviewConfirm').addEventListener('click', () => {
    const chosen = pending.rows.filter(r => r.include);
    if(!chosen.length) return;
    Ledger.importTransactions(chosen);
    resetImport();
    setImportMsg('Added ' + chosen.length + ' row' + (chosen.length === 1 ? '' : 's') + '. Your report has updated.');
    afterDataChange();
    closeModal();
    window.scrollTo({ top:0, behavior:'smooth' });
  });
  $('myList').addEventListener('click', e => {
    const id = e.target && e.target.getAttribute && e.target.getAttribute('data-del');
    if(!id) return;
    Ledger.removeTransaction(id);
    renderMyList();
    render();
  });
  $('clearBtn').addEventListener('click', () => {
    if(window.confirm('Remove all the entries you added? This cannot be undone.')){
      Ledger.reset(); lastMineScore = null; renderMyList(); render();
    }
  });

  /* ---------------- sample data (so the empty state is never a dead end) ---------------- */
  function sampleRows(){
    const out = [];
    const now = new Date();
    for(let k=5; k>=0; k--){
      const d = new Date(now.getFullYear(), now.getMonth()-k, 1);
      const y = d.getFullYear(), m = d.getMonth();
      const iso = day => y + '-' + String(m+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
      const wob = (k*137) % 400;
      out.push({ date:iso(1),  type:'Income',  category:'Salary',        amount:62000,        payment_mode:'Bank Transfer' });
      if(k % 2 === 0) out.push({ date:iso(18), type:'Income', category:'Freelance', amount:8000 + wob*5, payment_mode:'UPI' });
      out.push({ date:iso(3),  type:'Expense', category:'Rent',          amount:16000,        payment_mode:'Bank Transfer' });
      out.push({ date:iso(6),  type:'Expense', category:'Utilities',     amount:2300 + wob,   payment_mode:'UPI' });
      out.push({ date:iso(8),  type:'Expense', category:'Food',          amount:2100 + wob,   payment_mode:'UPI' });
      out.push({ date:iso(14), type:'Expense', category:'Food',          amount:1850 + wob,   payment_mode:'Card' });
      out.push({ date:iso(21), type:'Expense', category:'Food',          amount:2400 - wob/2, payment_mode:'UPI' });
      out.push({ date:iso(11), type:'Expense', category:'Entertainment', amount:1200 + wob*2, payment_mode:'Card' });
      out.push({ date:iso(16), type:'Expense', category:'Shopping',      amount:2600 + wob*3, payment_mode:'Card' });
      out.push({ date:iso(24), type:'Expense', category:'Investment',    amount:5000,         payment_mode:'Bank Transfer' });
      if(k % 2 === 1) out.push({ date:iso(26), type:'Expense', category:'Travel', amount:3500 + wob*2, payment_mode:'Cash' });
      if(k === 2)     out.push({ date:iso(20), type:'Expense', category:'Shopping', amount:38000, payment_mode:'Card' });
    }
    return out;
  }
  $('sampleBtn').addEventListener('click', () => {
    Ledger.importTransactions(sampleRows());
    afterDataChange();
  });

  /* ---------------- boot ---------------- */
  buildQuality();
  buildMl();
  setType('Expense');
  Advisor.init();
  render();
})();
