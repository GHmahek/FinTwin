/* ============================================================
   FinTwin Statement reader
   Turns a bank/card statement (PDF or CSV/pasted text) into a list of
   transactions for the user to review before anything is saved.
   Everything runs in the browser; the file is never uploaded.

   Row shape: { date:'YYYY-MM-DD', type:'Income'|'Expense', category, amount (>0),
                payment_mode, notes }
   Errors carry a .code: PDF_LIB_MISSING, PASSWORD, WRONG_PASSWORD, SCANNED, NO_ROWS, READ_FAILED
   ============================================================ */
window.FinTwinStatement = (function(){
  const Ledger = window.FinTwinLedger;
  const pad = n => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
  const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };

  function fail(code, message){ const e = new Error(message); e.code = code; return e; }

  /* ---------------- category + payment guesses ---------------- */
  const kw = (words) => new RegExp('(?:^|[^a-z])(?:' + words + ')(?:[^a-z]|$)', 'i');
  const INCOME_RULES = [
    ['Salary',    kw('salary|sal cr|payroll|stipend|wages')],
    ['Freelance', kw('freelance|consulting|invoice|professional fee')],
    ['Bonus',     kw('bonus|incentive|commission')],
    ['Other',     kw('interest|refund|cashback|dividend|reversal|credited|received|reward')],
  ];
  const EXPENSE_RULES = [
    ['Rent',          kw('rent|landlord|nobroker|housing society|society maintenance|pg rent')],
    ['Investment',    kw('sip|mutual fund|zerodha|groww|upstox|kuvera|nps|ppf|elss|demat|stocks?|lic premium|coin by zerodha')],
    ['Savings',       kw('fixed deposit|fd booking|recurring deposit|rd installment|savings goal')],
    ['Food',          kw('swiggy|zomato|restaurant|cafe|coffee|starbucks|dominos|pizza|mcdonald|kfc|burger|bakery|dining|eatery|food|blinkit|bigbasket|zepto|grocer\\w*|supermarket|dmart|instamart')],
    ['Travel',        kw('uber|ola|rapido|irctc|redbus|makemytrip|goibibo|indigo|air india|vistara|akasa|flight|metro|petrol|diesel|fuel|hpcl|bpcl|iocl|fastag|cab|railway|travel')],
    ['Utilities',     kw('electricity|bescom|msedcl|tneb|power bill|water bill|gas bill|piped gas|broadband|airtel|jio|vodafone|vi prepaid|bsnl|recharge|dth|tata play|postpaid|prepaid|wifi|bill ?pay|utility')],
    ['Entertainment', kw('netflix|spotify|prime video|hotstar|disney|bookmyshow|pvr|inox|youtube|gaming|steam|movie|cinema|subscription')],
    ['Shopping',      kw('amazon|flipkart|myntra|ajio|nykaa|meesho|mall|shopping|lifestyle|zara|decathlon|croma|reliance digital|retail')],
    ['Health',        kw('pharmacy|apollo|medplus|netmeds|1mg|hospital|clinic|diagnostic|pathology|doctor|medical|practo|dental|insurance')],
    ['Education',     kw('school|college|university|tuition|udemy|coursera|byju\\w*|unacademy|exam fee|course|books?|library')],
  ];
  function inferCategory(text, type){
    const t = String(text || '');
    const rules = type === 'Income' ? INCOME_RULES : EXPENSE_RULES;
    for(const [cat, re] of rules){ if(re.test(t)) return cat; }
    return 'Other';
  }
  function inferPayment(text){
    const t = String(text || '');
    if(/\bupi\b/i.test(t)) return 'UPI';
    if(/\b(neft|rtgs|imps|nach|ach|ecs|transfer|trf)\b/i.test(t)) return 'Bank Transfer';
    if(/\b(pos|card|debit card|credit card|visa|mastercard|rupay)\b/i.test(t)) return 'Card';
    if(/\b(atm|cash|cwd)\b/i.test(t)) return 'Cash';
    return 'Unknown';
  }

  /* ---------------- dates ---------------- */
  const DATE_PATTERNS = [
    { re:/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?!\d)/, kind:'ymd' },
    { re:/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?!\d)/, kind:'dmy4' },
    { re:/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2})(?!\d)/, kind:'dmy2' },
    { re:/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s,.\-]+(\d{4}|\d{2})(?!\d)/, kind:'dMy' },
    { re:/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)/, kind:'Mdy' },
  ];
  function validYMD(y, m, d){ return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31; }
  // order: 'dm' (day first, the Indian default) or 'md'
  function dateAt(str, order){
    for(const p of DATE_PATTERNS){
      const m = str.match(p.re);
      if(!m) continue;
      let y, mo, d;
      if(p.kind === 'ymd'){ y = +m[1]; mo = +m[2]; d = +m[3]; }
      else if(p.kind === 'dmy4' || p.kind === 'dmy2'){
        const a = +m[1], b = +m[2]; y = +m[3]; if(p.kind === 'dmy2') y += 2000;
        if(order === 'md'){ mo = a; d = b; } else { d = a; mo = b; }
      }
      else if(p.kind === 'dMy'){ d = +m[1]; mo = MONTHS[m[2].slice(0,4).toLowerCase()] || MONTHS[m[2].slice(0,3).toLowerCase()]; y = +m[3]; if(y < 100) y += 2000; }
      else { mo = MONTHS[m[1].slice(0,4).toLowerCase()] || MONTHS[m[1].slice(0,3).toLowerCase()]; d = +m[2]; y = +m[3]; }
      if(!mo || !validYMD(y, mo, d)) continue;
      return { iso: isoOf(y, mo, d), len: m[0].length };
    }
    return null;
  }
  // Look at every numeric d/m/y date: a first part above 12 means day-first, a second part above 12 means month-first.
  function detectOrder(lines){
    let dayFirst = 0, monthFirst = 0;
    lines.forEach(l => {
      const m = l.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})(?!\d)/);
      if(!m) return;
      if(+m[1] > 12) dayFirst++;
      if(+m[2] > 12) monthFirst++;
    });
    return monthFirst > dayFirst ? 'md' : 'dm';
  }

  /* ---------------- money tokens ---------------- */
  // Amounts in statements have two decimals (1,234.50). Requiring that keeps
  // reference numbers, account numbers and dates from being read as money.
  const MONEY = /(?<![\d.,\/])(?:(?:₹|Rs\.?|INR)\s*)?(-?)\s?((?:\d{1,3}(?:,\d{2,3})+|\d+))\.(\d{2})(?!\d|\.\d)(?:\s?(Dr|Cr|DR|CR)\b\.?)?/g;
  function moneyTokens(str){
    const out = [];
    let m;
    MONEY.lastIndex = 0;
    while((m = MONEY.exec(str)) !== null){
      out.push({
        value: parseFloat(m[2].replace(/,/g, '') + '.' + m[3]),
        neg: m[1] === '-',
        tag: m[4] ? (m[4].toLowerCase() === 'dr' ? 'Dr' : 'Cr') : null,
        start: m.index, end: m.index + m[0].length,
      });
    }
    return out;
  }
  const signed = t => (t.neg || t.tag === 'Dr') ? -t.value : t.value;

  const SKIP_ROW = /opening balance|closing balance|balance (?:b\/f|c\/f|brought|carried)|brought forward|carried forward|total (?:debit|credit|amount)|statement summary|payment received|thank you for (?:your )?payment/i;
  const NOISE_LINE = /^(?:page \d+|date\b|txn date|value date|sl\.? ?no|particulars|narration|description|statement of|account (?:no|number|statement)|customer|ifsc|branch|generated on|this is a computer)/i;

  /* ---------------- text lines -> transactions ---------------- */
  // lines: strings, or { text, y, page } objects (PDF lines keep their position so wrapped
  // narration can be attached to the nearest transaction instead of just the previous one)
  function linesToRows(lines){
    const L = lines.map(l => typeof l === 'string' ? { text: l, y: null, page: 0 } : l)
                   .map(l => ({ text: String(l.text).replace(/\s+/g, ' ').trim(), y: l.y, page: l.page }))
                   .filter(l => l.text);
    const order = detectOrder(L.map(l => l.text));
    const rows = [];          // each row also remembers where it sat: row._y, row._page, row._i
    const fragments = [];     // narration lines with no date or amount
    let prevBal = null;
    let skipped = 0;

    L.forEach((l, i) => {
      const line = l.text;

      // opening balance gives the first row something to compare against
      if(/opening balance|balance b\/f|brought forward/i.test(line)){
        const toks = moneyTokens(line);
        if(toks.length) prevBal = signed(toks[toks.length - 1]);
        return;
      }

      const d1 = dateAt(line, order);
      if(!d1){
        if(!NOISE_LINE.test(line) && !moneyTokens(line).length && line.length < 90) fragments.push({ text: line, y: l.y, page: l.page, i });
        return;
      }

      let rest = line.slice(d1.len).trim();
      const d2 = dateAt(rest, order);          // value date next to the transaction date
      if(d2) rest = rest.slice(d2.len).trim();

      const toks = moneyTokens(rest);
      if(!toks.length) return;

      let desc = rest;
      for(let k = toks.length - 1; k >= 0; k--) desc = desc.slice(0, toks[k].start) + ' ' + desc.slice(toks[k].end);
      desc = desc.replace(/\s+/g, ' ').trim();
      if(SKIP_ROW.test(desc)) return;

      let amt = null, bal = null, dir = null;
      if(toks.length >= 3){
        bal = toks[toks.length - 1];
        const w = toks[toks.length - 3], c = toks[toks.length - 2];   // withdrawal, deposit, balance
        if(w.value > 0 && c.value === 0){ amt = w; dir = 'Expense'; }
        else if(c.value > 0 && w.value === 0){ amt = c; dir = 'Income'; }
        else amt = toks[0];
      } else if(toks.length === 2){ amt = toks[0]; bal = toks[1]; }
      else amt = toks[0];

      if(!amt || amt.value === 0){ skipped++; return; }

      // 1) the running balance is the strongest evidence
      let fromBalance = null;
      if(bal && prevBal !== null){
        const delta = signed(bal) - prevBal;
        if(Math.abs(Math.abs(delta) - amt.value) < 0.02) fromBalance = delta < 0 ? 'Expense' : 'Income';
      }
      if(fromBalance) dir = fromBalance;
      // 2) explicit Dr / Cr or a minus sign
      else if(!dir && amt.tag) dir = amt.tag === 'Dr' ? 'Expense' : 'Income';
      else if(!dir && amt.neg) dir = 'Expense';
      // 3) words in the narration (decided again below once wrapped text is attached)
      const undecided = !dir;
      if(undecided) dir = INCOME_RULES.some(([, re]) => re.test(desc)) ? 'Income' : 'Expense';

      if(bal) prevBal = signed(bal);

      rows.push({
        date: d1.iso, type: dir, amount: amt.value, notes: desc,
        _before: '', _after: '', _undecided: undecided, _y: l.y, _page: l.page, _i: i,
      });
    });

    // attach each wrapped fragment to the closest transaction on the same page
    fragments.forEach(f => {
      let prev = null, next = null;
      for(const r of rows){ if(r._i < f.i) prev = r; else if(r._i > f.i && !next) next = r; }
      const usable = r => r && r._page === f.page;
      let target = null, above = false;
      if(usable(prev) && usable(next) && f.y !== null && prev._y !== null && next._y !== null){
        const dPrev = Math.abs(prev._y - f.y), dNext = Math.abs(next._y - f.y);
        if(dNext < dPrev){ target = next; above = true; } else target = prev;
      } else if(usable(prev)) target = prev;
      else if(usable(next)){ target = next; above = true; }
      if(!target) return;
      if(above) target._before = (f.text + ' ' + target._before).trim();
      else target._after = (target._after + ' ' + f.text).trim();
    });

    rows.forEach(r => {
      const full = [r._before, r.notes, r._after].filter(Boolean).join(' ')
        .replace(/\b[A-Za-z]{0,3}\d{4,}\b/g, ' ')          // reference / cheque numbers
        .replace(/\s+/g, ' ').trim();
      r.notes = full.slice(0, 100);
      if(r._undecided){
        r.type = INCOME_RULES.some(([, re]) => re.test(full)) ? 'Income' : 'Expense';
      }
      r.category = inferCategory(full, r.type);
      r.payment_mode = inferPayment(full);
      delete r._before; delete r._after; delete r._undecided; delete r._y; delete r._page; delete r._i;
    });
    return { rows, order, skipped };
  }

  /* ---------------- PDF ---------------- */
  let pdfLoading = null;
  function ensurePdfJs(){
    if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if(pdfLoading) return pdfLoading;
    pdfLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'assets/vendor/pdf.min.js';
      s.onload = () => window.pdfjsLib ? resolve(window.pdfjsLib) : reject(fail('PDF_LIB_MISSING', 'PDF reader did not start.'));
      s.onerror = () => { pdfLoading = null; reject(fail('PDF_LIB_MISSING', 'The PDF reader file (assets/vendor/pdf.min.js) was not found.')); };
      document.head.appendChild(s);
    });
    return pdfLoading;
  }

  async function pdfToLines(buffer, password){
    const lib = await ensurePdfJs();
    lib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdf.worker.min.js';
    let pdf;
    try{
      pdf = await lib.getDocument({ data: buffer, password: password || undefined, isEvalSupported: false }).promise;
    }catch(err){
      if(err && err.name === 'PasswordException'){
        throw fail(err.code === 2 ? 'WRONG_PASSWORD' : 'PASSWORD', 'This PDF is password protected.');
      }
      throw fail('READ_FAILED', 'This file could not be read as a PDF.');
    }
    const lines = [];
    let chars = 0;
    for(let p = 1; p <= pdf.numPages; p++){
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items
        .filter(it => typeof it.str === 'string')
        .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }));
      chars += items.reduce((a, i) => a + i.s.trim().length, 0);
      items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
      const bands = [];
      items.forEach(it => {
        const band = bands[bands.length - 1];
        if(band && Math.abs(band.y - it.y) <= 3) band.items.push(it);
        else bands.push({ y: it.y, items: [it] });
      });
      bands.forEach(b => {
        b.items.sort((a, c) => a.x - c.x);
        let text = '', prevEnd = null;
        b.items.forEach(it => {
          if(prevEnd !== null && it.x - prevEnd > 1.5 && !/\s$/.test(text) && !/^\s/.test(it.s)) text += ' ';
          text += it.s;
          prevEnd = it.x + it.w;
        });
        text = text.replace(/\s+/g, ' ').trim();
        if(text) lines.push({ text, y: b.y, page: p });
      });
    }
    if(chars < 30) throw fail('SCANNED', 'This PDF has no readable text (it looks like a scan).');
    return lines;
  }

  /* ---------------- CSV / pasted text ---------------- */
  function parseCsvText(text){
    const raw = Ledger.parseText(text);
    const rows = [];
    let skipped = 0;
    raw.forEach(r => {
      const d = Ledger.cleanDate(r.date);
      const a = Ledger.cleanAmount(r.amount);
      if(!d || isNaN(a) || a === 0){ skipped++; return; }
      const type = r.type;
      const notes = (r.notes || '').trim();
      rows.push({
        date: isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()),
        type,
        category: r.category ? Ledger.cleanCategory(r.category) : inferCategory(notes, type),
        amount: Math.abs(a),
        payment_mode: r.payment_mode ? Ledger.cleanPayment(r.payment_mode) : inferPayment(notes),
        notes: notes.slice(0, 100),
      });
    });
    return { rows, skipped, order: null };
  }

  /* ---------------- public ---------------- */
  // Mark rows already present in the ledger so they are not imported twice.
  function markDuplicates(rows){
    const key = (date, type, amount) => date + '|' + type + '|' + Math.round(amount * 100);
    const have = new Set();
    Ledger.load().forEach(t => {
      const d = Ledger.cleanDate(t.date);
      if(!d) return;
      have.add(key(isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate()), t.transaction_type, t.amount));
    });
    rows.forEach(r => { r.duplicate = have.has(key(r.date, r.type, r.amount)); r.include = !r.duplicate; });
    return rows;
  }

  // When several files are imported together, a row that already appeared in an
  // EARLIER file (same date, type and amount) is flagged: overlapping statements are common.
  // Identical rows inside one file are left alone, because they can be genuine.
  function markBatchDuplicates(rows){
    const key = r => r.date + '|' + r.type + '|' + Math.round(r.amount * 100);
    const firstFile = new Map();
    rows.forEach(r => {
      const k = key(r);
      if(!firstFile.has(k)) firstFile.set(k, r.file);
      else if(firstFile.get(k) !== r.file && !r.duplicate){
        r.duplicate = true; r.include = false; r.dupLabel = 'also in ' + firstFile.get(k);
      }
    });
    return rows;
  }

  async function parseFile(file, password){
    const name = (file.name || '').toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    let result;
    if(isPdf){
      let buffer;
      try{ buffer = await file.arrayBuffer(); }catch(e){ throw fail('READ_FAILED', 'The file could not be read.'); }
      const lines = await pdfToLines(buffer, password);
      result = linesToRows(lines);
      result.source = 'pdf';
    } else {
      let text;
      try{ text = await file.text(); }catch(e){ throw fail('READ_FAILED', 'The file could not be read.'); }
      result = parseCsvText(text);
      result.source = 'csv';
    }
    if(!result.rows.length) throw fail('NO_ROWS', 'No transactions were found in this file.');
    markDuplicates(result.rows);
    return result;
  }
  function parseText(text){
    const result = parseCsvText(text);
    result.source = 'text';
    if(!result.rows.length) throw fail('NO_ROWS', 'No transactions were found in the pasted text.');
    markDuplicates(result.rows);
    return result;
  }

  return { parseFile, parseText, markBatchDuplicates, linesToRows, inferCategory, inferPayment };
})();
