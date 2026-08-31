"""Load historical match data and upcoming fixtures from football-data.co.uk.

That source is free, needs no API key, and already carries everything the four
target markets need: goals, corners, cards, fouls, shots, referee, and closing
bookmaker odds.
"""

from __future__ import annotations

import os
from typing import Iterable

import pandas as pd

BASE = "https://www.football-data.co.uk/mmz4281"
FIXTURES_URL = "https://www.football-data.co.uk/fixtures.csv"

# Top-5 European leagues, football-data division codes.
LEAGUES = {
    "E0": "Premier League",
    "SP1": "La Liga",
    "I1": "Serie A",
    "D1": "Bundesliga",
    "F1": "Ligue 1",
}

# Columns we keep. Not every season has every one.
KEEP = [
    "Div", "Date", "Time", "HomeTeam", "AwayTeam", "Referee",
    "FTHG", "FTAG", "FTR", "HTHG", "HTAG",
    "HS", "AS", "HST", "AST", "HF", "AF", "HC", "AC", "HY", "AY", "HR", "AR",
]

# Odds columns, in preference order (closing average first, then closing max,
# then pre-match average, then Bet365). Older seasons use the Bb* names.
ODDS_1X2 = [
    ("AvgCH", "AvgCD", "AvgCA"),
    ("MaxCH", "MaxCD", "MaxCA"),
    ("AvgH", "AvgD", "AvgA"),
    ("BbAvH", "BbAvD", "BbAvA"),
    ("B365H", "B365D", "B365A"),
]
ODDS_OU25 = [
    ("AvgC>2.5", "AvgC<2.5"),
    ("Avg>2.5", "Avg<2.5"),
    ("BbAv>2.5", "BbAv<2.5"),
    ("B365>2.5", "B365<2.5"),
]


def _read_csv(source) -> pd.DataFrame:
    """Read one football-data CSV whatever encoding it happens to use.

    The archive is a mix: some season files are plain latin-1, others are UTF-8
    with a byte-order mark, and which is which changes without warning. Reading
    a BOM'd file as latin-1 turns the first header into 'ï»¿Div' rather than
    'Div', so the division column silently disappears and every later
    ``df[df["Div"] == div]`` filter drops that whole season on the floor. No
    error is raised anywhere, so it shows up only as a model quietly fitted on
    less data than you asked for.

    Try UTF-8 first, fall back to latin-1, then strip any BOM left in a header
    so caches written by an earlier version repair themselves on read.
    """
    try:
        df = pd.read_csv(source, encoding="utf-8-sig")
    except UnicodeDecodeError:
        df = pd.read_csv(source, encoding="latin-1")
    df.columns = [str(c).replace("\ufeff", "").replace("ï»¿", "").strip()
                  for c in df.columns]
    return df


def current_season_start(today: pd.Timestamp | None = None) -> int:
    """Calendar year the season now in progress began in.

    European seasons run August to May, so in the first half of a calendar year
    the current season is the one that started the previous August.
    """
    today = pd.Timestamp.today() if today is None else today
    return int(today.year if today.month >= 7 else today.year - 1)


def season_codes(start_year: int, n_seasons: int) -> list[str]:
    """2021 -> '2122'. Returns n_seasons codes ending at the most recent."""
    out = []
    for y in range(start_year, start_year + n_seasons):
        out.append(f"{y % 100:02d}{(y + 1) % 100:02d}")
    return out


def _first_available(df: pd.DataFrame, groups: Iterable[tuple]) -> tuple | None:
    for cols in groups:
        if all(c in df.columns for c in cols):
            sub = df[list(cols)]
            if sub.notna().any().any():
                return cols
    return None


def load_season(div: str, season: str, cache_dir: str = "cache") -> pd.DataFrame:
    """Download (and cache) one division-season."""
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{div}_{season}.csv")
    if os.path.exists(path):
        raw = _read_csv(path)
    else:
        url = f"{BASE}/{season}/{div}.csv"
        raw = _read_csv(url)
        raw.to_csv(path, index=False)

    df = raw.copy()
    df["season"] = season

    cols = [c for c in KEEP if c in df.columns]
    odds_cols = []

    g = _first_available(df, ODDS_1X2)
    if g:
        df[["odds_h", "odds_d", "odds_a"]] = df[list(g)]
        odds_cols += ["odds_h", "odds_d", "odds_a"]

    g = _first_available(df, ODDS_OU25)
    if g:
        df[["odds_o25", "odds_u25"]] = df[list(g)]
        odds_cols += ["odds_o25", "odds_u25"]

    df = df[cols + odds_cols + ["season"]]
    df["Date"] = pd.to_datetime(df["Date"], dayfirst=True, errors="coerce")
    df = df.dropna(subset=["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"])

    for c in ["FTHG", "FTAG", "HC", "AC", "HY", "AY", "HR", "AR", "HS", "AS",
              "HST", "AST", "HF", "AF"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    return df.reset_index(drop=True)


def load_history(divs: Iterable[str] = tuple(LEAGUES),
                 start_year: int | None = None,
                 n_seasons: int = 7,
                 cache_dir: str = "cache") -> pd.DataFrame:
    """Everything we can get, for the given divisions.

    start_year defaults to whatever ends the run at the season now in progress,
    so the window follows the calendar instead of drifting out of date.
    """
    if start_year is None:
        start_year = current_season_start() - n_seasons + 1
    frames = []
    for div in divs:
        for season in season_codes(start_year, n_seasons):
            try:
                frames.append(load_season(div, season, cache_dir))
            except Exception as exc:  # season not published yet, or 404
                print(f"  skip {div} {season}: {type(exc).__name__}")
    if not frames:
        raise RuntimeError("No data downloaded. Check your internet connection.")
    df = pd.concat(frames, ignore_index=True).sort_values("Date")
    return add_derived(df).reset_index(drop=True)


def add_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Totals the market models are fitted on."""
    df = df.copy()
    if "HC" in df.columns:
        df["corners_total"] = df["HC"] + df["AC"]
    # Bookings points: 10 per yellow, 25 per red (standard market convention).
    if "HY" in df.columns:
        df["home_cards"] = df["HY"].fillna(0) + df["HR"].fillna(0)
        df["away_cards"] = df["AY"].fillna(0) + df["AR"].fillna(0)
        df["cards_total"] = df["home_cards"] + df["away_cards"]
        df["booking_points"] = (
            10 * (df["HY"].fillna(0) + df["AY"].fillna(0))
            + 25 * (df["HR"].fillna(0) + df["AR"].fillna(0))
        )
    return df


def load_fixtures(divs: Iterable[str] = tuple(LEAGUES)) -> pd.DataFrame:
    """Upcoming matches for the next ~7 days, with current 1X2 and O/U odds."""
    df = _read_csv(FIXTURES_URL)
    df = df[df["Div"].isin(list(divs))].copy()
    df["Date"] = pd.to_datetime(df["Date"], dayfirst=True, errors="coerce")

    g = _first_available(df, ODDS_1X2)
    if g:
        df[["odds_h", "odds_d", "odds_a"]] = df[list(g)]
    g = _first_available(df, ODDS_OU25)
    if g:
        df[["odds_o25", "odds_u25"]] = df[list(g)]

    # Referee matters here: appointments are published a few days out and the
    # card model applies a per-official multiplier once it knows who it is.
    keep = [c for c in ["Div", "Date", "Time", "HomeTeam", "AwayTeam", "Referee",
                        "odds_h", "odds_d", "odds_a", "odds_o25", "odds_u25"]
            if c in df.columns]
    return df[keep].dropna(subset=["HomeTeam", "AwayTeam"]).reset_index(drop=True)
