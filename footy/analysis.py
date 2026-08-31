"""Scouting tables - the descriptive layer that sits under the model.

The organising trick is `to_team_rows`: reshape one row per match into two rows
per match, one from each team's point of view. Every table below is then a
groupby on that, which keeps home/away splits honest and makes it impossible to
accidentally mix a team's attacking and defending numbers.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def to_team_rows(df: pd.DataFrame) -> pd.DataFrame:
    """One row per team per match, from that team's perspective."""
    def side(home: bool) -> pd.DataFrame:
        p, o = ("H", "A") if home else ("A", "H")
        out = pd.DataFrame({
            "Div": df["Div"], "Date": df["Date"], "season": df.get("season"),
            "team": df["HomeTeam" if home else "AwayTeam"],
            "opponent": df["AwayTeam" if home else "HomeTeam"],
            "venue": "home" if home else "away",
            "referee": df.get("Referee"),
            "goals_for": df[f"FT{p}G"], "goals_against": df[f"FT{o}G"],
        })
        for name, col in [("corners", "C"), ("shots", "S"), ("sot", "ST"),
                          ("fouls", "F"), ("yellow", "Y"), ("red", "R")]:
            if f"{p}{col}" in df.columns:
                out[f"{name}_for"] = df[f"{p}{col}"]
                out[f"{name}_against"] = df[f"{o}{col}"]
        if "yellow_for" in out.columns:
            out["cards_for"] = out["yellow_for"].fillna(0) + out["red_for"].fillna(0)
            out["cards_against"] = (out["yellow_against"].fillna(0)
                                    + out["red_against"].fillna(0))
            out["points_for"] = (10 * out["yellow_for"].fillna(0)
                                 + 25 * out["red_for"].fillna(0))
            # season_table asks for both sides of every metric, so booking
            # points need the conceded column too.
            out["points_against"] = (10 * out["yellow_against"].fillna(0)
                                     + 25 * out["red_against"].fillna(0))
        if "corners_for" in out.columns:
            out["corners_total"] = out["corners_for"] + out["corners_against"]
        out["result"] = np.where(out["goals_for"] > out["goals_against"], "W",
                         np.where(out["goals_for"] < out["goals_against"], "L", "D"))
        return out

    return (pd.concat([side(True), side(False)])
            .sort_values("Date").reset_index(drop=True))


def shrink(observed: float, n: int, prior: float, prior_n: float = 12.0) -> float:
    """Pull a small-sample rate toward a long-run rate.

    Six matches of card counts is almost pure noise: at two cards a game the
    standard error on a six-match average is about 0.6 cards, which is bigger
    than any real difference between two teams. This weights the recent number
    by how much of it you can actually believe.
    """
    if n <= 0 or not np.isfinite(observed):
        return prior
    w = n / (n + prior_n)
    return float(w * observed + (1 - w) * prior)


def season_table(df: pd.DataFrame, metric: str = "cards",
                 season: str | None = None) -> pd.DataFrame:
    """Season totals for one metric, split by venue.

    `metric` is one of cards, points, corners, goals, fouls, yellow.
    Read this for context, not for prediction — see `discipline_table` for the
    version that adjusts for who each team actually played.
    """
    tr = to_team_rows(df)
    if season is not None:
        tr = tr[tr["season"].astype(str) == str(season)]
    f, a = f"{metric}_for", f"{metric}_against"
    if f not in tr.columns:
        raise ValueError(f"No column for metric '{metric}'.")

    g = tr.groupby("team")
    out = pd.DataFrame({
        "matches": g.size(),
        "for": g[f].sum(),
        "against": g[a].sum(),
        "per_match": g[f].mean().round(2),
    })
    for v in ("home", "away"):
        sub = tr[tr["venue"] == v].groupby("team")[f]
        out[f"{v}_per_match"] = sub.mean().round(2)
    out["home_away_gap"] = (out["away_per_match"] - out["home_per_match"]).round(2)
    return out.sort_values("for", ascending=False)


def discipline_table(df: pd.DataFrame, model, season: str | None = None
                     ) -> pd.DataFrame:
    """Cards above or below what the fixtures alone would predict.

    A raw card table mostly ranks teams by who they played and how often they
    were losing. This divides each team's actual cards by the model's
    expectation for those specific matches, so a ratio above 1.0 means genuinely
    dirtier than their schedule implies. This is the column to bet off.
    """
    tr = to_team_rows(df)
    if season is not None:
        tr = tr[tr["season"].astype(str) == str(season)]
    if "cards_for" not in tr.columns:
        raise ValueError("No card data in this dataset.")

    exp = []
    for _, r in tr.iterrows():
        if r["venue"] == "home":
            e, _o = model.expected(r["team"], r["opponent"], referee=r.get("referee"))
        else:
            _o, e = model.expected(r["opponent"], r["team"], referee=r.get("referee"))
        exp.append(e)
    tr["expected"] = exp

    g = tr.groupby("team")
    out = pd.DataFrame({
        "matches": g.size(),
        "actual": g["cards_for"].sum().round(1),
        "expected": g["expected"].sum().round(1),
    })
    out["ratio"] = (out["actual"] / out["expected"]).round(2)
    out["per_match"] = (out["actual"] / out["matches"]).round(2)
    # Poisson standard error on the ratio, so you can see what is real.
    out["se"] = (np.sqrt(out["actual"].clip(lower=1)) / out["expected"]).round(2)
    out["signal"] = np.where(
        (out["ratio"] - 1).abs() > 2 * out["se"], "real", "noise")
    return out.sort_values("ratio", ascending=False)


def recent_form(df: pd.DataFrame, team: str, metric: str = "cards",
                n: int = 6, venue: str | None = None,
                long_run_matches: int = 60) -> dict:
    """Last n matches for one team, with the shrunk estimate beside the raw one.

    The raw average is what most tipsters quote. The shrunk one is what you
    should actually use.
    """
    tr = to_team_rows(df)
    tr = tr[tr["team"] == team]
    f = f"{metric}_for"
    if f not in tr.columns:
        raise ValueError(f"No column for metric '{metric}'.")

    long_run = tr.tail(long_run_matches)[f].mean()
    sub = tr if venue is None else tr[tr["venue"] == venue]
    last = sub.tail(n)
    raw = last[f].mean()

    return {
        "team": team, "metric": metric, "venue": venue or "all",
        "matches": len(last),
        "recent_avg": round(float(raw), 2) if len(last) else None,
        "long_run_avg": round(float(long_run), 2) if len(tr) else None,
        "shrunk": round(shrink(raw, len(last), long_run), 2) if len(tr) else None,
        "log": last[["Date", "opponent", "venue", "result", f,
                     f"{metric}_against"]].reset_index(drop=True),
    }


def referee_table(df: pd.DataFrame, model=None, min_matches: int = 8
                  ) -> pd.DataFrame:
    """Every referee's card rate, and how it compares to expectation.

    `factor` is the number that matters. 1.20 means this official books 20%
    more than the teams in front of him would otherwise produce. Officials are
    usually announced two or three days before kickoff, and the market is often
    slow to reprice for them.
    """
    d = df.dropna(subset=["Referee"]).copy()
    if d.empty:
        return pd.DataFrame()
    d["cards"] = (d["HY"].fillna(0) + d["AY"].fillna(0)
                  + d["HR"].fillna(0) + d["AR"].fillna(0))
    d["points"] = (10 * (d["HY"].fillna(0) + d["AY"].fillna(0))
                   + 25 * (d["HR"].fillna(0) + d["AR"].fillna(0)))
    d["fouls"] = d.get("HF", 0) + d.get("AF", 0)

    g = d.groupby("Referee")
    out = pd.DataFrame({
        "matches": g.size(),
        "cards_per_match": g["cards"].mean().round(2),
        "points_per_match": g["points"].mean().round(1),
        "home_cards": (g["HY"].mean() + g["HR"].mean()).round(2),
        "away_cards": (g["AY"].mean() + g["AR"].mean()).round(2),
        "reds_per_match": (g["HR"].mean() + g["AR"].mean()).round(3),
    })
    if "HF" in d.columns:
        out["fouls_per_card"] = (g["fouls"].mean() / g["cards"].mean()).round(1)
    out["home_bias"] = (out["away_cards"] - out["home_cards"]).round(2)

    if model is not None and model.ref_factor:
        out["factor"] = pd.Series(model.ref_factor)
    out = out[out["matches"] >= min_matches]
    return out.sort_values("cards_per_match", ascending=False)


def head_to_head(df: pd.DataFrame, home: str, away: str, n: int = 8
                 ) -> pd.DataFrame:
    """Recent meetings. Useful context, weak evidence — squads turn over."""
    m = df[((df["HomeTeam"] == home) & (df["AwayTeam"] == away))
           | ((df["HomeTeam"] == away) & (df["AwayTeam"] == home))]
    cols = [c for c in ["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG",
                        "HC", "AC", "HY", "AY", "HR", "AR", "Referee"]
            if c in m.columns]
    return m.sort_values("Date", ascending=False).head(n)[cols].reset_index(drop=True)


def rest_days(df: pd.DataFrame) -> pd.DataFrame:
    """Days since each team's previous match.

    Short turnarounds are the most under-priced schedule effect in football:
    fewer than four days between matches measurably drags a team's expected
    goals down, and midweek European fixtures are the usual cause.
    """
    tr = to_team_rows(df)
    tr["rest"] = tr.groupby("team")["Date"].diff().dt.days
    return tr[["Date", "team", "opponent", "venue", "rest", "goals_for",
               "goals_against"]]
