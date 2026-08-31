# Football Edge

Prices matches in the top five European leagues across four markets — match
result, goals (over/under and both teams to score), corners, and cards — then
compares those prices to the bookmaker's and flags where you have an edge.

## Setup

```bash
pip install -r requirements.txt
streamlit run app.py
```

First run downloads about seven seasons per league from football-data.co.uk and
caches them in `cache/`. That takes a minute or two; after that it is instant.
The season window ends at whichever season is currently in progress, so the
defaults do not go stale as the calendar moves on.

Some divisions publish the current season's file only once a few matches have
been played. A season that is not up yet is skipped with a note rather than
failing the load.

## How it works

Everything rests on one idea used three times. Goals, corners and cards are all
pairs of counts, so each gets the same model:

```
log(expected home count) = base + attack(home) + defence(away) + home advantage
log(expected away count) = base + attack(away) + defence(home)
```

Fitted by maximum likelihood with exponential time decay, so recent matches
carry more weight than old ones. Three details matter:

- **Dixon-Coles correction** on goals. Plain Poisson under-predicts 0-0 and 1-1,
  which means it systematically misprices the draw. The correction fixes it.
- **Separate home and away parameters.** Home advantage is fitted, not assumed,
  and it differs by league.
- **Referee adjustment on cards.** A referee's card rate relative to what the
  teams alone imply, shrunk toward neutral by how many matches you have seen him
  do. This is the single biggest edge available in the cards market and most
  people ignore it.

From the fitted rates the code builds a joint distribution over scorelines and
reads every market off it: 1X2, double chance, over/under any line, both teams
to score, correct score, corner totals, most corners, card totals, and booking
points at 10 per yellow and 25 per red.

A bet is placed only when `probability × odds − 1` clears your minimum edge.
Stakes are quarter-Kelly, capped at 2% of bankroll.

## Files

| File | What it does |
|---|---|
| `footy/data.py` | Downloads and caches results, corners, cards, referees, closing odds |
| `footy/ratings.py` | The rating engine — Dixon-Coles and Poisson fitting |
| `footy/markets.py` | Turns count distributions into market probabilities |
| `footy/betting.py` | Margin removal, expected value, Kelly staking |
| `footy/predict.py` | Fits all three models per league and prices a fixture |
| `footy/backtest.py` | Walk-forward testing and calibration |
| `app.py` | The dashboard |

## Reading the dashboard

On the fixtures tab, the filled bar is the model's probability and the vertical
tick is the bookmaker's, with their margin removed. When the bar runs past the
tick, you have a modelled edge. The bar turns green when that edge is positive.

## What to expect

Some things worth being clear about before you stake money:

**Accuracy is the wrong target.** The bookmaker's closing odds are the most
accurate football forecast that exists — they absorb team news, injuries,
weather and the opinion of every sharp bettor who moved the line. You can be
very accurate and still lose, because the price already contained your insight.
What matters is whether your probability differs from theirs in the right
direction more often than their margin costs you.

**Check calibration before you check profit.** The backtest tab groups bets by
predicted probability and shows what actually happened. If your 60% bucket wins
48% of the time, no staking plan will rescue it. Fix calibration first.

**Match result in these five leagues is the hardest market on earth.** It is the
most liquid and most heavily modelled market in football. The blend slider
exists because pure model output usually underperforms the market here.

**Corners and cards are where the realistic edge lives.** Books price them with
less care and move them more slowly. The referee factor in this model is a real
informational advantage. The catch is that limits are low and prices move fast
once anyone notices.

**Sample size.** A 3% edge is invisible over 50 bets and only shows over several
hundred. Any conclusion you draw from one month is noise. Expect long losing
runs even when the model is genuinely good — the backtest reports maximum
drawdown for exactly this reason.

**The backtest flatters you.** It assumes you got the closing price on every
selection, that limits were unlimited, and that no line moved against you. Real
results are always worse than backtested ones.

Set aside a fixed bankroll you are willing to lose entirely, and treat this as a
research project that might pay for itself rather than as income.

## The analysis workflow

Your instinct — league card leaders, then last five or six matches split by
venue, then the referee — is the right sequence. Three refinements make it hold
up under money.

**Adjust the league table for schedule.** A raw card table largely ranks teams by
who they played and how often they were losing. `analysis.discipline_table`
divides each team's actual cards by what the model expected for those exact
fixtures. A ratio above 1.0 means genuinely more cards than the schedule
implies. The `signal` column compares the gap to Poisson noise and marks most
teams as noise, which is the honest answer.

**Shrink the recent window.** Six matches of card counts is close to pure noise:
at two cards a game the standard error on a six-match average is around 0.6
cards, larger than the real difference between most teams. `recent_form` reports
the raw average, the long-run average, and a shrunk figure that weights the
recent number by how much of it you can believe. Bet the shrunk one.

**Read the referee before the teams.** On cards markets the official is worth
more than either side. `referee_table` reports cards per match, booking points,
the home/away split, and fouls per card — the last being the better strictness
measure, because it strips out the fact that some officials are handed busier
fixtures. Appointments publish two or three days before kickoff and the market
is often slow to reprice.

Then apply the same shape to every other market:

| Market | Raw number everyone quotes | What to use instead |
|---|---|---|
| Cards | Cards per game | Cards ÷ model expectation; fouls per card |
| Corners | Corners won | Corner share, and shots per corner |
| Goals | Goals scored | Shots on target, and conversion rate |
| Result | Points per game | Shot-on-target difference |

The pattern is the same each time. The count you are betting on is the lagging
indicator; something that happens ten times more often is the leading one, and
it stabilises over a far smaller sample.

`context.py` adds the piece most models miss: corners and cards are consequences
of match shape, not independent events. A one-sided fixture means the favourite
camps in the opposition half — corners rise and tilt heavily to one side — while
a less contested game produces fewer flashpoints and fewer bookings. Those
coefficients are fitted from your data rather than assumed. Print them with
`describe()` and check the signs match that story before trusting the
adjustment.

Use `brief.match_brief` for one fixture and `brief.slate_scan` to rank a whole
matchday by expected cards, corners or goals.

## Where to take it next

1. **Add expected goals.** `soccerdata` pulls Understat and FBref. Fitting
   ratings on xG instead of goals is the single largest accuracy upgrade
   available, because goals are a noisy sample of chances created.
2. **Add a live odds feed.** The Odds API gives corners and cards prices across
   bookmakers, which this model currently cannot see.
3. **Track closing line value.** Log the price you took and the price at kickoff.
   If you consistently beat the closing line, you have a real edge, and you will
   know it months before your profit and loss does.
4. **Team news.** A missing first-choice striker is worth more than any
   refinement to the maths, and no free dataset carries it.

## The scouting layer

The `Scouting` tab and `footy/analysis.py` exist because the obvious way to do
this analysis is subtly wrong in three places.

**Season card leaders are mostly a schedule table.** A team near the top of the
raw list often got there by playing the six most aggressive sides away from
home, or by trailing in half its matches — losing teams chase, foul and get
booked. `discipline_table` divides each team's actual cards by what the model
expected for those exact fixtures and referees. A ratio above 1.0 is a team that
is genuinely dirtier than its schedule implies. The `signal` column marks
whether the gap exceeds two Poisson standard errors; on a full season most teams
come back as noise, which is the honest answer.

**Six matches is not a sample.** At roughly two cards a side per game, the
standard error on a six-match average is about 0.6 — larger than the real
spread between most teams. `recent_form` shows the raw average and the shrunk
one side by side. The shrunk number is the one to use. The model itself never
uses a "last six" window at all; exponential time decay weights every past match
continuously, which is the same idea done properly.

**Home and away splits are real but small.** Away sides take roughly 10-15% more
cards, and that is a league-wide effect, not a per-team one. Fitting a separate
home and away rating for every team doubles your parameters and halves the data
behind each. The model fits one home advantage per league instead, which is more
reliable, and `season_table` still gives you the per-team split to eyeball.

**Referees are the exception — that signal is real.** `referee_table` gives you
cards per match, booking points, reds, the home/away card split, and fouls per
card, which separates the officials who talk to players from the ones who reach
for the pocket. Appointments are published two or three days before kickoff
(PGMOL for the Premier League, the national federations elsewhere) and prices
often do not fully move for them.

### Extending the same thinking to goals, corners and results

The useful generalisation is that **cards and corners are consequences of match
shape, not independent events**, so the goals model should inform them:

- A big mismatch means the favourite camps in the opposition half. Corner totals
  rise and tilt heavily to one side.
- A big mismatch also means a less contested game, so fewer tactical fouls and
  fewer bookings.
- Two evenly matched sides in a tight, low-scoring game is where cards live.

`footy/context.py` fits exactly this: it regresses the corner and card models'
residuals on expected supremacy and expected total goals, both of which the
goals model already produces. Two coefficients each. Run it, print `describe()`,
and check the signs match the story above. On data with no such effect the
coefficients come back near zero and R² near zero, which is the behaviour you
want from something that could otherwise fit noise.

Three more effects in the same family, worth adding next:

1. **Rest days.** `analysis.rest_days` computes them. Under four days between
   matches measurably drags expected goals down, and midweek European fixtures
   are the usual cause. This is the most under-priced schedule effect in
   football because it is invisible in a form table.
2. **Game state.** Half-time scores are in the data (`HTHG`, `HTAG`). Teams
   trailing at the break take more cards and win more corners in the second
   half. You can measure the size of that in your own league in about ten lines.
3. **Motivation late in the season.** A mid-table side with nothing to play for
   in May is a different team from the one that played in October, and no rating
   model built on results alone will notice.
