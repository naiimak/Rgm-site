"""Odds, margin removal, expected value and stake sizing.

This is the part that decides whether you bet, and it matters more than the
model. A model that is 2% better than the market makes money; the same model
staked badly does not.
"""

from __future__ import annotations

import numpy as np


def implied(odds) -> np.ndarray:
    return 1.0 / np.asarray(odds, dtype=float)


def overround(odds) -> float:
    """Bookmaker margin. 1.05 means a 5% book."""
    return float(implied(odds).sum())


def devig_power(odds, tol: float = 1e-10) -> np.ndarray:
    """Remove the margin with the power method.

    Better than dividing by the overround, which over-corrects favourites and
    under-corrects longshots. Solves for k in sum(p_i^k) = 1.
    """
    p = implied(odds)
    lo, hi = 0.5, 3.0
    for _ in range(200):
        k = (lo + hi) / 2
        s = np.sum(p ** k)
        if abs(s - 1.0) < tol:
            break
        if s > 1.0:
            lo = k
        else:
            hi = k
    q = p ** k
    return q / q.sum()


def devig_multiplicative(odds) -> np.ndarray:
    p = implied(odds)
    return p / p.sum()


def blend(model_p: np.ndarray, market_p: np.ndarray, w: float) -> np.ndarray:
    """Shrink the model toward the de-vigged market.

    w=0 trusts the model completely, w=1 just copies the market. Somewhere
    around 0.3-0.5 usually calibrates best on 1X2 in the top five leagues,
    because those markets are very efficient. Use w=0 for corners and cards.
    """
    p = (1 - w) * np.asarray(model_p, float) + w * np.asarray(market_p, float)
    return p / p.sum()


def expected_value(p: float, odds: float) -> float:
    """Profit per unit staked. 0.04 means a 4% edge."""
    return p * odds - 1.0


def kelly(p: float, odds: float, fraction: float = 0.25,
          cap: float = 0.02) -> float:
    """Fractional Kelly stake as a share of bankroll, hard-capped.

    Full Kelly is mathematically optimal only if your probabilities are exactly
    right. They are not, so quarter-Kelly with a 2% cap is the sane default.
    """
    b = odds - 1.0
    if b <= 0:
        return 0.0
    f = (p * b - (1 - p)) / b
    return float(min(max(f, 0.0) * fraction, cap))


def find_value(probs: dict[str, float],
               odds: dict[str, float],
               min_edge: float = 0.04,
               min_odds: float = 1.30,
               max_odds: float = 8.0,
               fraction: float = 0.25) -> list[dict]:
    """Every selection whose expected value clears the threshold.

    min_edge exists because your probabilities carry error. Betting at a 1%
    modelled edge is betting on your own noise.
    """
    bets = []
    for key, o in odds.items():
        if o is None or not np.isfinite(o) or not (min_odds <= o <= max_odds):
            continue
        p = probs.get(key)
        if p is None:
            continue
        ev = expected_value(p, o)
        if ev >= min_edge:
            bets.append({
                "selection": key,
                "model_prob": round(p, 4),
                "odds": float(o),
                "fair_odds": round(1 / p, 2) if p > 0 else None,
                "edge": round(ev, 4),
                "stake_pct": round(kelly(p, o, fraction) * 100, 2),
            })
    return sorted(bets, key=lambda b: -b["edge"])
