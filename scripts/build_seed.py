"""Converts Attendee_Dataset.xlsx into JSON seed files (raw rows; import-retry duplicates kept on purpose,
because the app de-duplicates them in SQL views).
Usage: python scripts/build_seed.py path/to/Attendee_Dataset.xlsx"""
import sys, json, pandas as pd

src = sys.argv[1] if len(sys.argv) > 1 else "Attendee_Dataset.xlsx"
X = pd.read_excel(src, sheet_name=None)

def ts(v):
    return None if pd.isna(v) else pd.Timestamp(v).strftime("%Y-%m-%dT%H:%M:%S+05:30")

def d(v):
    return None if pd.isna(v) else pd.Timestamp(v).strftime("%Y-%m-%d")

def clean(v):
    if v is None:
        return None
    if not isinstance(v, str) and pd.isna(v):
        return None
    return v.item() if hasattr(v, "item") else v

def dump(name, df, ts_cols=(), date_cols=(), rename=None):
    df = df.rename(columns=rename or {})
    rows = []
    for _, r in df.iterrows():
        o = {}
        for c in df.columns:
            v = r[c]
            o[c] = ts(v) if c in ts_cols else d(v) if c in date_cols else clean(v)
        rows.append(o)
    with open(f"data/{name}.json", "w") as fh:
        json.dump(rows, fh, ensure_ascii=False)
    print(f"{name}: {len(rows)} rows")

dump("event", X["Event"], ts_cols=("event_starts_at", "event_ends_at"), date_cols=("history_start", "history_end"))
dump("targets", X["Targets"], ts_cols=("effective_at",), rename={
    "identified_external_people_goal": "identified_goal",
    "unique_external_visitors_goal": "visitors_goal",
    "marketing_budget_inr": "budget_inr"})
dump("campaigns", X["Campaigns"], ts_cols=("created_at", "planned_start_at", "planned_end_at"))
dump("daily_marketing", X["Daily Marketing"], date_cols=("activity_date",))
dump("people", X["People"], ts_cols=("first_seen_at",))
dump("interactions", X["Interest and Engagement"], ts_cols=("occurred_at",))
dump("registrations", X["Registrations"], ts_cols=("registered_at",))
dump("registration_history", X["Registration History"], ts_cols=("effective_at",))
dump("checkins", X["Check-ins"], ts_cols=("occurred_at",))
