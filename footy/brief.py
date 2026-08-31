"""One fixture, read in the right order.

The order matters. Season-long numbers first, because they have the sample size.
Then the venue-specific recent window, because that is the current squad and
current tactics. Then the referee, because on cards he is worth more than either
team. Then the model price, because it is the only number you can actually bet.

Reading them the other way round — starting from the model price and looking for
numbers that agree with it — is how you talk yourself into bad bets.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import analysis as A
from .predict import predict_match

METRICS = ["cards", "corners", "goals"]


def _rank(table: pd.DataFrame, team: str, col: str) -> str:
    if table.empty or team not in table.index or col not in table.columns:
        return ""
    r = int(table[col].rank(ascending=False, method="min").loc[team])
    return f" ({r} of {len(table)})"


def match_brief(df: pd.DataFrame, lm, home: str, away: str,
                referee: str | None = None, n: int = 6,
                season: str | None = None) -> dict:
    """Every layer for one fixture, assembled but not yet interpreted."""
    d = df[df["Div"] == lm.div]
    season_tabs = {}
    for metric in METRICS:
        try:
            season_tabs[metric] = A.season_table(d, metric, season=season)
        except ValueError:
            pass

    adjusted = None
    if lm.cards is not None:
        try:
            adjusted = A.discipline_table(d, lm.cards, season=season)
        except ValueError:
            pass

    ref_row = None
    if referee:
        rt = A.referee_table(d, lm.cards, min_matches=1)
        if referee in rt.index:
            ref_row = rt.loc[referee].to_dict()
            ref_row["referee"] = referee

    teams = {}
    for team, venue in ((home, "home"), (away, "away")):
        entry = {"venue": venue, "season": {}, "recent": {}}
        for metric, tab in season_tabs.items():
            if team in tab.index:
                row = tab.loc[team]
                entry["season"][metric] = {
                    "per_match": float(row["per_match"]),
                    "home_per_match": float(row.get("home_per_match", np.nan)),
                    "away_per_match": float(row.get("away_per_match", np.nan)),
                    "rank": _rank(tab, team, "per_match"),
                }
            try:
                entry["recent"][metric] = A.recent_form(
                    d, team, metric, n=n, venue=venue)
            except ValueError:
                pass
        if adjusted is not None and team in adjusted.index:
            entry["card_index"] = adjusted.loc[team].to_dict()
        entry["rest_days"] = _last_rest(d, team)
        teams[team] = entry

    return {
        "fixture": f"{home} v {away}",
        "div": lm.div,
        "referee": ref_row,
        "model": predict_match(lm, home, away, referee=referee, blend_1x2=0.0),
        "teams": teams,
        "h2h": A.head_to_head(d, home, away, n=6),
        "n": n,
    }


def _last_rest(df: pd.DataFrame, team: str) -> float | None:
    r = A.rest_days(df)
    r = r[r["team"] == team].dropna(subset=["rest"])
    return float(r["rest"].iloc[-1]) if len(r) else None


def format_brief(b: dict) -> str:
    """The brief as markdown, written to be read top to bottom."""
    m, out = b["model"], [f"## {b['fixture']}"]
    p = m["probs"]
    out.append(
        f"**Model line** — goals {m['xg_home']}–{m['xg_away']} · "
        f"corners {m.get('exp_corners', '–')} · cards {m.get('exp_cards', '–')}"
    )
    out.append(
        f"Home {p['home']*100:.0f}% · Draw {p['draw']*100:.0f}% · "
        f"Away {p['away']*100:.0f}% · Over 2.5 {p['over_2.5']*100:.0f}% · "
        f"BTTS {p['btts_yes']*100:.0f}%")
    if "corners_over_9.5" in p:
        out.append(f"Over 9.5 corners {p['corners_over_9.5']*100:.0f}% · "
                   f"Over 3.5 cards {p.get('cards_over_3.5', 0)*100:.0f}% · "
                   f"Over 35.5 booking points "
                   f"{p.get('points_over_35.5', 0)*100:.0f}%")
    out.append("")

    # Referee
    if b["referee"]:
        r = b["referee"]
        conf = ("thin sample — treat as a hint"
                if r["matches"] < 15 else
                "reasonable sample" if r["matches"] < 40 else "solid sample")
        out.append(f"### Referee: {r['referee']}")
        line = (f"{r['cards_per_match']:.2f} cards a match over {int(r['matches'])} "
                f"games ({conf}), {r['points_per_match']:.0f} booking points, "
                f"{r['reds_per_match']:.2f} reds.")
        if "fouls_per_card" in r and np.isfinite(r.get("fouls_per_card", np.nan)):
            line += f" A booking every {r['fouls_per_card']:.1f} fouls."
        out.append(line)
        out.append(f"Away sides get {r['home_bias']:+.2f} more cards than home "
                   f"sides under him.")
        if "factor" in r and np.isfinite(r.get("factor", np.nan)):
            out.append(f"The model applies a **{r['factor']:.2f}×** adjustment "
                       f"for him, already included in the line above.")
        out.append("")
    else:
        out.append("### Referee: not set")
        out.append("On cards markets the official is worth more than either "
                   "team. Appointments are usually published two or three days "
                   "before kickoff — find it before you bet a cards line.\n")

    # Teams
    for team, t in b["teams"].items():
        out.append(f"### {team} — {t['venue']}")
        for metric in METRICS:
            s = t["season"].get(metric)
            rec = t["recent"].get(metric)
            if not s:
                continue
            venue_key = f"{t['venue']}_per_match"
            bits = [f"season {s['per_match']:.2f}{s['rank']}",
                    f"{t['venue']} {s[venue_key]:.2f}"]
            if rec and rec.get("recent_avg") is not None:
                bits.append(
                    f"last {rec['matches']} {t['venue']} {rec['recent_avg']:.2f}"
                    f" → shrunk **{rec['shrunk']:.2f}**")
            out.append(f"- **{metric.capitalize()}**: " + " · ".join(bits))

        ci = t.get("card_index")
        if ci:
            verdict = ("genuinely above expectation"
                       if ci["signal"] == "real" and ci["ratio"] > 1 else
                       "genuinely below expectation"
                       if ci["signal"] == "real" else
                       "within normal variation — do not bet on it")
            out.append(f"- **Cards vs expectation**: {ci['ratio']:.2f}× "
                       f"(±{ci['se']:.2f}), {verdict}")
        if t["rest_days"] is not None:
            note = " — short turnaround" if t["rest_days"] < 4 else ""
            out.append(f"- **Rest**: {t['rest_days']:.0f} days{note}")
        out.append("")

    # Head to head
    h2h = b["h2h"]
    if len(h2h):
        out.append("### Recent meetings")
        for _, r in h2h.iterrows():
            extra = []
            if "HC" in r and pd.notna(r.get("HC")):
                extra.append(f"{int(r['HC'] + r['AC'])} corners")
            if "HY" in r and pd.notna(r.get("HY")):
                cards = int(r["HY"] + r["AY"] + r.get("HR", 0) + r.get("AR", 0))
                extra.append(f"{cards} cards")
            out.append(
                f"- {r['Date'].date()} {r['HomeTeam']} {int(r['FTHG'])}–"
                f"{int(r['FTAG'])} {r['AwayTeam']}"
                + (f" · {', '.join(extra)}" if extra else "")
                + (f" · {r['Referee']}" if pd.notna(r.get("Referee")) else ""))
        out.append("\nSquads turn over. Treat this as colour, not evidence.")

    return "\n".join(out)


def slate_scan(df: pd.DataFrame, models: dict, fixtures: pd.DataFrame,
               metric: str = "cards", n: int = 6) -> pd.DataFrame:
    """Rank a whole matchday by one metric, to find where to look first.

    Sorting the slate by expected cards or corners and reading the top and
    bottom five is a faster way to find a mispriced game than opening twenty
    briefs in order.
    """
    rows = []
    for _, f in fixtures.iterrows():
        lm = models.get(f["Div"])
        if lm is None:
            continue
        pred = predict_match(lm, f["HomeTeam"], f["AwayTeam"],
                             referee=f.get("Referee"), blend_1x2=0.0)
        d = df[df["Div"] == f["Div"]]
        rec = {}
        for team, venue in ((f["HomeTeam"], "home"), (f["AwayTeam"], "away")):
            try:
                rec[venue] = A.recent_form(d, team, metric, n=n,
                                           venue=venue)["shrunk"]
            except (ValueError, KeyError, TypeError):
                rec[venue] = None
        rows.append({
            "Div": f["Div"],
            "fixture": f'{f["HomeTeam"]} v {f["AwayTeam"]}',
            "exp_goals": pred["xg_home"] + pred["xg_away"],
            "exp_corners": pred.get("exp_corners"),
            "exp_cards": pred.get("exp_cards"),
            "referee": f.get("Referee"),
            f"home_recent_{metric}": rec["home"],
            f"away_recent_{metric}": rec["away"],
            "over_2.5": pred["probs"]["over_2.5"],
            "over_9.5_corners": pred["probs"].get("corners_over_9.5"),
            "over_3.5_cards": pred["probs"].get("cards_over_3.5"),
        })
    out = pd.DataFrame(rows)
    sort_col = {"cards": "exp_cards", "corners": "exp_corners",
                "goals": "exp_goals"}.get(metric, "exp_cards")
    return out.sort_values(sort_col, ascending=False).reset_index(drop=True)
