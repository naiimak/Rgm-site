"""Turn a joint count distribution into probabilities for each market.

The same three helpers cover goals, corners and cards - a corners over 10.5 bet
is arithmetically the same object as an over 2.5 goals bet, just with a
different matrix underneath.
"""

from __future__ import annotations

import numpy as np

DEFAULT_GOAL_LINES = [1.5, 2.5, 3.5, 4.5]
DEFAULT_CORNER_LINES = [8.5, 9.5, 10.5, 11.5, 12.5]
DEFAULT_CARD_LINES = [2.5, 3.5, 4.5, 5.5, 6.5]


def outcome_probs(m: np.ndarray) -> dict[str, float]:
    """Home win / draw / away win from a score matrix."""
    home = float(np.tril(m, -1).sum())
    draw = float(np.trace(m))
    away = float(np.triu(m, 1).sum())
    return {"home": home, "draw": draw, "away": away}


def over_under(m: np.ndarray, lines) -> dict[str, float]:
    """P(total > line) for each line. Lines must be half-integers."""
    n = m.shape[0]
    tot = np.add.outer(np.arange(n), np.arange(n))
    out = {}
    for ln in lines:
        p_over = float(m[tot > ln].sum())
        out[f"over_{ln}"] = p_over
        out[f"under_{ln}"] = 1.0 - p_over
    return out


def btts(m: np.ndarray) -> dict[str, float]:
    """Both teams to score."""
    p_yes = float(m[1:, 1:].sum())
    return {"btts_yes": p_yes, "btts_no": 1.0 - p_yes}


def correct_scores(m: np.ndarray, top: int = 6) -> list[tuple[str, float]]:
    idx = np.dstack(np.unravel_index(np.argsort(m, axis=None)[::-1], m.shape))[0]
    return [(f"{i}-{j}", float(m[i, j])) for i, j in idx[:top]]


def handicap_line(m: np.ndarray) -> dict[str, float]:
    """Most corners / most cards style markets, plus the tie."""
    return {
        "home_more": float(np.tril(m, -1).sum()),
        "equal": float(np.trace(m)),
        "away_more": float(np.triu(m, 1).sum()),
    }


def booking_points_over(lh: float, la: float, line: float,
                        p_red: float = 0.055, max_cards: int = 12) -> float:
    """P(booking points > line), 10 per yellow and 25 per red.

    Reds are treated as a thinned fraction of each side's card rate, which is
    close enough given how rare they are (roughly 5-6% of all cards).
    """
    from scipy.stats import poisson

    lam_y = (lh + la) * (1 - p_red)
    lam_r = (lh + la) * p_red
    ys = np.arange(max_cards + 1)
    rs = np.arange(5)
    py = poisson.pmf(ys, lam_y)
    pr = poisson.pmf(rs, lam_r)
    pts = np.add.outer(10 * ys, 25 * rs)
    joint = np.outer(py, pr)
    joint = joint / joint.sum()
    return float(joint[pts > line].sum())
