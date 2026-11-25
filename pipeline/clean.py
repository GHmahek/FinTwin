import pandas as pd, numpy as np, re, json, sys, os
from datetime import datetime

# Usage: python clean.py [path/to/raw.csv]
HERE = os.path.dirname(os.path.abspath(__file__))
RAW_CSV = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'data', 'budgetwise_finance_dataset.csv')
OUT_PKL = os.path.join(HERE, 'cleaned.pkl')

df = pd.read_csv(RAW_CSV)
print("raw shape", df.shape)

# ---------- DUPLICATES ----------
# Rows identical in every column are the same transaction entered twice; keep the first.
# (Rows that merely share a transaction_id but differ elsewhere are different transactions
# and are kept.)
n_before = len(df)
df = df.drop_duplicates().reset_index(drop=True)
print("duplicate rows removed:", n_before - len(df), "->", len(df), "rows")

# ---------- CATEGORY ----------
def clean_category(c):
    if pd.isna(c): return None
    s = str(c).strip().lower()
    s = re.sub(r'[^a-z]', '', s)
    mapping = {
        'educaton':'Education','education':'Education','edu':'Education',
        'fod':'Food','foods':'Food','food':'Food','foodd':'Food',
        'entertainment':'Entertainment','entertain':'Entertainment','entrtnmnt':'Entertainment',
        'utilties':'Utilities','utility':'Utilities','utlities':'Utilities','utilities':'Utilities',
        'rentt':'Rent','rent':'Rent','rnt':'Rent',
        'travel':'Travel','travl':'Travel','traval':'Travel',
        'health':'Health','helth':'Health',
        'investment':'Investment',
        'savings':'Savings','saving':'Savings',
        'salary':'Salary',
        'freelance':'Freelance',
        'bonus':'Bonus',
        'others':'Other','other':'Other','misc':'Other',
    }
    return mapping.get(s, s.title() if s else None)

df['category_clean'] = df['category'].apply(clean_category)

# ---------- PAYMENT MODE ----------
def clean_pay(p):
    if pd.isna(p): return None
    s = str(p).strip().lower().replace('_','').replace(' ','')
    if s in ('card','crd'): return 'Card'
    if s in ('csh','cash'): return 'Cash'
    if s in ('upi','upi'): return 'UPI'
    if 'bank' in s: return 'Bank Transfer'
    return p.strip().title()

df['payment_mode_clean'] = df['payment_mode'].apply(clean_pay)

# ---------- LOCATION ----------
loc_map = {
    'ban':'Bangalore','bangalore':'Bangalore',
    'ahm':'Ahmedabad','ahmedabad':'Ahmedabad',
    'luc':'Lucknow','lucknow':'Lucknow',
    'del':'Delhi','delhi':'Delhi',
    'kol':'Kolkata','kolkata':'Kolkata',
    'che':'Chennai','chennai':'Chennai',
    'pun':'Pune','pune':'Pune',
    'jai':'Jaipur','jaipur':'Jaipur',
    'mum':'Mumbai','mumbai':'Mumbai',
    'hyd':'Hyderabad','hyderabad':'Hyderabad',
}
def clean_loc(l):
    if pd.isna(l): return None
    s = str(l).strip().lower()
    return loc_map.get(s, l.strip().title())

df['location_clean'] = df['location'].apply(clean_loc)

# ---------- AMOUNT ----------
def clean_amount(a):
    if pd.isna(a): return np.nan
    s = str(a).strip()
    s = s.replace('Rs.','').replace('Rs','').replace('₹','').replace('$','').replace('INR','').replace(',','').strip()
    try:
        return float(s)
    except:
        return np.nan

df['amount_clean'] = df['amount'].apply(clean_amount)

# ---------- DATE ----------
def clean_date(d):
    if pd.isna(d): return pd.NaT
    s = str(d).strip()
    try:
        if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
            return pd.to_datetime(s, format='%Y-%m-%d')
        if re.match(r'^\d{2}/\d{2}/\d{4}$', s):
            return pd.to_datetime(s, format='%m/%d/%Y')
        if re.match(r'^\d{2}-\d{2}-\d{4}$', s):
            return pd.to_datetime(s, format='%d-%m-%Y')
        if re.match(r'^\d{2}-\d{2}-\d{2}$', s):
            return pd.to_datetime(s, format='%d-%m-%y')
    except:
        return pd.NaT
    return pd.NaT

df['date_clean'] = df['date'].apply(clean_date)

print("\nCategory nulls after clean:", df.category_clean.isna().sum())
print("Payment nulls after clean:", df.payment_mode_clean.isna().sum())
print("Location nulls after clean:", df.location_clean.isna().sum())
print("Amount nulls after clean:", df.amount_clean.isna().sum())
print("Date nulls after clean:", df.date_clean.isna().sum())
print("\nCategories:", sorted(df.category_clean.dropna().unique()))
print("Payment modes:", sorted(df.payment_mode_clean.dropna().unique()))
print("Locations:", sorted(df.location_clean.dropna().unique()))
print("date range:", df.date_clean.min(), df.date_clean.max())

df.to_pickle(OUT_PKL)
print("\nSaved cleaned dataframe to", OUT_PKL)
