/* ============================================================
   FinTwin Advisor — "Ask your Twin"
   A rules-based assistant (no external API — this runs entirely in the
   browser) that reads whatever dataset is currently on screen and turns
   its numbers into plain-language suggestions. General financial
   education, not personalized investment advice from a licensed advisor.
   ============================================================ */
window.FinTwinAdvisor = (function(){
  function fmt(n){
    const sign = n<0?'-':'';
    n = Math.abs(n);
    if(n>=1e7) return sign+'₹'+(n/1e7).toFixed(2)+' Cr';
    if(n>=1e5) return sign+'₹'+(n/1e5).toFixed(2)+' L';
    if(n>=1e3) return sign+'₹'+(n/1e3).toFixed(1)+'K';
    return sign+'₹'+Math.round(n);
  }
  function topCategory(d){
    const entries = Object.entries(d.category_breakdown||{});
    if(!entries.length) return null;
    entries.sort((a,b)=>b[1]-a[1]);
    return entries[0];
  }
  function catTip(cat){
    const tips = {
      'Food':'Batch-cooking a few meals and capping food-delivery app orders to once or twice a week is usually the fastest lever here.',
      'Rent':"Rent is often fixed, but if it's eating a big share of income, a roommate, a slightly cheaper area, or renegotiating at renewal are the usual options.",
      'Entertainment':'A quick subscription audit — cancel what you forgot you had — tends to free up more than people expect.',
      'Travel':'Booking a few weeks ahead and setting a per-trip budget before you go helps keep this one in check.',
      'Utilities':'Worth checking for a better plan or tariff slab, and switching off standby appliances — small but it adds up monthly.',
      'Shopping':'A 24-hour "wait before you buy" rule for anything non-essential is a simple way to cut impulse spend here.',
      'Health':'Health spend is usually non-negotiable — but check if an insurance plan or HSA-style cover could absorb more of it.',
      'Education':"This is an investment in yourself, so it's usually fine for it to be a larger share — just track it against a plan.",
      'Other':"A lot of spend is sitting in 'Other' — breaking it into real categories next month will make this picture much clearer.",
      'Savings':'This being your top expense category is actually a great sign — it means money is being set aside before it gets spent.',
    };
    return tips[cat] || "Keeping an eye on this category month over month is the simplest way to catch it creeping up.";
  }

  function introLine(d, isEmpty){
    if(isEmpty) return "I'm your Twin. I don't have any of your numbers yet. Add a transaction or import a statement and I'll start giving you real suggestions.";
    return "I'm your Twin. I can see the figures on your dashboard right now, so ask me about saving more, investing, your score, or anything flagged as unusual.";
  }

  /* ============================================================
     Keyword engine
     The question is lower-cased and split into words. Every topic lists keywords with weights;
     a keyword matches an exact word, the same word with a different ending (spend / spending /
     spent is handled by listing both), or a word with one or two typos (invesment, savigns).
     Phrases (two or more words) match as written. The topic with the highest total wins; if a
     second topic scores nearly as high, both are answered. So "how much did I spend on food and
     is my score ok" gets both parts, and "tell me about loans" works without an exact sentence.
     ============================================================ */
  const CATEGORY_WORDS = {
    Food: 'food eat eating restaurant restaurants swiggy zomato grocery groceries dining meal meals takeaway',
    Rent: 'rent housing landlord',
    Travel: 'travel transport uber ola cab cabs fuel petrol flight flights commute trip trips',
    Utilities: 'utilities utility electricity bills wifi internet recharge water',
    Entertainment: 'entertainment movie movies netflix subscription subscriptions fun gaming ott',
    Shopping: 'shopping clothes clothing amazon flipkart gadgets',
    Health: 'health medical doctor medicine medicines hospital pharmacy',
    Education: 'education school college tuition course courses fees',
    Investment: 'investments invested',
    Other: 'other others misc miscellaneous',
  };

  const STOP = new Set('the a an is are was were be been am i me my mine you your we it its of on in at to for and or but with about do does did can could should would will please tell show give what how why when which who whom this that these those there here any some more much many get got just also than then so if as by from into out up'.split(' '));

  function norm(text){
    return ' ' + String(text || '').toLowerCase().replace(/[₹]/g, ' rs ').replace(/[^a-z0-9%.\s/]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }
  function words(text){ return norm(text).trim().split(' ').filter(Boolean); }
  function stem(w){
    return w.replace(/(ing|ed|es|s)$/, '').replace(/(.)\1$/, '$1');
  }
  function editDistance(a, b){
    if(Math.abs(a.length - b.length) > 2) return 3;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for(let i = 1; i <= a.length; i++){
      let last = prev[0]; prev[0] = i;
      for(let j = 1; j <= b.length; j++){
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
        last = tmp;
      }
    }
    return prev[b.length];
  }
  function wordMatches(token, kw){
    if(token === kw) return true;
    if(token.length < 3 || kw.length < 3) return false;
    const st = stem(token), sk = stem(kw);
    if(st === sk && st.length >= 3) return true;
    if(kw.length >= 5 && token.length >= 5){
      const lim = kw.length >= 8 ? 2 : 1;
      return editDistance(token, kw) <= lim || editDistance(st, sk) <= lim;
    }
    return false;
  }
  // does the question contain this keyword (a word, or a phrase if it has a space)?
  function has(q, kw){
    if(kw.indexOf(' ') >= 0) return q.text.indexOf(' ' + kw + ' ') >= 0 || q.text.indexOf(' ' + kw) >= 0;
    return q.tokens.some(t => wordMatches(t, kw));
  }
  function anyOf(q, list){ return list.some(k => has(q, k)); }

  function categoriesIn(q, d){
    const present = Object.keys((d && d.category_breakdown) || {});
    const found = [];
    Object.entries(CATEGORY_WORDS).forEach(([cat, syn]) => {
      if(syn.split(' ').some(w => q.tokens.some(t => t === w || (t.length > 4 && t.replace(/s$/, '') === w.replace(/s$/, ''))))) found.push(cat);
      else if(q.tokens.some(t => t === cat.toLowerCase())) found.push(cat);
    });
    // also any category the dataset has that is not in the table above
    present.forEach(cat => { if(found.indexOf(cat) < 0 && q.tokens.some(t => t === cat.toLowerCase())) found.push(cat); });
    return found;
  }

  /* ---- numbers in a question: "5000 a month for 10 years at 12%" ---- */
  function parseAmount(m, unit){
    let v = parseFloat(String(m).replace(/,/g, ''));
    if(isNaN(v)) return null;
    unit = (unit || '').toLowerCase();
    if(unit === 'k' || unit === 'thousand') v *= 1e3;
    else if(unit === 'l' || unit === 'lakh' || unit === 'lakhs' || unit === 'lac' || unit === 'lacs') v *= 1e5;
    else if(unit === 'cr' || unit === 'crore' || unit === 'crores') v *= 1e7;
    return v;
  }
  function parseNumbers(text){
    const t = String(text || '').toLowerCase().replace(/₹/g, ' ');
    const out = { amount: null, years: null, rate: null };
    let m = t.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?|y)\b/);
    if(m) out.years = parseFloat(m[1]);
    else if((m = t.match(/(\d+(?:\.\d+)?)\s*months?\b/))) out.years = parseFloat(m[1]) / 12;
    m = t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)/);
    if(m) out.rate = parseFloat(m[1]);
    const re = /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr)?\b/g;
    let best = null;
    while((m = re.exec(t)) !== null){
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 12);
      if(/^\s*(?:%|percent|per cent|years?|yrs?|y\b|months?)/.test(after) && !m[2]) continue;
      const v = parseAmount(m[1], m[2]);
      if(v !== null && v >= 100 && (best === null || v > best)) best = v;
    }
    out.amount = best;
    return out;
  }
  function growth(monthly, lump, years, rate){
    const n = Math.round(years * 12), i = rate / 100 / 12;
    let fv = 0;
    if(monthly) fv += i ? monthly * ((Math.pow(1 + i, n) - 1) / i) * (1 + i) : monthly * n;
    if(lump) fv += lump * Math.pow(1 + i, n);
    return fv;
  }

  /* ---- helpers over the dataset ---- */
  function monthName(ym){
    const [y, m] = String(ym).split('-').map(Number);
    if(!y || !m) return String(ym);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  function pickMonth(series, months, mode){
    let idx = -1;
    series.forEach((v, i) => {
      if(idx < 0 || (mode === 'max' ? v > series[idx] : v < series[idx])) idx = i;
    });
    return idx < 0 ? null : { name: monthName(months[idx]), value: series[idx] };
  }
  const NEEDS_DATA = "I don't have any numbers to work with yet. Add transactions or import statements (PDF or CSV, several at once is fine), or switch to a sample twin, and ask me again.";

  /* ---- the topics ---- */
  // kw: [keyword, weight]; neg: words that rule the topic out; data: needs the dashboard figures
  const TOPICS = [
    { id:'category', label:'spending by category', data:true,
      score: (q, d) => categoriesIn(q, d).length ? 7 : 0,
      reply: (q, d) => {
        const cats = categoriesIn(q, d), br = d.category_breakdown || {}, total = d.health.total_expense || 1;
        const months = Math.max(1, (d.months || []).length);
        const ranked = Object.entries(br).sort((a, b) => b[1] - a[1]).map(e => e[0]);
        return cats.map(cat => {
          const amt = br[cat];
          if(!amt) return `I don't see any ${cat.toLowerCase()} spending in these figures.`;
          const pct = Math.round(amt / total * 100);
          return `${cat}: ${fmt(amt)} in total, which is ${pct}% of your spending and about ${fmt(amt / months)} a month. It ranks #${ranked.indexOf(cat) + 1} of ${ranked.length} categories. ${catTip(cat)}`;
        }).join('\n\n');
      }},
    { id:'top-category', label:'biggest spending category', data:true,
      kw: [['biggest',3],['largest',3],['highest',2],['top',2],['most',2],['main',1],['major',2],['maximum',2],['spend',1],['spending',1],['expense',1],['expenses',1],['category',2],['categories',2],['where',1],['going',1],['goes',1]],
      neg: ['month','months','monthly','year','income','earn','salary','invest','score','forecast','loan','emi','least','lowest','smallest','fewest','minimum'], min: 4,
      reply: (q, d) => {
        const br = Object.entries(d.category_breakdown || {}).sort((a, b) => b[1] - a[1]);
        if(!br.length) return "I don't see enough expense data yet to rank categories.";
        const total = d.health.total_expense || 1;
        const top3 = br.slice(0, 3).map(([c, v]) => `- ${c}: ${fmt(v)} (${Math.round(v / total * 100)}%)`).join('\n');
        return `Your money mostly goes to ${br[0][0]}. Top three:\n${top3}\n${catTip(br[0][0])}`;
      }},
    { id:'low-category', label:'smallest spending category', data:true,
      kw: [['least',5],['lowest',5],['smallest',5],['minimum',3],['fewest',4],['spend',1],['spending',1],['category',2]], neg:['month','months','income'], min: 5,
      reply: (q, d) => {
        const br = Object.entries(d.category_breakdown || {}).sort((a, b) => a[1] - b[1]);
        if(!br.length) return "I don't see enough expense data yet.";
        return `Your smallest spending category is ${br[0][0]} at ${fmt(br[0][1])}, then ${br.slice(1, 3).map(([c, v]) => c + ' (' + fmt(v) + ')').join(' and ')}.`;
      }},
    { id:'totals', label:'income and spending totals', data:true,
      kw: [['total',2],['income',3],['earn',3],['earned',3],['earning',3],['earnings',3],['salary',2],['spent',3],['spend',2],['spending',2],['expense',2],['expenses',2],['how much',2],['kept',2],['left',2],['net',2],['money',1],['transactions',2],['transaction',2],['count',1],['number',1]],
      neg:['month','months','monthly','invest','score','forecast','category','rate','loan','vs','versus','compare','upi','card','cash','payment'], min: 4,
      reply: (q, d) => {
        const h = d.health, wantsIncome = anyOf(q, ['income','earn','earned','earning','earnings','salary']), wantsSpend = anyOf(q, ['spent','spend','spending','expense','expenses']);
        const lines = [];
        if(wantsIncome || !wantsSpend) lines.push(`- Income: ${fmt(h.total_income)}`);
        if(wantsSpend || !wantsIncome) lines.push(`- Spending: ${fmt(h.total_expense)}`);
        if(!wantsIncome || !wantsSpend) lines.push(`- Kept: ${fmt(h.net_savings)} (${h.savings_rate_pct}% of income)`);
        const n = h.txn_count ? `\nThis is based on ${h.txn_count.toLocaleString('en-IN')} transactions.` : '';
        return `Here are your totals:\n${lines.join('\n')}${n}`;
      }},
    { id:'rate', label:'savings rate', data:true,
      kw: [['savings rate',5],['saving rate',5],['save rate',4],['how much saved',4],['how much did i save',5],['am i saving',4],['percent saved',3],['kept',1]],
      reply: (q, d) => {
        const h = d.health;
        const verdict = h.savings_rate_pct >= 20 ? 'That is a healthy level. A common target is 20% or more.' : h.savings_rate_pct >= 10 ? 'That is decent. A common target is 20%, so there is room to push it.' : 'That is on the low side. A common target is 20%, so small cuts will help a lot.';
        return `You keep ${h.savings_rate_pct}% of what you earn (${fmt(h.net_savings)} out of ${fmt(h.total_income)}). ${verdict}`;
      }},
    { id:'monthly', label:'month-by-month figures', data:true,
      kw: [['month',3],['months',3],['monthly',3],['average',2],['avg',2],['per month',3],['each month',3],['every month',3],['best',1],['worst',1],['highest',1],['lowest',1],['most',1],['least',1],['trend',1],['increasing',2],['decreasing',2],['rising',2],['falling',2]],
      neg:['forecast','next','predict','emergency','sip','loan','emi','invest'], min: 3,
      reply: (q, d) => {
        const months = d.months || [], exp = d.expense_series || [], inc = d.income_series || [];
        if(!months.length) return "I need at least one month of data for that.";
        const avgE = exp.reduce((a, b) => a + b, 0) / months.length, avgI = inc.reduce((a, b) => a + b, 0) / months.length;
        const wantsIncome = anyOf(q, ['income','earn','earned','salary']);
        const wantsLow = anyOf(q, ['lowest','least','best','cheapest','smallest']);
        const series = wantsIncome ? inc : exp;
        const pick = pickMonth(series, months, wantsLow ? 'min' : 'max');
        const lines = [`- Average: ${fmt(avgI)} in and ${fmt(avgE)} out per month over ${months.length} month${months.length === 1 ? '' : 's'}.`];
        lines.push(`- ${wantsLow ? 'Lowest' : 'Highest'} ${wantsIncome ? 'income' : 'spending'} month: ${pick.name} at ${fmt(pick.value)}.`);
        if(exp.length >= 6){
          const recent = exp.slice(-3).reduce((a, b) => a + b, 0) / 3, before = exp.slice(-6, -3).reduce((a, b) => a + b, 0) / 3;
          if(before > 0){
            const ch = Math.round((recent - before) / before * 100);
            lines.push(Math.abs(ch) < 3 ? '- Spending over the last 3 months is about the same as the 3 before.' : `- Spending over the last 3 months is ${Math.abs(ch)}% ${ch > 0 ? 'higher' : 'lower'} than the 3 before.`);
          }
        }
        return lines.join('\n');
      }},
    { id:'payment', label:'how you pay', data:true,
      kw: [['upi',5],['card',4],['cash',5],['payment',4],['payments',4],['pay',2],['paid',2],['bank transfer',4],['mode',2],['debit card',3]], neg:['loan','emi','score','cibil','credit'], min: 4,
      reply: (q, d) => {
        const br = Object.entries(d.payment_breakdown || {}).sort((a, b) => b[1] - a[1]);
        if(!br.length) return "I can't see payment methods in these figures.";
        const total = br.reduce((a, [, v]) => a + v, 0) || 1;
        const asked = br.find(([m]) => q.tokens.some(t => t === m.toLowerCase() || (m === 'Bank Transfer' && t === 'transfer')));
        const list = br.slice(0, 4).map(([m, v]) => `- ${m}: ${Math.round(v / total * 100)}% (${fmt(v)})`).join('\n');
        return (asked ? `${asked[0]} makes up ${Math.round(asked[1] / total * 100)}% of your spending. ` : '') + `How your spending is paid:\n${list}`;
      }},
    { id:'location', label:'spending by city', data:true,
      kw: [['city',4],['cities',4],['location',3],['locations',3],['place',2],['town',3]], min: 3,
      reply: (q, d) => {
        const br = Object.entries(d.location_breakdown || {}).filter(([c]) => c !== 'Unknown').sort((a, b) => b[1] - a[1]);
        if(!br.length) return "None of these entries has a city, so I can't split money by place.";
        return `By city, the most activity is in:\n${br.slice(0, 3).map(([c, v]) => `- ${c}: ${fmt(v)}`).join('\n')}`;
      }},
    { id:'compare', label:'income versus spending', data:true,
      kw: [['income vs',4],['vs',2],['versus',3],['compare',3],['comparison',3],['surplus',3],['deficit',3],['shortfall',3],['overspend',3],['overspending',3],['live within',3],['break even',3],['in the red',3],['enough money',2]], min: 3,
      reply: (q, d) => {
        const h = d.health, diff = h.total_income - h.total_expense;
        if(diff >= 0) return `Yes, you live within your means: ${fmt(h.total_income)} in against ${fmt(h.total_expense)} out leaves a surplus of ${fmt(diff)}.`;
        return `Spending is higher than income: ${fmt(h.total_expense)} out against ${fmt(h.total_income)} in, a gap of ${fmt(-diff)}. The fastest fix is trimming your top category and checking the flagged transactions.`;
      }},
    { id:'invest', label:'investing', data:true,
      kw: [['invest',4],['investing',4],['investment',4],['mutual fund',4],['mutual funds',4],['stock',3],['stocks',3],['share market',4],['sip',4],['portfolio',3],['where to put',3],['grow my money',4],['index fund',4],['etf',3]], neg:['tax','80c','calculate','calculator','worth'], min: 4,
      reply: (q, d) => {
        const sr = d.health.savings_rate_pct, net = d.health.net_savings;
        if(sr < 10) return `Your savings rate is ${sr}% right now, so the first move isn't investing yet, it's building a cushion. Most planners suggest 3 to 6 months of expenses in something liquid (a savings account or liquid fund) before anything market-linked.`;
        if(sr < 20) return `At a ${sr}% savings rate you have room to start. A common path: top up the emergency fund, then a small recurring SIP into a diversified index fund so you aren't trying to time individual stocks. General education, not a personal recommendation. Compare options and read the fine print first.`;
        return `A ${sr}% savings rate (${fmt(net)} kept) gives you real room to diversify. People in your position often look at index funds for core growth, PPF or NPS for the tax-advantaged long-term part, and ELSS if 80C matters. Talk to a SEBI-registered adviser before allocating real money. I'm naming categories to research, not picks.`;
      }},
    { id:'save-more', label:'saving more', data:true,
      kw: [['save more',5],['saving more',5],['spend less',5],['reduce spending',5],['reduce expenses',5],['cut expenses',5],['cut costs',5],['cut back',4],['budget',3],['budgeting',3],['overspending',2],['save money',4],['saving tips',4],['tips',2],['economize',3],['frugal',3],['lower my',2]], min: 4,
      reply: (q, d) => {
        const br = Object.entries(d.category_breakdown || {}).sort((a, b) => b[1] - a[1]);
        if(!br.length) return "I don't see enough expense data yet to spot a pattern. Add a few transactions and ask again.";
        const total = d.health.total_expense || 1;
        const [cat, amt] = br[0];
        const second = br[1] ? ` Next is ${br[1][0]} at ${fmt(br[1][1])}.` : '';
        return `${cat} is your biggest expense at ${fmt(amt)} (${Math.round(amt / total * 100)}% of spend).${second} ${catTip(cat)} Trimming ${cat} by 10% would free about ${fmt(amt * 0.1)} and noticeably lift your savings rate.`;
      }},
    { id:'score', label:'health score', data:true,
      kw: [['score',5],['health score',5],['rating',3],['why low',3],['why is my',2],['improve',2],['financial health',4],['how am i doing',4],['how healthy',3],['grade',2],['weakest',3]], neg:['credit','cibil'], min: 4,
      reply: (q, d) => {
        const h = d.health;
        const subs = [['savings discipline', h.savings], ['spending stability', h.stability], ['staying anomaly-free', h.anomaly_free], ['category diversification', h.diversification]];
        subs.sort((a, b) => a[1] - b[1]);
        const weakest = subs[0], strongest = subs[subs.length - 1];
        let tip = '';
        if(weakest[0] === 'savings discipline') tip = 'Expenses are close to (or above) income. Even an extra 5% saved each month moves this a lot.';
        else if(weakest[0] === 'spending stability') tip = 'Your monthly spend swings a lot. A simple monthly budget per category smooths this out.';
        else if(weakest[0] === 'staying anomaly-free') tip = 'A chunk of transactions look unusual for their category. Check the anomaly feed.';
        else tip = 'Spend is concentrated in one or two categories. Not necessarily bad, just worth being deliberate about.';
        return `Your overall score is ${h.overall}/100. Strongest part: ${strongest[0]} (${strongest[1]}/100). Weakest: ${weakest[0]} (${weakest[1]}/100). ${tip}`;
      }},
    { id:'anomaly', label:'unusual transactions', data:true,
      kw: [['anomaly',5],['anomalies',5],['suspicious',4],['unusual',4],['fraud',4],['flagged',4],['strange',3],['weird',3],['odd',2],['outlier',4],['outliers',4],['wrong',2],['error',2],['mistake',2],['duplicate',2]], min: 4,
      reply: (q, d) => {
        const n = d.health.anomaly_count;
        if(!n) return "Good news: nothing in this view is flagged as unusual right now.";
        const ex = (d.anomalies || [])[0];
        let line = `${n} transaction${n === 1 ? ' is' : 's are'} flagged here. `;
        if(ex) line += `Most recent: ${ex.reason.toLowerCase()}, ${fmt(ex.amount)} in ${ex.category} on ${ex.date}. `;
        return line + 'Worth checking that these are real and not typos or duplicate charges.';
      }},
    { id:'forecast', label:'forecast', data:true,
      kw: [['forecast',5],['next month',5],['predict',4],['prediction',4],['projection',4],['future',2],['expect',2],['coming months',4],['next 3 months',4],['will i',2]], min: 4,
      reply: (q, d) => {
        const inc = d.income_forecast ? d.income_forecast : null, exp = d.expense_forecast ? d.expense_forecast : null;
        if(!inc || !exp || !inc.length) return "I need a bit more history before I can forecast anything useful.";
        const diff = inc[0] - exp[0];
        const three = inc.length >= 3 ? ` Over the next 3 months that is about ${fmt(inc.reduce((a, b) => a + b, 0))} in and ${fmt(exp.reduce((a, b) => a + b, 0))} out.` : '';
        return `Based on your recent trend, next month looks like roughly ${fmt(inc[0])} in and ${fmt(exp[0])} out, ${diff >= 0 ? `a projected surplus of ${fmt(diff)}` : `a projected shortfall of ${fmt(-diff)}, worth planning around`}.${three}`;
      }},
    { id:'emergency', label:'emergency fund', data:true,
      kw: [['emergency fund',6],['emergency',4],['rainy day',5],['cushion',4],['safety net',4],['job loss',3],['contingency',4]],
      reply: (q, d) => {
        const monthlyExp = (d.health.total_expense || 0) / Math.max(1, (d.months || []).length);
        return `A common rule of thumb is 6 months of expenses in an emergency fund. With average spending of about ${fmt(monthlyExp)} a month, that is around ${fmt(monthlyExp * 6)} (3 months would be ${fmt(monthlyExp * 3)}), kept somewhere easy to reach, not in anything volatile.`;
      }},

    /* ---- general money topics: no figures needed ---- */
    { id:'calc-growth', label:'investment growth calculator',
      score: (q) => {
        const n = parseNumbers(q.raw);
        return (n.amount && n.years && anyOf(q, ['sip','invest','invested','investing','grow','worth','become','return','returns','corpus','compound','fd','lumpsum','month','monthly','per month','a month','every month'])) && !anyOf(q, ['loan','emi','borrow','need','want','target','goal','reach','require','buy']) ? 20 : 0;
      },
      reply: (q) => {
        const n = parseNumbers(q.raw);
        const monthly = anyOf(q, ['sip','monthly','month','every','per']) && !anyOf(q, ['lumpsum','once','one time']);
        const rates = n.rate ? [n.rate] : [6, 10, 12];
        const put = monthly ? n.amount * 12 * n.years : n.amount;
        const rows = rates.map(r => `- At ${r}% a year: about ${fmt(growth(monthly ? n.amount : 0, monthly ? 0 : n.amount, n.years, r))}`).join('\n');
        return `${monthly ? fmt(n.amount) + ' a month' : fmt(n.amount) + ' one time'} for ${Math.round(n.years * 10) / 10} year${n.years === 1 ? '' : 's'} (you put in ${fmt(put)}):\n${rows}\nThese are illustrations with steady returns. Real markets move up and down and nothing is guaranteed.`;
      }},
    { id:'calc-emi', label:'loan EMI calculator',
      score: (q) => {
        const n = parseNumbers(q.raw);
        return (n.amount && n.years && anyOf(q, ['emi','loan','borrow','mortgage'])) ? 20 : 0;
      },
      reply: (q) => {
        const n = parseNumbers(q.raw), rate = n.rate || 9, i = rate / 1200, m = Math.round(n.years * 12);
        const emi = n.amount * i * Math.pow(1 + i, m) / (Math.pow(1 + i, m) - 1);
        return `A loan of ${fmt(n.amount)} over ${Math.round(n.years * 10) / 10} years at ${rate}%${n.rate ? '' : ' (assumed, tell me your rate to refine)'} comes to an EMI of about ${fmt(emi)} a month, ${fmt(emi * m)} in total, so ${fmt(emi * m - n.amount)} goes to interest. A common guide is to keep all EMIs under about 40% of monthly income.`;
      }},
    { id:'loan', label:'loans and debt',
      kw: [['loan',4],['loans',4],['emi',4],['debt',4],['debts',4],['borrow',3],['borrowing',3],['mortgage',4],['home loan',5],['personal loan',5],['car loan',5],['education loan',5],['prepay',4],['interest rate',3],['repay',3],['owe',2],['credit card debt',5]], min: 4,
      reply: (q, d) => {
        const inc = d && d.health ? d.health.total_income / Math.max(1, (d.months || []).length) : 0;
        const personal = inc ? ` With income of about ${fmt(inc)} a month, ${fmt(inc * 0.4)} is the usual ceiling for all EMIs together.` : '';
        return `For debt, the usual order is: clear anything above roughly 12 to 15% interest first (credit card balances and personal loans), keep paying the minimum on cheaper loans, and only then think about extra investing. Keep total EMIs under about 40% of monthly income.${personal} Tell me an amount, years and rate (for example "EMI for 10 lakh loan, 5 years, 9%") and I'll work out the EMI.`;
      }},
    { id:'insurance', label:'insurance',
      kw: [['insurance',5],['term plan',5],['term insurance',5],['health insurance',5],['mediclaim',5],['life cover',4],['premium',3],['policy',2],['lic',3],['cover',2]], min: 4,
      reply: () => "Two covers matter most. Term life insurance (pure protection, low cost) if anyone depends on your income; a common guide is 10 to 15 times annual income. Health insurance, ideally a family floater plus a top-up, since one hospital stay can undo years of saving. Mixing insurance with investment (endowment-type plans) usually gives weaker returns than buying a term plan and investing the difference. Premiums can also qualify for tax deductions under 80C and 80D." },
    { id:'retire', label:'retirement',
      kw: [['retire',5],['retirement',5],['pension',4],['nps',4],['old age',3],['ppf',3],['epf',4],['provident fund',4],['financial freedom',3],['fire',2]], neg:['tax'], min: 3,
      reply: () => "For retirement, time matters more than amount: starting early lets compounding do the work. Typical building blocks in India are EPF (if you're salaried), PPF (safe, long lock-in), NPS (low-cost, partly market-linked, extra 80CCD(1B) deduction) and equity index funds for growth. A rough target is 25 to 30 times your yearly spending by retirement. Ask \"if I invest 10000 a month for 25 years\" and I'll show what that could grow to." },
    { id:'budget-rule', label:'budgeting rules',
      kw: [['50/30/20',6],['50 30 20',6],['rule of thumb',3],['budget rule',5],['budgeting rule',5],['how to budget',5],['make a budget',5],['monthly budget',4],['zero based',4],['envelope',3],['needs wants',4],['wants',2]], min: 3,
      reply: (q, d) => {
        const inc = d && d.health ? d.health.total_income / Math.max(1, (d.months || []).length) : 0;
        const base = "The 50/30/20 rule splits take-home pay into 50% needs (rent, food, bills, EMIs), 30% wants (eating out, shopping, entertainment) and 20% savings and investing.";
        return inc ? `${base} On your average income of ${fmt(inc)} a month, that is ${fmt(inc * 0.5)} for needs, ${fmt(inc * 0.3)} for wants and ${fmt(inc * 0.2)} to save. In India, where rent can be a big share, 60/20/20 is a realistic starting point.` : base + " In India, where rent can be a big share, 60/20/20 is a realistic starting point.";
      }},
    { id:'credit', label:'credit cards and credit score',
      kw: [['credit score',6],['cibil',6],['credit card',5],['credit cards',5],['credit limit',4],['credit utilisation',4],['credit utilization',4],['credit',2],['experian',3]], neg:['loan','emi','debt'], min: 4,
      reply: () => "Your credit (CIBIL) score runs from 300 to 900, and 750 or more is generally treated as good. What moves it most: paying every bill on time, using under about 30% of your card limit, not applying for many loans or cards in a short time, and keeping old accounts open. Pay the full card bill each month; the interest on revolving balances is often 36% or more a year." },
    { id:'tax', label:'tax saving',
      kw: [['tax',5],['taxes',5],['80c',5],['80d',5],['itr',4],['income tax',5],['tax saving',5],['elss',4],['deduction',4],['deductions',4],['old regime',4],['new regime',4],['hra',3]], min: 4,
      reply: () => "General pointers people in India look into: Section 80C (PPF, ELSS, EPF, life insurance premiums, home loan principal, up to ₹1.5L), 80D for health insurance premiums, and NPS under 80CCD(1B) for an extra ₹50K. These apply under the old tax regime; the new regime has lower slab rates but fewer deductions, so it's worth comparing both. This isn't tax advice for your situation. A CA can tell you what applies." },
    { id:'instruments', label:'FD, gold, crypto and property',
      kw: [['fixed deposit',5],['fd',4],['recurring deposit',5],['rd',2],['gold',4],['crypto',4],['bitcoin',4],['real estate',4],['property',3],['land',2],['bonds',3],['liquid fund',4],['debt fund',4],['savings account',3],['sgb',3],['safe',2],['risky',2],['risk',2]], neg:['tax','80c'], min: 3,
      reply: () => "Quick trade-offs in plain terms: Fixed deposits and RDs are safe and predictable but often barely beat inflation after tax. Liquid and debt funds suit parking money you may need within 1 to 3 years. Equity index funds have the best long-run growth but can drop 30% or more in bad years, so they suit money you won't touch for 5+ years. Gold works as a small hedge (5 to 10% of savings is a common range). Crypto is very volatile and lightly regulated, so only money you can afford to lose. Real estate is illiquid and needs a large lump sum. Check with a SEBI-registered adviser before committing." },
    { id:'inflation', label:'inflation',
      kw: [['inflation',6],['purchasing power',5],['prices rising',4],['cost of living',4]],
      reply: () => "Inflation in India has typically run around 4 to 6% a year, so ₹1,00,000 today buys noticeably less in 10 years. Money left in a plain savings account (about 3 to 4%) loses value in real terms, which is why long-term goals usually need some growth assets, not just deposits." },
    { id:'goal', label:'saving for a goal',
      score: (q) => {
        const n = parseNumbers(q.raw);
        if(n.amount && n.years && anyOf(q, ['need','want','target','goal','reach','require','buy','afford','accumulate','build','wedding','house','car','vacation','down payment']) && !anyOf(q, ['loan','emi','borrow'])) return 20;
        let sc = 0;
        [['goal',4],['goals',4],['wedding',4],['house',3],['buy a car',4],['vacation',3],['holiday',3],['trip fund',4],['down payment',5],['marriage',4],['education fund',4],['child',3],['children',3]].forEach(([k, w]) => { if(has(q, k)) sc += w; });
        return sc >= 3 && !anyOf(q, ['loan','emi']) ? sc : 0;
      },
      kw: [['goal',4],['goals',4],['wedding',4],['house',3],['home',2],['buy a car',4],['car',2],['vacation',3],['holiday',3],['trip fund',4],['down payment',5],['child',3],['children',3],['education fund',4],['marriage',4],['gadget',2],['phone',1]], neg:['loan','emi'], min: 3,
      reply: (q, d) => {
        const n = parseNumbers(q.raw);
        if(n.amount && n.years){
          const need = n.amount / (n.years * 12);
          const sip = (r) => { const i = r / 1200, m = n.years * 12; return n.amount / (((Math.pow(1 + i, m) - 1) / i) * (1 + i)); };
          return `To reach ${fmt(n.amount)} in ${Math.round(n.years * 10) / 10} year${n.years === 1 ? '' : 's'}: about ${fmt(need)} a month with no growth, or about ${fmt(sip(7))} a month if it earns 7% (a debt fund or FD), or about ${fmt(sip(12))} a month at 12% (equity, only sensible for 5+ years).`;
        }
        return "For any goal, work backwards: amount needed, years left, then the monthly amount. Money needed within 3 years belongs in safe places (FD, liquid or debt funds); 5+ years can take some equity. Tell me, for example, \"I need 8 lakh in 4 years\" and I'll work out the monthly figure.";
      }},
    { id:'greet', label:'hello',
      kw: [['hi',4],['hello',4],['hey',4],['namaste',4],['good morning',4],['good evening',4],['sup',3]], max: 3,
      reply: (q, d) => introLine(d, !d) },
    { id:'thanks', label:'thanks',
      kw: [['thanks',5],['thank you',5],['thx',4],['great',2],['awesome',2],['nice',2],['helpful',3]],
      reply: () => "You're welcome! Ask me anything else about your money." },
    { id:'help', label:'what I can do',
      kw: [['help',4],['what can you',6],['what do you',5],['who are you',5],['what can i ask',6],['what can you answer',6],['capabilities',4],['topics',3],['commands',3],['options',2],['how do i use',4],['upload',3],['import',3],['pdf',3],['csv',3],['statement',3],['files',2],['attach',3]], min: 3,
      reply: () => "I answer from the figures on your dashboard and from general money knowledge. Try:\n- Your numbers: \"how much did I spend on food\", \"total income\", \"which month cost most\", \"how much by UPI\", \"savings rate\"\n- Insight: \"why is my score low\", \"anything unusual\", \"forecast next month\", \"emergency fund\"\n- Money topics: investing, SIP, loans and EMI, insurance, retirement, tax saving, credit score, inflation, FD, gold\n- Calculators: \"5000 a month for 10 years\", \"EMI for 10 lakh, 5 years, 9%\", \"I need 8 lakh in 4 years\"\nTo add data, tap the paperclip below or use Add money, and pick several PDFs and CSVs at once." },
  ];

  function scoreTopic(t, q, d){
    if(t.score) return t.score(q, d);
    let s = 0;
    (t.kw || []).forEach(([k, w]) => { if(has(q, k)) s += w; });
    if(s && t.neg && anyOf(q, t.neg)) s -= 4;
    if(t.id === 'totals' && categoriesIn(q, d).length) return 0;     // "spend on food" is about food, not totals
    if(t.max && q.tokens.length > t.max + 2 && s < 6) return 0;      // "hi" only counts in short messages
    return s >= (t.min || 3) ? s : 0;
  }

  const FALLBACKS = [
    "I didn't quite catch that. I can talk about your spending by category, income and savings, your score, forecasts, investing, loans, insurance, tax and more. Try one of the suggestions below, or ask \"what can you answer?\".",
  ];

  // returns { text, topics:[label...] }
  function generateAnswer(text, dataset){
    const raw = String(text || '');
    const q = { raw, text: norm(raw), tokens: words(raw).filter(w => !STOP.has(w)) };
    const scored = TOPICS.map(t => ({ t, s: scoreTopic(t, q, dataset) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    if(!scored.length){
      return { text: FALLBACKS[0], topics: [] };
    }
    const picks = [scored[0]];
    if(scored[1] && scored[1].s >= Math.max(5, scored[0].s * 0.7)) picks.push(scored[1]);
    const parts = [], used = [];
    picks.forEach(({ t }) => {
      if(t.data && !dataset){ parts.push(NEEDS_DATA); }
      else parts.push(t.reply(q, dataset));
      used.push(t.label);
    });
    return { text: parts.filter((p, i, a) => a.indexOf(p) === i).join('\n\n'), topics: used };
  }
  function generateReply(text, dataset){ return generateAnswer(text, dataset).text; }

  // ---------------- UI wiring ----------------
  let opened = false;

  function init(){
    const AI = window.FinTwinAI;
    const $ = (id) => document.getElementById(id);
    const fab = $('chatFab'), panel = $('chatPanel'), body = $('chatBody');
    const input = $('chatInput'), form = $('chatForm');
    const settingsEl = $('aiSettings');
    const history = [];                       // conversation sent to the AI
    let busy = false;

    function badge(){
      if(!AI) return;
      const st = AI.settings();
      $('chatMode').textContent = AI.isActive() ? 'AI answers · ' + AI.modelLabel(st.model) : 'Rules-based answers';
      $('chatMode').classList.toggle('is-ai', AI.isActive());
      $('aiEnable').checked = st.enabled;
      $('aiModel').value = st.model;
      $('aiRemember').checked = st.remembered;
      $('aiKey').value = '';
      $('aiKey').placeholder = st.hasKey ? 'Key saved. Paste a new one to replace it' : 'sk-ant-...';
      $('aiRemoveKey').classList.toggle('hidden', !st.hasKey);
      $('aiStatus').textContent = !st.hasKey ? 'Add an API key to turn on AI answers. Until then the built-in rules answer.'
        : st.enabled ? 'AI answers are on.' : 'AI answers are off. The built-in rules answer.';
    }
    function refreshShared(){ $('aiShared').textContent = AI ? AI.sharedPreview(window.FinTwinActive) : ''; }

    // plain text -> paragraphs and bullet lists, built with DOM calls so nothing is parsed as HTML
    function renderRich(el, text){
      const lines = String(text).split(/\r?\n/);
      let list = null;
      lines.forEach(raw => {
        const line = raw.trim();
        if(!line){ list = null; return; }
        const m = line.match(/^(?:[-*•])\s+(.*)$/);
        if(m){
          if(!list){ list = document.createElement('ul'); el.appendChild(list); }
          const li = document.createElement('li'); li.textContent = m[1]; list.appendChild(li);
        } else {
          list = null;
          const p = document.createElement('p'); p.textContent = line.replace(/\*\*(.+?)\*\*/g, '$1'); el.appendChild(p);
        }
      });
    }
    function addMsg(text, who, meta){
      const el = document.createElement('div');
      el.className = 'msg ' + who;
      if(who === 'bot') renderRich(el, text); else el.textContent = text;
      if(meta){ const m = document.createElement('div'); m.className = 'msg-meta'; m.textContent = meta; el.appendChild(m); }
      body.appendChild(el);
      body.scrollTop = body.scrollHeight;
      return el;
    }

    async function send(text){
      text = (text || '').trim();
      if(!text || busy) return;
      addMsg(text, 'user');
      input.value = '';
      const active = window.FinTwinActive || {};

      if(AI && AI.isActive()){
        busy = true; form.classList.add('is-busy');
        const typing = addMsg('Thinking', 'bot typing');
        history.push({ role:'user', content:text });
        const res = await AI.ask(history, active);
        typing.remove(); busy = false; form.classList.remove('is-busy');
        if(res.ok){
          history.push({ role:'assistant', content:res.text });
          addMsg(res.text, 'bot', 'AI · ' + AI.modelLabel(res.model) + ' · answered from the figures on your dashboard');
        } else {
          history.pop();
          const ans = generateAnswer(text, active.dataset);
          addMsg(ans.text, 'bot', 'Rules-based answer. AI was unavailable: ' + res.message);
        }
        return;
      }
      const ans = generateAnswer(text, active.dataset);
      setTimeout(() => addMsg(ans.text, 'bot', ans.topics.length ? 'Rules-based answer · matched: ' + ans.topics.join(', ') : 'Rules-based answer'), 200);
    }

    function setOpen(on){
      opened = on;
      panel.classList.toggle('open', on);
      fab.setAttribute('aria-expanded', String(on));
      if(on && !body.dataset.greeted){
        body.dataset.greeted = '1';
        const active = window.FinTwinActive || {};
        addMsg(introLine(active.dataset, !active.dataset), 'bot');
      }
      if(on) setTimeout(() => input.focus(), 60);
    }

    fab.addEventListener('click', () => setOpen(!opened));
    $('chatClose').addEventListener('click', () => setOpen(false));
    panel.addEventListener('keydown', (e) => { if(e.key === 'Escape') setOpen(false); });
    form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
    // paperclip: several PDFs / CSVs at once go through the same review table as Add money
    $('chatAttach').addEventListener('click', () => $('chatFile').click());
    $('chatFile').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if(!files.length || !window.FinTwinImport) return;
      addMsg('Attached ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ': ' + files.map(f => f.name).join(', '), 'user');
      addMsg('Reading ' + (files.length === 1 ? 'it' : 'them') + ' now. A review window will open so you can check every row before anything is saved. Once added, ask me about the numbers.', 'bot');
      window.FinTwinImport.open(files);
    });
    document.querySelectorAll('#chatChips .chip').forEach(chip => chip.addEventListener('click', () => send(chip.textContent)));
    document.querySelectorAll('[data-open-chat]').forEach(b => b.addEventListener('click', () => {
      setOpen(true);
      if(b.getAttribute('data-ask')) send(b.getAttribute('data-ask'));
    }));

    if(AI){
      $('aiModel').innerHTML = AI.MODELS.map(m => `<option value="${m.id}">${m.label} (${m.note})</option>`).join('');
      $('chatSettingsBtn').addEventListener('click', () => {
        const hide = !settingsEl.classList.contains('hidden');
        settingsEl.classList.toggle('hidden', hide);
        $('chatSettingsBtn').setAttribute('aria-expanded', String(!hide));
        if(!hide){ badge(); refreshShared(); }
      });
      $('aiEnable').addEventListener('change', () => { AI.setPrefs({ enabled: $('aiEnable').checked }); badge(); });
      $('aiModel').addEventListener('change', () => { AI.setPrefs({ model: $('aiModel').value }); badge(); });
      $('aiSaveKey').addEventListener('click', () => {
        const key = $('aiKey').value.trim();
        if(!key){ $('aiStatus').textContent = 'Paste your API key first.'; return; }
        if(!/^sk-ant-/.test(key)){ $('aiStatus').textContent = 'That does not look like an Anthropic key (it should start with sk-ant-).'; return; }
        AI.saveKey(key, $('aiRemember').checked);
        AI.setPrefs({ enabled: true });
        badge();
        $('aiStatus').textContent = 'Key saved. AI answers are on.';
      });
      $('aiRemoveKey').addEventListener('click', () => { AI.saveKey('', false); history.length = 0; badge(); });
      badge();
    } else {
      $('chatSettingsBtn').classList.add('hidden');
    }
  }

  return { init, generateReply, generateAnswer };
})();
