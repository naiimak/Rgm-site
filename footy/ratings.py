"""Rating engines.

One idea, used three times. Every match outcome we care about (goals, corners,
cards) is a pair of counts, one per side. We model each side's expected count as

    log(lambda_home) = base + attack_home + defence_away + home_edge
    log(lambda_away) = base + attack_away + defence_home

fitted by maximum likelihood with exponential time decay, so last month counts
for more than three years ago.

For goals we add the Dixon-Coles low-score correction, which fixes the fact that
plain Poisson underestimates 0-0 and 1-1 and so misprices draws.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import poisson


def _tau(h, a, lh, la, rho):
    """Dixon-Coles dependence correction on the four lowest scorelines."""
    t = np.ones(len(h))
    m = (h == 0) & (a == 0); t[m] = 1.0 - lh[m] * la[m] * rho
    m = (h == 0) & (a == 1); t[m] = 1.0 + lh[m] * rho
    m = (h == 1) & (a == 0); t[m] = 1.0 + la[m] * rho
    m = (h == 1) & (a == 1); t[m] = 1.0 - rho
    return np.clip(t, 1e-9, None)


@dataclass
class RatingModel:
    """Fitted attack/defence ratings for one count type in one league."""

    teams: list[str]
    attack: np.ndarray
    defence: np.ndarray
    home_edge: float
    base: float
    rho: float = 0.0
    use_dc: bool = False
    ref_factor: dict[str, float] = field(default_factory=dict)

    def _idx(self, team: str) -> int | None:
        try:
            return self.teams.index(team)
        except ValueError:
            return None

    def expected(self, home: str, away: str, referee: str | None = None
                 ) -> tuple[float, float]:
        """Expected count for each side. Unknown teams fall back to average."""
        i, j = self._idx(home), self._idx(away)
        ah = self.attack[i] if i is not None else 0.0
        dh = self.defence[i] if i is not None else 0.0
        aa = self.attack[j] if j is not None else 0.0
        da = self.defence[j] if j is not None else 0.0

        lh = np.exp(self.base + ah + da + self.home_edge)
        la = np.exp(self.base + aa + dh)

        if referee and self.ref_factor:
            f = self.ref_factor.get(referee, 1.0)
            lh, la = lh * f, la * f
        return float(lh), float(la)


def fit_ratings(df: pd.DataFrame,
                home_col: str,
                away_col: str,
                *,
                as_of: pd.Timestamp | None = None,
                half_life_days: float = 270.0,
                use_dc: bool = False,
                l2: float = 0.02,
                ref_col: str | None = None) -> RatingModel:
    """Fit one rating model to matches strictly before `as_of`.

    half_life_days controls memory. 270 is a reasonable default for goals;
    corners and cards are more stable, so they tolerate a longer half-life.
    """
    d = df.dropna(subset=[home_col, away_col, "HomeTeam", "AwayTeam", "Date"])
    if as_of is not None:
        d = d[d["Date"] < as_of]
    if len(d) < 60:
        raise ValueError(f"Only {len(d)} matches available - need at least 60.")

    teams = sorted(set(d["HomeTeam"]) | set(d["AwayTeam"]))
    tix = {t: i for i, t in enumerate(teams)}
    n = len(teams)

    hi = d["HomeTeam"].map(tix).to_numpy()
    ai = d["AwayTeam"].map(tix).to_numpy()
    hg = d[home_col].to_numpy(dtype=float)
    ag = d[away_col].to_numpy(dtype=float)

    ref_date = as_of if as_of is not None else d["Date"].max()
    age = (ref_date - d["Date"]).dt.days.to_numpy(dtype=float)
    xi = np.log(2) / half_life_days
    w = np.exp(-xi * np.clip(age, 0, None))

    base0 = np.log(max(np.average(np.r_[hg, ag], weights=np.r_[w, w]), 0.05))

    def unpack(p):
        atk = np.r_[p[:n - 1], -p[:n - 1].sum()]   # sum-to-zero identifiability
        dfn = np.r_[p[n - 1:2 * n - 2], -p[n - 1:2 * n - 2].sum()]
        return atk, dfn, p[2 * n - 2], p[2 * n - 1], (p[2 * n] if use_dc else 0.0)

    def nll(p):
        atk, dfn, home_edge, base, rho = unpack(p)
        lh = np.exp(base + atk[hi] + dfn[ai] + home_edge)
        la = np.exp(base + atk[ai] + dfn[hi])
        lh = np.clip(lh, 1e-6, 25.0)
        la = np.clip(la, 1e-6, 25.0)

        ll = poisson.logpmf(hg, lh) + poisson.logpmf(ag, la)
        if use_dc:
            ll = ll + np.log(_tau(hg, ag, lh, la, rho))
        pen = l2 * (np.sum(atk ** 2) + np.sum(dfn ** 2))
        return -np.sum(w * ll) + pen

    x0 = np.zeros(2 * n)
    x0[2 * n - 2] = 0.25          # home edge
    x0[2 * n - 1] = base0
    bounds = [(-3, 3)] * (2 * n - 2) + [(-1, 1), (-3, 3)]
    if use_dc:
        x0 = np.r_[x0, -0.05]
        bounds = bounds + [(-0.25, 0.25)]

    res = minimize(nll, x0, method="L-BFGS-B", bounds=bounds,
                   options={"maxiter": 800})
    atk, dfn, home_edge, base, rho = unpack(res.x)

    model = RatingModel(teams=teams, attack=atk, defence=dfn,
                        home_edge=float(home_edge), base=float(base),
                        rho=float(rho), use_dc=use_dc)

    if ref_col and ref_col in d.columns:
        model.ref_factor = _referee_factors(d, model, home_col, away_col,
                                            ref_col, w)
    return model


def _referee_factors(d, model, home_col, away_col, ref_col, w,
                     prior_matches: float = 30.0) -> dict[str, float]:
    """How many more (or fewer) cards a referee gives than the teams imply.

    Shrunk toward 1.0 by match count, so a ref with 4 games barely moves.
    """
    tix = {t: i for i, t in enumerate(model.teams)}
    hi = d["HomeTeam"].map(tix).to_numpy()
    ai = d["AwayTeam"].map(tix).to_numpy()
    ok = pd.notna(hi) & pd.notna(ai) & d[ref_col].notna().to_numpy()
    if not ok.any():
        return {}

    hi, ai = hi[ok].astype(int), ai[ok].astype(int)
    wv = np.asarray(w)[ok]
    exp = (np.exp(model.base + model.attack[hi] + model.defence[ai]
                  + model.home_edge)
           + np.exp(model.base + model.attack[ai] + model.defence[hi]))
    act = (d[home_col].to_numpy()[ok] + d[away_col].to_numpy()[ok])

    g = pd.DataFrame({"ref": d[ref_col].to_numpy()[ok],
                      "e": wv * exp, "a": wv * act, "w": wv}).groupby("ref").sum()
    g = g[g["e"] > 0]
    k = g["w"] / (g["w"] + prior_matches)
    factor = np.clip(1.0 + k * (g["a"] / g["e"] - 1.0), 0.6, 1.6)
    return {str(r): float(v) for r, v in factor.items()}


def score_matrix(lh: float, la: float, max_goals: int = 15,
                 rho: float = 0.0, use_dc: bool = False) -> np.ndarray:
    """Joint distribution over (home count, away count)."""
    h = poisson.pmf(np.arange(max_goals + 1), lh)
    a = poisson.pmf(np.arange(max_goals + 1), la)
    m = np.outer(h, a)
    if use_dc and rho != 0.0:
        m[0, 0] *= 1.0 - lh * la * rho
        m[0, 1] *= 1.0 + lh * rho
        m[1, 0] *= 1.0 + la * rho
        m[1, 1] *= 1.0 - rho
        m = np.clip(m, 0, None)
    return m / m.sum()
