import pandas as pd, numpy as np, json, sys, os

# Usage: python analyze.py [path/to/raw.csv]
# (run clean.py first — this script loads its cleaned.pkl output)
HERE = os.path.dirname(os.path.abspath(__file__))
RAW_CSV = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'data', 'budgetwise_finance_dataset.csv')
CLEANED_PKL = os.path.join(HERE, 'cleaned.pkl')
OUT_JSON = os.path.join(HERE, 'dashboard_data.json')
OUT_JS = os.path.join(HERE, '..', 'assets', 'data.js')

df = pd.read_pickle(CLEANED_PKL)

# Keep only rows with valid date & amount & category & type for analysis
work = df.dropna(subset=['date_clean','amount_clean','transaction_type']).copy()
raw_count = len(df)
usable_count = len(work)
print("raw", raw_count, "usable", usable_count, "dropped", raw_count-usable_count)

work['month'] = work['date_clean'].dt.to_period('M').astype(str)
work['category_clean'] = work['category_clean'].fillna('Other')
work['payment_mode_clean'] = work['payment_mode_clean'].fillna('Unknown')
work['location_clean'] = work['location_clean'].fillna('Unknown')

# ---------------- Anomaly detection (IQR on expenses per category) ----------------
exp = work[work.transaction_type=='Expense'].copy()
inc = work[work.transaction_type=='Income'].copy()

anomaly_flags = pd.Series(False, index=work.index)
anomaly_reason = pd.Series('', index=work.index)

for cat, grp in exp.groupby('category_clean'):
    q1, q3 = grp.amount_clean.quantile([0.25,0.75])
    iqr = q3-q1
    hi = q3 + 1.5*iqr
    idx_hi = grp[grp.amount_clean > hi].index
    anomaly_flags.loc[idx_hi] = True
    anomaly_reason.loc[idx_hi] = 'Unusually high ' + cat.lower() + ' spend'

neg_idx = work[work.amount_clean < 0].index
anomaly_flags.loc[neg_idx] = True
anomaly_reason.loc[neg_idx] = 'Negative amount (data error)'

extreme_idx = work[work.amount_clean > 200000].index
anomaly_flags.loc[extreme_idx] = True
anomaly_reason.loc[extreme_idx] = 'Extreme outlier amount'

work['is_anomaly'] = anomaly_flags
work['anomaly_reason'] = anomaly_reason

print("total anomalies:", work.is_anomaly.sum())

# ---------------- helper: build summary for a subset ----------------
def month_range_labels(start='2021-01', end='2024-12'):
    return [p.strftime('%Y-%m') for p in pd.period_range(start, end, freq='M')]

ALL_MONTHS = month_range_labels()

def monthly_series(d):
    inc_m = d[d.transaction_type=='Income'].groupby('month').amount_clean.sum()
    exp_m = d[d.transaction_type=='Expense'].groupby('month').amount_clean.sum()
    inc_series = [round(float(inc_m.get(m,0)),2) for m in ALL_MONTHS]
    exp_series = [round(float(exp_m.get(m,0)),2) for m in ALL_MONTHS]
    return inc_series, exp_series

def forecast_next(series, n=3):
    # linear regression on last up-to-12 nonzero-trailing months
    y = np.array(series, dtype=float)
    nz = np.nonzero(y)[0]
    if len(nz) < 3:
        return [round(float(np.mean(y[y>0])) if (y>0).any() else 0,2)]*n
    start = max(0, nz[-1]-11)
    y_fit = y[start:nz[-1]+1]
    x_fit = np.arange(len(y_fit))
    coeffs = np.polyfit(x_fit, y_fit, 1)
    preds = []
    for i in range(1, n+1):
        val = coeffs[0]*(len(y_fit)-1+i) + coeffs[1]
        preds.append(round(max(0,float(val)),2))
    return preds

def category_breakdown(d):
    s = d[d.transaction_type=='Expense'].groupby('category_clean').amount_clean.sum().sort_values(ascending=False)
    return {k: round(float(v),2) for k,v in s.items()}

def payment_breakdown(d):
    s = d[d.transaction_type=='Expense'].groupby('payment_mode_clean').amount_clean.sum().sort_values(ascending=False)
    return {k: round(float(v),2) for k,v in s.items()}

def location_breakdown(d):
    s = d.groupby('location_clean').amount_clean.sum().sort_values(ascending=False)
    s = s[s.index != 'Unknown']
    return {k: round(float(v),2) for k,v in s.items()}

def health_score(d, full=None):
    if full is None:
        full = d
    tot_inc = d[d.transaction_type=='Income'].amount_clean.sum()
    tot_exp = d[d.transaction_type=='Expense'].amount_clean.sum()
    savings_rate = (tot_inc-tot_exp)/tot_inc if tot_inc>0 else -1
    s1 = max(0,min(1,savings_rate))*100

    exp_m = d[d.transaction_type=='Expense'].groupby('month').amount_clean.sum()
    exp_m = exp_m[exp_m>0]
    cv = (exp_m.std()/exp_m.mean()) if len(exp_m)>1 and exp_m.mean()>0 else 0
    s2 = max(0, 100 - cv*100)

    n_txn = len(full)
    n_anom = int(full.is_anomaly.sum())
    s3 = max(0, 100 - min(100, (n_anom/max(1,n_txn))*500))

    cat_amt = d[d.transaction_type=='Expense'].groupby('category_clean').amount_clean.sum()
    if cat_amt.sum() > 0:
        shares = cat_amt/cat_amt.sum()
        hhi = (shares**2).sum()
        s4 = (1-hhi)*100
    else:
        s4 = 0

    overall = 0.4*s1 + 0.25*s2 + 0.2*s3 + 0.15*s4
    return {
        'overall': round(float(overall),1),
        'savings': round(float(s1),1),
        'stability': round(float(s2),1),
        'anomaly_free': round(float(s3),1),
        'diversification': round(float(s4),1),
        'savings_rate_pct': round(float(savings_rate*100),1),
        'total_income': round(float(tot_inc),2),
        'total_expense': round(float(tot_exp),2),
        'net_savings': round(float(tot_inc-tot_exp),2),
        'txn_count': int(n_txn),
        'anomaly_count': n_anom,
    }

def anomaly_list(d, limit=8):
    a = d[d.is_anomaly].copy()
    if a.empty:
        return []
    # bucket by reason "type" so the feed shows a mix, not N copies of the single
    # highest injected error value
    def reason_type(r):
        if r == 'Negative amount (data error)': return 'neg'
        if r == 'Extreme outlier amount': return 'extreme'
        return 'category'
    a['rtype'] = a.anomaly_reason.apply(reason_type)
    a = a.sort_values('amount_clean', ascending=False)
    a = a.drop_duplicates(subset=['rtype','category_clean','amount_clean'])

    n_extreme = max(1, limit//5) if (a.rtype=='extreme').any() else 0
    n_neg = max(1, limit//5) if (a.rtype=='neg').any() else 0
    n_cat = max(0, limit - n_extreme - n_neg)
    picked = [
        a[a.rtype=='extreme'].head(n_extreme),
        a[a.rtype=='neg'].sort_values('amount_clean').head(n_neg),
        a[a.rtype=='category'].head(n_cat),
    ]
    out_df = pd.concat(picked)
    out_df = out_df.sort_values('date_clean', ascending=False)

    out = []
    for _, r in out_df.iterrows():
        out.append({
            'date': r['date_clean'].strftime('%d %b %Y'),
            'user': r['user_id'],
            'category': r['category_clean'],
            'amount': round(float(r['amount_clean']),2),
            'reason': r['anomaly_reason'],
            'location': r['location_clean'],
        })
    return out

# "trusted" view used for all aggregate math (totals, trends, health, forecasts) —
# anomalous rows (data-entry errors, extreme one-off outliers) are excluded here so
# KPIs reflect genuine financial behaviour; they still appear in the anomaly feed below.
trusted = work[~work.is_anomaly].copy()

# ---------------- points for the anomaly graph ----------------
# One [date, amount, category, kind] row per transaction.
#   kind 0 = normal, 1 = unusually high for its category,
#   2 = extreme outlier, 3 = negative amount (data error)
def kind_of(reason):
    if reason == 'Negative amount (data error)': return 3
    if reason == 'Extreme outlier amount': return 2
    if reason.startswith('Unusually high'): return 1
    return 0

def points_for(d):
    return [
        [r.date_clean.strftime('%Y-%m-%d'), round(float(r.amount_clean), 2), r.category_clean, kind_of(r.anomaly_reason)]
        for r in d.sort_values('date_clean').itertuples()
    ]

# ---------------- OVERALL ----------------
overall = {}
inc_s, exp_s = monthly_series(trusted)
overall['months'] = ALL_MONTHS
overall['income_series'] = inc_s
overall['expense_series'] = exp_s
overall['income_forecast'] = forecast_next(inc_s)
overall['expense_forecast'] = forecast_next(exp_s)
overall['category_breakdown'] = category_breakdown(trusted)
overall['payment_breakdown'] = payment_breakdown(trusted)
overall['location_breakdown'] = location_breakdown(trusted)
overall['health'] = health_score(trusted, work)
overall['anomalies'] = anomaly_list(work, 10)
overall['user_count'] = int(work.user_id.nunique())
overall['txn_count'] = int(len(work))
# platform view: every flagged transaction plus a fixed random sample of normal ones
# (15,000+ dots would be unreadable and slow); the sample is seeded so reruns match
_flagged = work[work.is_anomaly]
_normal = work[~work.is_anomaly]
_normal_sample = _normal.sample(n=min(1500, len(_normal)), random_state=42)
overall['points'] = points_for(pd.concat([_flagged, _normal_sample]))
overall['points_sampled'] = True
overall['normal_total'] = int(len(_normal))

# ---------------- PER USER ----------------
users = {}
for uid, grp in work.groupby('user_id'):
    if len(grp) < 15:
        continue
    tgrp = grp[~grp.is_anomaly]
    inc_s, exp_s = monthly_series(tgrp)
    users[uid] = {
        'months': ALL_MONTHS,
        'income_series': inc_s,
        'expense_series': exp_s,
        'income_forecast': forecast_next(inc_s),
        'expense_forecast': forecast_next(exp_s),
        'category_breakdown': category_breakdown(tgrp),
        'payment_breakdown': payment_breakdown(tgrp),
        'location_breakdown': location_breakdown(tgrp),
        'health': health_score(tgrp, grp),
        'anomalies': anomaly_list(grp, 5),
        'txn_count': int(len(grp)),
        'points': points_for(grp),
        'points_sampled': False,
    }

print("users with enough data:", len(users))

# ---------------- DATA QUALITY META ----------------
raw = pd.read_csv(RAW_CSV)
quality = {
    'raw_rows': int(len(raw)),
    'duplicates_removed': int(len(raw) - raw_count),
    'usable_rows': int(usable_count),
    'dropped_incomplete': int(raw_count-usable_count),
    'category_variants_fixed': int(raw.category.nunique(dropna=True)),
    'category_canonical': int(work.category_clean.nunique()),
    'payment_variants_fixed': int(raw.payment_mode.nunique(dropna=True)),
    'payment_canonical': int(work.payment_mode_clean.replace('Unknown', np.nan).nunique()),
    'location_variants_fixed': int(raw.location.nunique(dropna=True)),
    'location_canonical': int(work.location_clean.replace('Unknown', np.nan).nunique()),
    'missing_dates': int(raw.date.isna().sum()),
    'missing_amounts': int(raw.amount.isna().sum()),
    'currency_symbols_normalized': int(raw.amount.dropna().astype(str).str.contains(r'[₹$]|Rs|INR', regex=True).sum()),
    'negative_amounts_flagged': int((work.amount_clean<0).sum()),
    'extreme_outliers_flagged': int((work.amount_clean>200000).sum()),
    'total_anomalies': int(work.is_anomaly.sum()),
}
print(json.dumps(quality, indent=2))

# ---------------- MACHINE LEARNING (scikit-learn) ----------------
# 1) Isolation Forest: unsupervised anomaly detector, a second opinion next to the IQR rules.
# 2) Forecast model comparison: rolling-origin backtest of regression models vs simple baselines.
import warnings; warnings.filterwarnings('ignore')
from sklearn.ensemble import IsolationForest, RandomForestRegressor
from sklearn.linear_model import Ridge

E = work[work.amount_clean.notna()].copy()
E['pay_c'] = E.payment_mode_clean.fillna('Unknown')
_la = np.log1p(E.amount_clean.clip(lower=0))
_grp = E.transaction_type + '|' + E.category_clean
_med = _la.groupby(_grp).transform('median')
_mad = (_la - _med).abs().groupby(_grp).transform('median').clip(lower=0.05)
Xf = pd.DataFrame({
    'log_amount': _la,
    'vs_category_norm': (_la - _med) / _mad,        # how far from this category's typical amount
    'is_negative': (E.amount_clean < 0).astype(int),
    'is_income': (E.transaction_type == 'Income').astype(int),
    'weekday': E.date_clean.dt.dayofweek,
    'month': E.date_clean.dt.month,
})
iso = IsolationForest(n_estimators=300, contamination=0.03, random_state=42).fit(Xf)
E['if_flag'] = iso.predict(Xf) == -1
E['if_score'] = -iso.score_samples(Xf)            # higher = more unusual
rule = E.is_anomaly
both = int((E.if_flag & rule).sum())
if_only = E[E.if_flag & ~rule].sort_values('if_score', ascending=False)
ml_iso = {
    'model': 'IsolationForest', 'trees': 300, 'contamination': 0.03,
    'features': ['log(amount)', 'distance from category norm', 'negative?', 'income?', 'weekday', 'month'],
    'rows_scored': int(len(E)), 'flagged_by_model': int(E.if_flag.sum()),
    'flagged_by_rules': int(rule.sum()), 'flagged_by_both': both,
    'rules_caught_by_model_pct': round(both / max(1, int(rule.sum())) * 100, 1),
    'model_only': int(len(if_only)),
    'model_only_examples': [{
        'date': r.date_clean.strftime('%Y-%m-%d'), 'user': str(r.user_id), 'category': r.category_clean,
        'type': r.transaction_type, 'amount': float(r.amount_clean), 'payment': r.pay_c,
        'score': round(float(r.if_score), 3)} for r in if_only.head(6).itertuples()],
}
print('IsolationForest:', {k: v for k, v in ml_iso.items() if k != 'model_only_examples'})

def _series(t):
    return work[(work.transaction_type == t) & (work.amount_clean > 0) & (work.amount_clean <= 200000)] \
        .groupby(work.date_clean.dt.to_period('M')).amount_clean.sum()

def _predict(name, y, mo):
    n = len(y)
    if name == 'last_month':     return y[-1]
    if name == 'avg_6_months':   return y[-6:].mean()
    if name == 'linear_trend':
        k = min(12, n); return np.polyval(np.polyfit(np.arange(k), y[-k:], 1), k)
    if name == 'ridge_seasonal':
        X = np.c_[np.arange(n), np.eye(12)[mo]]
        m = Ridge(alpha=1.0).fit(X, y)
        return m.predict([np.r_[n, np.eye(12)[(mo[-1] + 1) % 12]]])[0]
    if name == 'random_forest':
        L = 3; X = np.array([y[i-L:i] for i in range(L, n)])
        return RandomForestRegressor(200, random_state=0, min_samples_leaf=2).fit(X, y[L:]).predict([y[-L:]])[0]

BT = ['last_month', 'avg_6_months', 'linear_trend', 'ridge_seasonal', 'random_forest']
KIND = {'last_month': 'baseline', 'avg_6_months': 'baseline', 'linear_trend': 'model (used in dashboard)',
        'ridge_seasonal': 'ML model', 'random_forest': 'ML model'}
backtest = {'months_tested': 12, 'method': 'rolling origin: train on all earlier months, predict the next, repeat for the last 12', 'rows': []}
for name in BT:
    row = {'name': name, 'kind': KIND[name]}
    for t in ['Income', 'Expense']:
        s = _series(t); y = s.values.astype(float); mo = np.array([p.month - 1 for p in s.index])
        errs = [abs(_predict(name, y[:c], mo[:c]) - y[c]) for c in range(len(y) - 12, len(y))]
        row[t.lower() + '_mape_pct'] = round(float(np.mean(errs)) / float(y[-12:].mean()) * 100, 1)
    row['avg_mape_pct'] = round((row['income_mape_pct'] + row['expense_mape_pct']) / 2, 1)
    backtest['rows'].append(row)
backtest['best'] = min(backtest['rows'], key=lambda r: r['avg_mape_pct'])['name']
print('Backtest:', [(r['name'], r['avg_mape_pct']) for r in backtest['rows']], 'best =', backtest['best'])
ml = {'anomaly': ml_iso, 'forecast_backtest': backtest}

output = {
    'overall': overall,
    'users': users,
    'quality': quality,
    'ml': ml,
    'generated_categories': sorted(work.category_clean.unique().tolist()),
}

with open(OUT_JSON, 'w') as f:
    json.dump(output, f)
print("\nSaved raw JSON to", OUT_JSON)

# Also write assets/data.js — this is what index.html actually loads
# (a plain <script> global avoids the fetch()/CORS issues of loading
# JSON straight from the filesystem when you just double-click index.html)
with open(OUT_JS, 'w') as f:
    f.write('window.FINTWIN_DATA = ' + json.dumps(output) + ';\n')
print("Saved browser-ready data to", OUT_JS)

print("JSON size (KB):", os.path.getsize(OUT_JSON)/1024)
