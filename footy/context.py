"""The context layer - where corners and cards learn from the goals model.

The idea worth stealing here: cards and corners are not independent of the match
result. They are consequences of match *shape*.

- A big mismatch means the favourite camps in the opposition half. Corners go
  up, and they go up almost entirely on one side.
- A big mismatch also means a less contested game. Fewer tactical fouls, fewer
  flashpoints, fewer cards.
- A tight game between evenly matched sides is where bookings live.

So instead of modelling corners and cards in isolation, this fits a small
correction on top of them using two quantities the goals model already gives
you for free: expected supremacy (how one-sided) and expected total goals (how
open). Two coefficients each, fitted by least squares on the residuals.

Fit it, print the coefficients, and check they have the sign the theory
predicts. If they do not, the effect is not there in your league and you should
leave the adjustment off rather than fit noise.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class ContextModel:
    metric: str
    total_coef: np.ndarray      # [const, |supremacy|, total goals]
    share_coef: np.ndarray      # [const, supremacy]
    r2_total: float
    n: int

    def describe(self) -> str:
        c = self.total_coef
        return (f"{self.metric}: total responds {c[1]:+.3f} per goal of "
                f"supremacy and {c[2]:+.3f} per goal of expected total "
                f"(R²={self.r2_total:.3f}, n={self.n}); share tilts "
                f"{self.share_coef[1]:+.3f} per goal of supremacy")

    def apply(self, lh: float, la: float, supremacy: float,
              total_goals: float) -> tuple[float, float]:
        """Rescale a count model's output for the shape of this match."""
        x = np.array([1.0, abs(supremacy), total_goals])
        mult = float(np.exp(np.clip(self.total_coef @ x, -0.5, 0.5)))
        total = (lh + la) * mult

        tilt = float(np.clip(self.share_coef @ np.array([1.0, supremacy]),
                             -0.8, 0.8))
        ratio = (lh / max(la, 1e-6)) * np.exp(tilt)
        share_h = ratio / (1 + ratio)
        return total * share_h, total * (1 - share_h)


def fit_context(df: pd.DataFrame, goals_model, count_model,
                home_col: str, away_col: str, metric: str) -> ContextModel:
    """Regress the count model's error on match shape."""
    d = df.dropna(subset=[home_col, away_col, "HomeTeam", "AwayTeam"])
    if len(d) < 200:
        raise ValueError(f"Need at least 200 matches to fit context, got {len(d)}.")

    sup, tot, ratio_obs, ratio_exp, share_obs, share_exp = [], [], [], [], [], []
    for _, r in d.iterrows():
        gh, ga = goals_model.expected(r["HomeTeam"], r["AwayTeam"])
        ch, ca = count_model.expected(r["HomeTeam"], r["AwayTeam"])
        act_h, act_a = float(r[home_col]), float(r[away_col])
        if ch + ca <= 0:
            continue
        sup.append(gh - ga)
        tot.append(gh + ga)
        ratio_obs.append(act_h + act_a)
        ratio_exp.append(ch + ca)
        share_obs.append(np.log((act_h + 0.5) / (act_a + 0.5)))
        share_exp.append(np.log((ch + 0.5) / (ca + 0.5)))

    sup = np.array(sup); tot = np.array(tot)
    y_total = np.log(np.clip(np.array(ratio_obs), 0.5, None)
                     / np.array(ratio_exp))
    X_total = np.column_stack([np.ones_like(sup), np.abs(sup), tot])
    beta, *_ = np.linalg.lstsq(X_total, y_total, rcond=None)
    resid = y_total - X_total @ beta
    r2 = 1 - resid.var() / y_total.var() if y_total.var() > 0 else 0.0

    y_share = np.array(share_obs) - np.array(share_exp)
    X_share = np.column_stack([np.ones_like(sup), sup])
    gamma, *_ = np.linalg.lstsq(X_share, y_share, rcond=None)

    return ContextModel(metric=metric, total_coef=beta, share_coef=gamma,
                        r2_total=float(r2), n=len(sup))
