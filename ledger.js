/* ============================================================
   FinTwin Ledger — lets someone track their own money in the browser.
   Stores transactions in localStorage (this device only) and computes
   the exact same dataset shape the Python pipeline produces, so the
   existing chart-building code in script.js can render it unchanged.
   ============================================================ */
window.FinTwinLedger = (function(){
  const KEY = 'fintwin_my_transactions_v1';

  const CATEGORY_MAP = {
    'educaton':'Education','education':'Education','edu':'Education',
    'fod':'Food','foods':'Food','food':'Food','foodd':'Food',
    'entertainment':'Entertainment','entertain':'Entertainment','entrtnmnt':'Entertainment',
    'utilties':'Utilities','utility':'Utilities','utlities':'Utilities','utilities':'Utilities',
    'rentt':'Rent','rent':'Rent','rnt':'Rent',
    'travel':'Travel','travl':'Travel','traval':'Travel',
    'health':'Health','helth':'Health',
    'investment':'Investment','saving':'Savings','savings':'Savings',
    'salary':'Salary','freelance':'Freelance','bonus':'Bonus',
    'others':'Other','other':'Other','misc':'Other','shopping':'Shopping','groceries':'Food',
  };
  const PAY_MAP = { 'card':'Card','crd':'Card','csh':'Cash','cash':'Cash','upi':'UPI' };

  function cleanCategory(c){
    if(!c) return 'Other';
    const s = String(c).trim().toLowerCase().replace(/[^a-z]/g,'');
    if(CATEGORY_MAP[s]) return CATEGORY_MAP[s];
    const t = String(c).trim();
    return t ? t[0].toUpperCase()+t.slice(1).toLowerCase() : 'Other';
  }
  function cleanPayment(p){
    if(!p) return 'Unknown';
    const s = String(p).trim().toLowerCase().replace(/[\s_]/g,'');
    if(PAY_MAP[s]) return PAY_MAP[s];
    if(s.indexOf('bank')>=0) return 'Bank Transfer';
    const t = String(p).trim();
    return t ? t[0].toUpperCase()+t.slice(1).toLowerCase() : 'Unknown';
  }
  function cleanAmount(a){
    if(a===null || a===undefined || a==='') return NaN;
    let s = String(a).trim().replace(/Rs\.?|₹|\$|INR|,/gi,'').trim();
    const v = parseFloat(s);
    return isNaN(v) ? NaN : v;
  }
  function cleanDate(d){
    if(!d) return null;
    const s = String(d).trim();
    let m;
    if(m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)) return new Date(+m[1], +m[2]-1, +m[3]);
    if(m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)) return new Date(+m[3], +m[1]-1, +m[2]); // MM/DD/YYYY
    if(m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/)) return new Date(+m[3], +m[2]-1, +m[1]); // DD-MM-YYYY
    if(m = s.match(/^(\d{2})-(\d{2})-(\d{2})$/)){ // DD-MM-YY
      let yy = +m[3]; yy += (yy < 70 ? 2000 : 1900);
      return new Date(yy, +m[2]-1, +m[1]);
    }
    const guess = new Date(s);
    return isNaN(guess.getTime()) ? null : guess;
  }

  function load(){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return [];
      return JSON.parse(raw);
    }catch(e){ return []; }
  }
  function save(list){
    try{ localStorage.setItem(KEY, JSON.stringify(list)); return true; }
    catch(e){ return false; }
  }
  function reset(){ try{ localStorage.removeItem(KEY); }catch(e){} }

  function addTransaction(t){
    const list = load();
    list.push({
      id: 'm' + Date.now() + Math.floor(Math.random()*1000),
      date: t.date, // 'YYYY-MM-DD'
      transaction_type: t.type,
      category: cleanCategory(t.category),
      amount: cleanAmount(t.amount),
      payment_mode: cleanPayment(t.payment_mode),
      location: t.location ? String(t.location).trim() : 'Unknown',
      notes: t.notes || '',
    });
    save(list);
    return list;
  }
  function removeTransaction(id){
    const list = load().filter(t => t.id !== id);
    save(list);
    return list;
  }

  // Parse pasted / uploaded CSV-ish text. Accepts a header row (any order of
  // date,type,category,amount,payment_mode,location,notes) or falls back to
  // that fixed column order if no recognizable header is found.
  function parseText(text){
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if(!lines.length) return [];
    const splitLine = (l) => l.split(',').map(c => c.trim().replace(/^"|"$/g,''));
    let headerFields = splitLine(lines[0]).map(h => h.toLowerCase());
    const known = ['date','transaction_type','type','category','amount','payment_mode','payment','location','notes'];
    const hasHeader = headerFields.some(h => known.includes(h));
    let cols, startIdx;
    if(hasHeader){
      cols = headerFields.map(h => h==='type' ? 'transaction_type' : h==='payment' ? 'payment_mode' : h);
      startIdx = 1;
    } else {
      cols = ['date','transaction_type','category','amount','payment_mode','location','notes'];
      startIdx = 0;
    }
    const out = [];
    for(let i=startIdx;i<lines.length;i++){
      const vals = splitLine(lines[i]);
      const row = {};
      cols.forEach((c,idx) => { row[c] = vals[idx]; });
      if(!row.amount || !row.date) continue;
      const typeRaw = (row.transaction_type||'').toLowerCase();
      out.push({
        date: row.date,
        type: typeRaw.indexOf('inc')>=0 ? 'Income' : 'Expense',
        category: row.category,
        amount: row.amount,
        payment_mode: row.payment_mode,
        location: row.location,
        notes: row.notes,
      });
    }
    return out;
  }
  function importTransactions(parsedList){
    const list = load();
    parsedList.forEach(t => {
      list.push({
        id: 'm' + Date.now() + Math.floor(Math.random()*100000),
        date: t.date,
        transaction_type: t.type,
        category: cleanCategory(t.category),
        amount: cleanAmount(t.amount),
        payment_mode: cleanPayment(t.payment_mode),
        location: t.location ? String(t.location).trim() : 'Unknown',
        notes: t.notes || '',
      });
    });
    save(list);
    return list;
  }

  // ---------------- analytics (mirrors pipeline/analyze.py) ----------------
  function monthKey(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); }
  function monthLabel(ym){
    const [y,m] = ym.split('-').map(Number);
    const names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return names[m-1] + " '" + String(y).slice(2);
  }
  function monthRange(startYM, endYM){
    const out = [];
    let [y,m] = startYM.split('-').map(Number);
    const [ey,em] = endYM.split('-').map(Number);
    while(y < ey || (y===ey && m<=em)){
      out.push(y + '-' + String(m).padStart(2,'0'));
      m++; if(m>12){ m=1; y++; }
    }
    return out;
  }
  function nextMonths(lastYM, n){
    let [y,m] = lastYM.split('-').map(Number);
    const out = [];
    for(let i=0;i<n;i++){ m++; if(m>12){m=1;y++;} out.push(y+'-'+String(m).padStart(2,'0')); }
    return out;
  }
  function forecastNext(series, n){
    const y = series.slice();
    const nz = [];
    y.forEach((v,i)=>{ if(v) nz.push(i); });
    if(nz.length < 3){
      const positives = y.filter(v=>v>0);
      const avg = positives.length ? positives.reduce((a,b)=>a+b,0)/positives.length : 0;
      return new Array(n).fill(Math.round(avg*100)/100);
    }
    const lastIdx = nz[nz.length-1];
    const start = Math.max(0, lastIdx-11);
    const yFit = y.slice(start, lastIdx+1);
    const xFit = yFit.map((_,i)=>i);
    const nPts = xFit.length;
    const sx = xFit.reduce((a,b)=>a+b,0), sy = yFit.reduce((a,b)=>a+b,0);
    const sxy = xFit.reduce((a,x,i)=>a+x*yFit[i],0), sxx = xFit.reduce((a,x)=>a+x*x,0);
    const denom = (nPts*sxx - sx*sx) || 1;
    const slope = (nPts*sxy - sx*sy)/denom;
    const intercept = (sy - slope*sx)/nPts;
    const preds = [];
    for(let i=1;i<=n;i++){
      const val = slope*(nPts-1+i) + intercept;
      preds.push(Math.round(Math.max(0,val)*100)/100);
    }
    return preds;
  }

  function computeDataset(rawTxns){
    const txns = rawTxns
      .map(t => ({ ...t, _date: cleanDate(t.date), _amount: cleanAmount(t.amount) }))
      .filter(t => t._date && !isNaN(t._amount));

    if(!txns.length){
      return null;
    }

    let minYM=null, maxYM=null;
    txns.forEach(t=>{
      const ym = monthKey(t._date);
      if(!minYM || ym<minYM) minYM=ym;
      if(!maxYM || ym>maxYM) maxYM=ym;
    });
    const months = monthRange(minYM, maxYM);

    // anomaly detection: per-category IQR on expenses (needs >=4 points),
    // else flag amount > 3x the category's own mean; always flag negatives
    // and extreme (>200000) values.
    const expByCat = {};
    txns.forEach(t=>{
      if(t.transaction_type==='Expense'){
        (expByCat[t.category] = expByCat[t.category]||[]).push(t);
      }
    });
    const anomalyIds = new Set();
    const anomalyReason = {};
    Object.keys(expByCat).forEach(cat=>{
      const arr = expByCat[cat].map(t=>t._amount).sort((a,b)=>a-b);
      if(arr.length>=4){
        const q1 = arr[Math.floor(arr.length*0.25)];
        const q3 = arr[Math.floor(arr.length*0.75)];
        const iqr = q3-q1;
        const hi = q3 + 1.5*iqr;
        expByCat[cat].forEach(t=>{ if(t._amount>hi){ anomalyIds.add(t.id||t._date+t._amount); anomalyReason[t.id||t._date+t._amount]='Unusually high '+cat.toLowerCase()+' spend'; }});
      } else if(arr.length>=1){
        const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
        expByCat[cat].forEach(t=>{ if(mean>0 && t._amount > mean*3 && arr.length>1){ anomalyIds.add(t.id||t._date+t._amount); anomalyReason[t.id||t._date+t._amount]='Unusually high '+cat.toLowerCase()+' spend'; }});
      }
    });
    txns.forEach(t=>{
      const key = t.id||t._date+t._amount;
      if(t._amount<0){ anomalyIds.add(key); anomalyReason[key]='Negative amount (data error)'; }
      if(t._amount>200000){ anomalyIds.add(key); anomalyReason[key]='Extreme outlier amount'; }
    });

    const trusted = txns.filter(t => !anomalyIds.has(t.id||t._date+t._amount));

    function monthlySeries(list){
      const inc = {}, exp = {};
      list.forEach(t=>{
        const ym = monthKey(t._date);
        if(t.transaction_type==='Income') inc[ym]=(inc[ym]||0)+t._amount;
        else exp[ym]=(exp[ym]||0)+t._amount;
      });
      return [months.map(m=>Math.round((inc[m]||0)*100)/100), months.map(m=>Math.round((exp[m]||0)*100)/100)];
    }
    function breakdown(list, type, field){
      const sums = {};
      list.filter(t=>type?t.transaction_type===type:true).forEach(t=>{
        const key = t[field] || 'Unknown';
        sums[key] = (sums[key]||0) + t._amount;
      });
      const out = {};
      Object.keys(sums).sort((a,b)=>sums[b]-sums[a]).forEach(k=>{ out[k]=Math.round(sums[k]*100)/100; });
      return out;
    }
    function healthScore(list, fullList){
      const inc = list.filter(t=>t.transaction_type==='Income').reduce((a,t)=>a+t._amount,0);
      const exp = list.filter(t=>t.transaction_type==='Expense').reduce((a,t)=>a+t._amount,0);
      const savingsRate = inc>0 ? (inc-exp)/inc : -1;
      const s1 = Math.max(0,Math.min(1,savingsRate))*100;

      const expM = {};
      list.filter(t=>t.transaction_type==='Expense').forEach(t=>{ const ym=monthKey(t._date); expM[ym]=(expM[ym]||0)+t._amount; });
      const vals = Object.values(expM).filter(v=>v>0);
      let cv = 0;
      if(vals.length>1){
        const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
        const variance = vals.reduce((a,b)=>a+(b-mean)*(b-mean),0)/vals.length;
        cv = mean>0 ? Math.sqrt(variance)/mean : 0;
      }
      const s2 = Math.max(0, 100 - cv*100);

      const nTxn = fullList.length;
      const nAnom = fullList.filter(t=>anomalyIds.has(t.id||t._date+t._amount)).length;
      const s3 = Math.max(0, 100 - Math.min(100, (nAnom/Math.max(1,nTxn))*500));

      const catSums = {};
      list.filter(t=>t.transaction_type==='Expense').forEach(t=>{ catSums[t.category]=(catSums[t.category]||0)+t._amount; });
      const catVals = Object.values(catSums);
      const catTotal = catVals.reduce((a,b)=>a+b,0);
      let s4 = 0;
      if(catTotal>0){
        const hhi = catVals.reduce((a,v)=>a+Math.pow(v/catTotal,2),0);
        s4 = (1-hhi)*100;
      }
      const overall = 0.4*s1 + 0.25*s2 + 0.2*s3 + 0.15*s4;
      return {
        overall: Math.round(overall*10)/10, savings: Math.round(s1*10)/10, stability: Math.round(s2*10)/10,
        anomaly_free: Math.round(s3*10)/10, diversification: Math.round(s4*10)/10,
        savings_rate_pct: Math.round(savingsRate*1000)/10,
        total_income: Math.round(inc*100)/100, total_expense: Math.round(exp*100)/100, net_savings: Math.round((inc-exp)*100)/100,
        txn_count: nTxn, anomaly_count: nAnom,
      };
    }
    function anomalyList(list, limit){
      const flagged = list.filter(t=>anomalyIds.has(t.id||t._date+t._amount));
      flagged.sort((a,b)=>b._date-a._date);
      return flagged.slice(0,limit).map(t=>({
        date: t._date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
        user: 'You', category: t.category, amount: Math.round(t._amount*100)/100,
        reason: anomalyReason[t.id||t._date+t._amount] || 'Flagged', location: t.location,
      }));
    }

    // one [date, amount, category, kind] row per entry, same shape as the Python pipeline
    // kind: 0 normal, 1 unusually high for its category, 2 extreme outlier, 3 negative (data error)
    function pointsList(list){
      const pad = n => String(n).padStart(2,'0');
      return list.slice().sort((a,b)=>a._date-b._date).map(t=>{
        const reason = anomalyReason[t.id||t._date+t._amount] || '';
        let kind = 0;
        if(reason.indexOf('Negative')===0) kind = 3;
        else if(reason.indexOf('Extreme')===0) kind = 2;
        else if(reason.indexOf('Unusually')===0) kind = 1;
        return [t._date.getFullYear()+'-'+pad(t._date.getMonth()+1)+'-'+pad(t._date.getDate()),
                Math.round(t._amount*100)/100, t.category, kind];
      });
    }

    const [incSeries, expSeries] = monthlySeries(trusted);
    return {
      months,
      income_series: incSeries,
      expense_series: expSeries,
      income_forecast: forecastNext(incSeries, 3),
      expense_forecast: forecastNext(expSeries, 3),
      category_breakdown: breakdown(trusted, 'Expense', 'category'),
      payment_breakdown: breakdown(trusted, 'Expense', 'payment_mode'),
      location_breakdown: breakdown(trusted, null, 'location'),
      health: healthScore(trusted, txns),
      anomalies: anomalyList(txns, 8),
      points: pointsList(txns),
      points_sampled: false,
      txn_count: txns.length,
      _monthLabel: monthLabel,
    };
  }

  return { load, save, reset, addTransaction, removeTransaction, parseText, importTransactions, computeDataset, cleanCategory, cleanPayment, cleanDate, cleanAmount };
})();
