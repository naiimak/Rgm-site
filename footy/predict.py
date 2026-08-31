"""Fit goals, corners and cards models per league, then predict a fixture."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import markets as mk
from .betting import blend, devig_power
from .context import ContextModel, fit_context
from .ratings import RatingModel, fit_ratings, score_matrix

# Corners and cards drift more slowly than form, so they remember longer.
HALF_LIVES = {"goals": 270.0, "corners": 400.0, "cards": 500.0}


@dataclass
class LeagueModels:
    div: str
    goals: RatingModel
    corners: RatingModel | None
    cards: RatingModel | None
    trained_to: pd.Timestamp
    n_matches: int
    ctx_corners: ContextModel | None = None
    ctx_cards: ContextModel | None = None


def fit_league(df: pd.DataFrame, div: str,
               as_of: pd.Timestamp | None = None,
               with_context: bool = True) -> LeagueModels:
    d = df[df["Div"] == div]

    goals = fit_ratings(d, "FTHG", "FTAG", as_of=as_of,
                        half_life_days=HALF_LIVES["goals"], use_dc=True)

    corners = None
    if "HC" in d.columns and d["HC"].notna().sum() > 100:
        corners = fit_ratings(d, "HC", "AC", as_of=as_of,
                              half_life_days=HALF_LIVES["corners"])

    cards = None
    if "home_cards" in d.columns and d["home_cards"].notna().sum() > 100:
        cards = fit_ratings(d, "home_cards", "away_cards", as_of=as_of,
                            half_life_days=HALF_LIVES["cards"],
                            ref_col="Referee")

    used = d if as_of is None else d[d["Date"] < as_of]
    lm = LeagueModels(div=div, goals=goals, corners=corners, cards=cards,
                      trained_to=as_of or d["Date"].max(), n_matches=len(used))

    if with_context:
        for attr, cols, cm, name in [
                ("ctx_corners", ("HC", "AC"), corners, "corners"),
                ("ctx_cards", ("home_cards", "away_cards"), cards, "cards")]:
            if cm is None:
                continue
            try:
                setattr(lm, attr, fit_context(used, goals, cm, *cols, name))
            except Exception:
                pass
    return lm


def predict_match(lm: LeagueModels, home: str, away: str,
                  referee: str | None = None,
                  market_odds: dict | None = None,
                  blend_1x2: float = 0.35) -> dict:
    """All market probabilities for one fixture.

    market_odds may contain odds_h/odds_d/odds_a and odds_o25/odds_u25. When
    1X2 odds are present the model is blended toward the de-vigged market,
    which improves calibration a lot on these five leagues.
    """
    lh, la = lm.goals.expected(home, away)
    m = score_matrix(lh, la, rho=lm.goals.rho, use_dc=True)

    probs: dict[str, float] = {}
    o = mk.outcome_probs(m)

    if market_odds and all(market_odds.get(k) for k in ("odds_h", "odds_d", "odds_a")):
        fair = devig_power([market_odds["odds_h"], market_odds["odds_d"],
                            market_odds["odds_a"]])
        vec = blend([o["home"], o["draw"], o["away"]], fair, blend_1x2)
        o = {"home": vec[0], "draw": vec[1], "away": vec[2]}

    probs.update(o)
    probs["home_or_draw"] = o["home"] + o["draw"]
    probs["away_or_draw"] = o["away"] + o["draw"]
    probs["home_or_away"] = o["home"] + o["away"]
    probs.update(mk.over_under(m, mk.DEFAULT_GOAL_LINES))
    probs.update(mk.btts(m))

    out = {
        "home": home, "away": away, "div": lm.div, "referee": referee,
        "xg_home": round(lh, 2), "xg_away": round(la, 2),
        "top_scores": mk.correct_scores(m),
        "probs": probs,
    }

    if lm.corners:
        ch, ca = lm.corners.expected(home, away)
        if lm.ctx_corners:
            ch, ca = lm.ctx_corners.apply(ch, ca, lh - la, lh + la)
        cm = score_matrix(ch, ca, max_goals=25)
        cprobs = {f"corners_{k}": v
                  for k, v in mk.over_under(cm, mk.DEFAULT_CORNER_LINES).items()}
        hcap = mk.handicap_line(cm)
        cprobs["corners_home_more"] = hcap["home_more"]
        cprobs["corners_away_more"] = hcap["away_more"]
        probs.update(cprobs)
        out["exp_corners"] = round(ch + ca, 2)

    if lm.cards:
        kh, ka = lm.cards.expected(home, away, referee=referee)
        if lm.ctx_cards:
            kh, ka = lm.ctx_cards.apply(kh, ka, lh - la, lh + la)
        km = score_matrix(kh, ka, max_goals=12)
        kprobs = {f"cards_{k}": v
                  for k, v in mk.over_under(km, mk.DEFAULT_CARD_LINES).items()}
        for line in (25.5, 35.5, 45.5, 55.5):
            p = mk.booking_points_over(kh, ka, line)
            kprobs[f"points_over_{line}"] = p
            kprobs[f"points_under_{line}"] = 1 - p
        probs.update(kprobs)
        out["exp_cards"] = round(kh + ka, 2)
        out["ref_factor"] = round(lm.cards.ref_factor.get(referee, 1.0), 2) \
            if referee else None

    out["probs"] = {k: round(float(v), 4) for k, v in probs.items()}
    return out
