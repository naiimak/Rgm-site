"""Football Edge - a dashboard for pricing matches against the book.

Run with:  streamlit run app.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import streamlit as st

from footy import analysis as an
from footy import backtest, data
from footy.betting import devig_power, find_value, kelly
from footy.brief import format_brief, match_brief, slate_scan
from footy.predict import fit_league, predict_match

st.set_page_config(page_title="Football Edge", layout="wide",
                   initial_sidebar_state="expanded")

# --- Visual system ----------------------------------------------------------
# Pools-coupon palette: grey-green paper, slate ink, one green for edge.
CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap');

:root {
  --paper:#EDEEE8; --panel:#FFFFFF; --ink:#1B2A32; --muted:#6E7A80;
  --rule:#CDD0C6; --edge:#0F7350; --warn:#9C3B33; --market:#4A6572;
}
html, body, [class*="css"], .stApp { background:var(--paper); color:var(--ink);
  font-family:'Archivo',system-ui,sans-serif; font-variant-numeric:tabular-nums; }
h1,h2,h3 { font-family:'Archivo',sans-serif; letter-spacing:-.02em;
  font-weight:600; color:var(--ink); }
h1 { font-size:2.1rem; margin-bottom:.1rem; }
.sub { color:var(--muted); font-size:.92rem; margin-bottom:1.4rem; }

.fixture { background:var(--panel); border:1px solid var(--rule);
  padding:14px 16px; margin-bottom:10px; }
.fx-head { display:flex; justify-content:space-between; align-items:baseline;
  border-bottom:1px solid var(--rule); padding-bottom:8px; margin-bottom:10px; }
.fx-teams { font-size:1.05rem; font-weight:600; }
.fx-meta { color:var(--muted); font-size:.82rem; }

/* The signature element: model probability as a bar, market as a tick. */
.row { display:grid; grid-template-columns:150px 1fr 62px 62px;
  align-items:center; gap:12px; padding:5px 0; font-size:.86rem; }
.sel { color:var(--ink); }
.track { position:relative; height:9px; background:#E2E4DC; }
.bar { position:absolute; left:0; top:0; bottom:0; background:var(--market); }
.bar.value { background:var(--edge); }
.tick { position:absolute; top:-4px; bottom:-4px; width:2px;
  background:var(--ink); }
.num { text-align:right; color:var(--muted); }
.num.pos { color:var(--edge); font-weight:600; }

.bet { border-left:3px solid var(--edge); background:var(--panel);
  padding:10px 14px; margin-bottom:8px; }
.bet .big { font-weight:600; }
.note { background:#E4E7DE; border-left:3px solid var(--market);
  padding:10px 14px; font-size:.86rem; color:var(--ink); margin-bottom:14px; }
[data-testid="stSidebar"] { background:#E4E6DE; border-right:1px solid var(--rule); }
</style>
"""
st.markdown(CSS, unsafe_allow_html=True)


# --- Data and models --------------------------------------------------------
@st.cache_data(show_spinner="Downloading match history…", ttl=60 * 60 * 6)
def get_history(divs: tuple, start_year: int, n_seasons: int) -> pd.DataFrame:
    return data.load_history(divs, start_year, n_seasons)


@st.cache_resource(show_spinner="Fitting models…")
def get_models(_df: pd.DataFrame, div: str, stamp: str):
    return fit_league(_df, div)


@st.cache_data(ttl=60 * 30, show_spinner=False)
def get_fixtures(divs: tuple) -> pd.DataFrame:
    return data.load_fixtures(divs)


def bar_row(label: str, p: float, odds: float | None,
            market_p: float | None = None) -> str:
    """One selection: model bar, market tick, price, edge."""
    ev = (p * odds - 1) if odds and np.isfinite(odds) else None
    value = ev is not None and ev > 0
    tick = (f'<div class="tick" style="left:{min(market_p,1)*100:.1f}%"></div>'
            if market_p else "")
    ev_txt = f"{ev*100:+.1f}%" if ev is not None else "—"
    return (
        f'<div class="row"><div class="sel">{label}</div>'
        f'<div class="track"><div class="bar {"value" if value else ""}" '
        f'style="width:{min(p,1)*100:.1f}%"></div>{tick}</div>'
        f'<div class="num">{p*100:.1f}%</div>'
        f'<div class="num {"pos" if value else ""}">{ev_txt}</div></div>'
    )


# --- Sidebar ----------------------------------------------------------------
st.sidebar.markdown("### Setup")
league_names = st.sidebar.multiselect(
    "Leagues", list(data.LEAGUES.values()),
    default=["Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1"])
divs = tuple(k for k, v in data.LEAGUES.items() if v in league_names) or ("E0",)

n_seasons = st.sidebar.slider("Seasons of history", 3, 10, 7)
latest_season = data.current_season_start()
start_year = st.sidebar.number_input(
    "First season starts", 2010, latest_season,
    latest_season - int(n_seasons) + 1,
    help="Defaults so the window ends at the season now in progress.")

st.sidebar.markdown("### Betting rules")
min_edge = st.sidebar.slider("Minimum edge to bet", 0.0, 0.20, 0.05, 0.01,
                             help="Your probabilities have error. Betting a 1% "
                                  "modelled edge is betting on your own noise.")
blend_w = st.sidebar.slider("Blend toward market (1X2)", 0.0, 1.0, 0.35, 0.05,
                            help="0 trusts the model alone. These leagues are "
                                 "very efficient, so some shrinkage usually "
                                 "improves calibration.")
frac = st.sidebar.slider("Kelly fraction", 0.05, 1.0, 0.25, 0.05)
bankroll = st.sidebar.number_input("Bankroll", 50, 1_000_000, 1000, step=50)

if st.sidebar.button("Clear cached data"):
    st.cache_data.clear()
    st.cache_resource.clear()
    st.rerun()

st.markdown("# Football Edge")
st.markdown('<div class="sub">Model prices versus bookmaker prices. '
            'The bar is the model, the tick is the market. Bet the gap.</div>',
            unsafe_allow_html=True)

try:
    hist = get_history(divs, int(start_year), int(n_seasons))
except Exception as exc:
    st.error(f"Could not load data: {exc}")
    st.stop()

stamp = str(hist["Date"].max().date())
tab_week, tab_match, tab_scout, tab_test = st.tabs(
    ["This week", "Price a match", "Scouting", "Backtest"])


# --- Tab 1: upcoming fixtures ----------------------------------------------
with tab_week:
    try:
        fx = get_fixtures(divs)
    except Exception as exc:
        st.warning(f"Fixture list unavailable: {exc}")
        fx = pd.DataFrame()

    if fx.empty:
        st.info("No upcoming fixtures published for these leagues right now. "
                "football-data posts them a few days before each round.")
    else:
        st.caption(f"{len(fx)} fixtures · models trained through {stamp}")
        all_bets = []
        for div in fx["Div"].unique():
            try:
                lm = get_models(hist, div, stamp)
            except Exception as exc:
                st.warning(f"{div}: {exc}")
                continue

            for _, row in fx[fx["Div"] == div].iterrows():
                pred = predict_match(lm, row["HomeTeam"], row["AwayTeam"],
                                     referee=row.get("Referee"),
                                     market_odds=row.to_dict(),
                                     blend_1x2=blend_w)
                p = pred["probs"]
                odds = {k: row.get(c) for k, c in
                        [("home", "odds_h"), ("draw", "odds_d"),
                         ("away", "odds_a"), ("over_2.5", "odds_o25"),
                         ("under_2.5", "odds_u25")]}
                fair = None
                if all(odds.get(k) for k in ("home", "draw", "away")):
                    fair = dict(zip(["home", "draw", "away"],
                                    devig_power([odds["home"], odds["draw"],
                                                 odds["away"]])))

                labels = {"home": row["HomeTeam"], "draw": "Draw",
                          "away": row["AwayTeam"],
                          "over_2.5": "Over 2.5 goals",
                          "under_2.5": "Under 2.5 goals"}
                rows_html = "".join(
                    bar_row(labels[k], p[k], odds.get(k),
                            fair.get(k) if fair else None)
                    for k in labels if k in p)

                date_txt = (row["Date"].strftime("%a %d %b")
                            if pd.notna(row["Date"]) else "")
                ref_txt = (f' · ref {row["Referee"]}'
                           if pd.notna(row.get("Referee")) else "")
                st.markdown(
                    f'<div class="fixture"><div class="fx-head">'
                    f'<div class="fx-teams">{row["HomeTeam"]} v {row["AwayTeam"]}</div>'
                    f'<div class="fx-meta">{data.LEAGUES.get(div, div)} · {date_txt} · '
                    f'xG {pred["xg_home"]}–{pred["xg_away"]} · '
                    f'corners {pred.get("exp_corners","–")} · '
                    f'cards {pred.get("exp_cards","–")}{ref_txt}</div></div>'
                    f'{rows_html}</div>', unsafe_allow_html=True)

                for b in find_value(p, {k: v for k, v in odds.items() if v},
                                    min_edge=min_edge, fraction=frac):
                    b["match"] = f'{row["HomeTeam"]} v {row["AwayTeam"]}'
                    b["selection"] = labels.get(b["selection"], b["selection"])
                    all_bets.append(b)

        with st.expander("Scan the whole slate"):
            st.markdown('<div class="note">Sorting the matchday by expected '
                        'cards or corners and reading the top and bottom five '
                        'finds a mispriced game faster than opening twenty '
                        'briefs in fixture order.</div>',
                        unsafe_allow_html=True)
            scan_metric = st.selectbox("Sort by", ["cards", "corners", "goals"],
                                       key="scanmetric")
            models = {}
            for dv in fx["Div"].unique():
                try:
                    models[dv] = get_models(hist, dv, stamp)
                except Exception:
                    pass
            st.dataframe(slate_scan(hist, models, fx, scan_metric),
                         hide_index=True, width="stretch")

        st.markdown("### Selections clearing your threshold")
        if not all_bets:
            st.markdown('<div class="note">Nothing qualifies. That is the '
                        'normal result — most weeks the book is right and the '
                        'correct action is no bet.</div>',
                        unsafe_allow_html=True)
        else:
            for b in sorted(all_bets, key=lambda x: -x["edge"]):
                st.markdown(
                    f'<div class="bet"><span class="big">{b["selection"]}</span>'
                    f' — {b["match"]}<br>'
                    f'<span class="fx-meta">Price {b["odds"]} · fair '
                    f'{b["fair_odds"]} · edge {b["edge"]*100:.1f}% · stake '
                    f'{b["stake_pct"]}% of bankroll '
                    f'({bankroll * b["stake_pct"] / 100:.0f})</span></div>',
                    unsafe_allow_html=True)


# --- Tab 2: manual pricing --------------------------------------------------
with tab_match:
    st.markdown('<div class="note">football-data carries odds for match result '
                'and over/under 2.5 only. For corners and cards, read the price '
                'off your bookmaker and type it in here.</div>',
                unsafe_allow_html=True)

    div = st.selectbox("League", divs,
                       format_func=lambda d: data.LEAGUES.get(d, d))
    lm = get_models(hist, div, stamp)
    teams = lm.goals.teams
    c1, c2, c3 = st.columns(3)
    home = c1.selectbox("Home", teams, index=0)
    away = c2.selectbox("Away", teams, index=min(1, len(teams) - 1))
    refs = sorted(lm.cards.ref_factor) if lm.cards else []
    ref = c3.selectbox("Referee", ["(unknown)"] + refs)
    ref = None if ref == "(unknown)" else ref

    if home == away:
        st.warning("Pick two different teams.")
    else:
        pred = predict_match(lm, home, away, referee=ref, blend_1x2=0.0)
        p = pred["probs"]

        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Expected goals", f'{pred["xg_home"]}–{pred["xg_away"]}')
        m2.metric("Expected corners", pred.get("exp_corners", "–"))
        m3.metric("Expected cards", pred.get("exp_cards", "–"))
        m4.metric("Referee factor", pred.get("ref_factor") or "–")

        with st.expander("Full match brief", expanded=True):
            st.markdown(format_brief(
                match_brief(hist, lm, home, away, referee=ref, n=6)))

        st.markdown("#### Enter the prices you can actually get")
        selections = {
            home: "home", "Draw": "draw", away: "away",
            "Over 2.5 goals": "over_2.5", "Under 2.5 goals": "under_2.5",
            "Both teams to score": "btts_yes",
            "Over 9.5 corners": "corners_over_9.5",
            "Over 10.5 corners": "corners_over_10.5",
            "Over 3.5 cards": "cards_over_3.5",
            "Over 4.5 cards": "cards_over_4.5",
            "Over 35.5 booking points": "points_over_35.5",
        }
        entered = {}
        cols = st.columns(3)
        for i, (label, key) in enumerate(selections.items()):
            if key not in p:
                continue
            v = cols[i % 3].number_input(
                f'{label}  ·  fair {1/max(p[key],1e-6):.2f}',
                min_value=0.0, max_value=50.0, value=0.0, step=0.05,
                key=f"odds_{key}")
            if v > 1.0:
                entered[key] = v

        if entered:
            bets = find_value(p, entered, min_edge=min_edge, fraction=frac)
            st.markdown("#### Verdict")
            if not bets:
                st.markdown('<div class="note">No selection clears your '
                            'threshold at those prices.</div>',
                            unsafe_allow_html=True)
            rev = {v: k for k, v in selections.items()}
            for b in bets:
                st.markdown(
                    f'<div class="bet"><span class="big">'
                    f'{rev.get(b["selection"], b["selection"])}</span> at '
                    f'{b["odds"]}<br><span class="fx-meta">Model '
                    f'{b["model_prob"]*100:.1f}% · fair {b["fair_odds"]} · '
                    f'edge {b["edge"]*100:.1f}% · stake '
                    f'{bankroll * b["stake_pct"] / 100:.0f}</span></div>',
                    unsafe_allow_html=True)

        with st.expander("Most likely scorelines"):
            st.dataframe(pd.DataFrame(pred["top_scores"],
                                      columns=["Score", "Probability"]),
                         hide_index=True, width="stretch")


# --- Tab 3: scouting tables -------------------------------------------------
with tab_scout:
    s_div = st.selectbox("League  ", divs, key="scoutdiv",
                         format_func=lambda d: data.LEAGUES.get(d, d))
    sd = hist[hist["Div"] == s_div]
    slm = get_models(hist, s_div, stamp)
    seasons = sorted(sd["season"].astype(str).unique())
    season = st.selectbox("Season", ["All"] + seasons,
                          index=len(seasons))
    season_arg = None if season == "All" else season

    st.markdown("#### Discipline, adjusted for schedule")
    st.markdown('<div class="note">The raw card table mostly ranks teams by who '
                'they played and how often they were losing. This divides actual '
                'cards by what the model expected for those exact fixtures. '
                'Ratio above 1.0 means dirtier than the schedule implies — and '
                'the signal column tells you whether the gap is bigger than '
                'Poisson noise. Most of them are not.</div>',
                unsafe_allow_html=True)
    try:
        disc = an.discipline_table(sd, slm.cards, season_arg)
        st.dataframe(disc.reset_index(), hide_index=True, width="stretch")
    except Exception as exc:
        st.warning(str(exc))

    c1, c2 = st.columns(2)
    with c1:
        st.markdown("#### Season totals by venue")
        metric = st.selectbox("Metric", ["cards", "corners", "goals", "points",
                                         "fouls", "yellow"])
        try:
            st.dataframe(an.season_table(sd, metric, season_arg).reset_index(),
                         hide_index=True, width="stretch")
        except Exception as exc:
            st.warning(str(exc))
    with c2:
        st.markdown("#### Referees")
        st.markdown('<div class="note">Officials are usually announced two or '
                    'three days before kickoff. The factor column is the '
                    'shrunk multiplier the card model applies.</div>',
                    unsafe_allow_html=True)
        rt = an.referee_table(sd, slm.cards, min_matches=8)
        st.dataframe(rt.reset_index(), hide_index=True, width="stretch")

    st.markdown("#### Recent form, raw against shrunk")
    st.markdown('<div class="note">Six matches of card counts is close to pure '
                'noise: the standard error on a six-match average is bigger '
                'than any real difference between two teams. Compare the two '
                'columns before trusting a hot streak.</div>',
                unsafe_allow_html=True)
    f1, f2, f3 = st.columns(3)
    team = f1.selectbox("Team", slm.goals.teams)
    fmetric = f2.selectbox("Metric ", ["cards", "corners", "goals"])
    fvenue = f3.selectbox("Venue", ["all", "home", "away"])
    form = an.recent_form(sd, team, fmetric, n=6,
                          venue=None if fvenue == "all" else fvenue)
    g1, g2, g3 = st.columns(3)
    g1.metric("Last 6 average", form["recent_avg"])
    g2.metric("Long-run average", form["long_run_avg"])
    g3.metric("Use this", form["shrunk"])
    st.dataframe(form["log"], hide_index=True, width="stretch")

    if slm.ctx_corners or slm.ctx_cards:
        with st.expander("How match shape moves corners and cards"):
            st.markdown("A one-sided match means the favourite camps in the "
                        "opposition half, so corners rise and tilt to one side, "
                        "while a less contested game produces fewer bookings. "
                        "These coefficients are fitted from your data, not "
                        "assumed. If the signs contradict that story, the "
                        "effect is not in your league and the adjustment is "
                        "doing nothing useful.")
            for c in (slm.ctx_corners, slm.ctx_cards):
                if c:
                    st.code(c.describe())


# --- Tab 4: backtest --------------------------------------------------------
with tab_test:
    st.markdown('<div class="note">Refits the model every N days using only '
                'matches already played, then prices the fixtures ahead of it. '
                'Judge it on return on investment and on the calibration table, '
                'never on hit rate.</div>', unsafe_allow_html=True)

    b1, b2, b3 = st.columns(3)
    bt_div = b1.selectbox("League ", divs, key="btdiv",
                          format_func=lambda d: data.LEAGUES.get(d, d))
    default_start = (hist["Date"].max() - pd.Timedelta(days=540)).date()
    bt_start = b2.date_input("Test from", default_start)
    refit = b3.slider("Refit every (days)", 3, 30, 7)

    if st.button("Run backtest"):
        with st.spinner("Walking forward…"):
            try:
                log, summary = backtest.run(
                    hist, bt_div, str(bt_start), refit_days=refit,
                    min_edge=min_edge, blend_1x2=blend_w, fraction=frac,
                    bankroll=float(bankroll))
            except Exception as exc:
                st.error(str(exc))
                st.stop()

        if log.empty:
            st.info(summary.get("note", "No qualifying bets."))
        else:
            k = list(summary.items())
            cols = st.columns(5)
            for i, (name, val) in enumerate(k[:10]):
                cols[i % 5].metric(name.replace("_", " "), val)
            st.line_chart(log.set_index("date")["bankroll"])
            st.markdown("#### Calibration")
            log["bucket"] = pd.cut(log["model_prob"], np.linspace(0, 1, 11))
            cal = (log.groupby("bucket", observed=True)
                   .agg(bets=("won", "size"), predicted=("model_prob", "mean"),
                        actual=("won", "mean")).round(3).reset_index())
            st.dataframe(cal, hide_index=True, width="stretch")
            st.markdown("#### Every bet")
            st.dataframe(log.drop(columns=["bucket"]), hide_index=True,
                         width="stretch")
