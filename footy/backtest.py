"""Walk-forward backtest.

The model is refitted every `refit_days` using only matches that had already
been played, then asked to price the fixtures ahead of it. Any backtest that
shuffles rows into random train/test splits is leaking the future and will
show you a profit that does not exist.

The numbers that matter here are ROI and closing-line value, not accuracy.
A model can pick 55% of winners and still lose money.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .betting import expected_value, kelly
from .predict import fit_league, predict_match

MARKETS_1X2 = {"home": "odds_h", "draw": "odds_d", "away": "odds_a"}
MARKETS_OU = {"over_2.5": "odds_o25", "under_2.5": "odds_u25"}


def run(df: pd.DataFrame,
        div: str,
        start: str,
        end: str | None = None,
        *,
        refit_days: int = 7,
        min_edge: float = 0.04,
        blend_1x2: float = 0.35,
        fraction: float = 0.25,
        bankroll: float = 1000.0) -> tuple[pd.DataFrame, dict]:
    d = df[df["Div"] == div].sort_values("Date").reset_index(drop=True)
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end) if end else d["Date"].max()
    window = d[(d["Date"] >= start_ts) & (d["Date"] <= end_ts)]
    if window.empty:
        raise ValueError("No matches in that date range.")

    bets = []
    bank = bankroll
    lm = None
    last_fit = None

    for date, day in window.groupby(window["Date"].dt.normalize()):
        if last_fit is None or (date - last_fit).days >= refit_days:
            try:
                lm = fit_league(d, div, as_of=date)
                last_fit = date
            except ValueError:
                continue
        if lm is None:
            continue

        for _, row in day.iterrows():
            odds = {k: row.get(v) for k, v in
                    {**MARKETS_1X2, **MARKETS_OU}.items()}
            pred = predict_match(lm, row["HomeTeam"], row["AwayTeam"],
                                 referee=row.get("Referee"),
                                 market_odds=row.to_dict(),
                                 blend_1x2=blend_1x2)
            p = pred["probs"]

            total = row["FTHG"] + row["FTAG"]
            result = ("home" if row["FTHG"] > row["FTAG"]
                      else "away" if row["FTHG"] < row["FTAG"] else "draw")
            won = {**{k: (k == result) for k in MARKETS_1X2},
                   "over_2.5": total > 2.5, "under_2.5": total < 2.5}

            for sel, o in odds.items():
                if o is None or not np.isfinite(o) or o < 1.3 or o > 8:
                    continue
                ev = expected_value(p[sel], o)
                if ev < min_edge:
                    continue
                stake = kelly(p[sel], o, fraction) * bank
                if stake < 0.5:
                    continue
                profit = stake * (o - 1) if won[sel] else -stake
                bank += profit
                bets.append({
                    "date": row["Date"], "home": row["HomeTeam"],
                    "away": row["AwayTeam"], "selection": sel,
                    "model_prob": p[sel], "odds": o, "edge": ev,
                    "stake": stake, "won": bool(won[sel]),
                    "profit": profit, "bankroll": bank,
                })

    log = pd.DataFrame(bets)
    if log.empty:
        return log, {"n_bets": 0, "note": "No bets cleared the edge threshold."}

    staked = log["stake"].sum()
    summary = {
        "n_bets": len(log),
        "hit_rate": round(log["won"].mean(), 4),
        "total_staked": round(staked, 2),
        "profit": round(log["profit"].sum(), 2),
        "roi_pct": round(100 * log["profit"].sum() / staked, 2),
        "yield_per_bet_pct": round(100 * log["profit"].sum() / len(log)
                                   / log["stake"].mean(), 2),
        "final_bankroll": round(bank, 2),
        "max_drawdown_pct": round(_max_dd(log["bankroll"]) * 100, 2),
        "avg_odds": round(log["odds"].mean(), 2),
        "avg_edge_pct": round(100 * log["edge"].mean(), 2),
    }
    return log, summary


def _max_dd(series: pd.Series) -> float:
    peak = series.cummax()
    return float(((peak - series) / peak).max())


def calibration(df: pd.DataFrame, div: str, start: str, bins: int = 10,
                **kw) -> pd.DataFrame:
    """Are 30% shots actually winning 30% of the time?

    This is the single most useful diagnostic. If your 60% bucket wins 48%,
    no staking plan will save you.
    """
    log, _ = run(df, div, start, min_edge=-1.0, **kw)
    if log.empty:
        return log
    log["bucket"] = pd.cut(log["model_prob"], np.linspace(0, 1, bins + 1))
    return (log.groupby("bucket", observed=True)
            .agg(n=("won", "size"), predicted=("model_prob", "mean"),
                 actual=("won", "mean"))
            .round(3).reset_index())
