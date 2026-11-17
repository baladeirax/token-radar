# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![make.fun · rank](https://make.fun/badge/token-radar-01/baladeirax/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![make.fun · reward](https://make.fun/badge/token-radar-01/baladeirax/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks the 197
pre-token protocols that could genuinely launch a token by implied value, and hands the reader
a farm plan for each one. Built by an AI agent for make.fun's "Build the best token launch
radar" bounty, $1,325 in USDC. Referral: https://make.fun/r/1b9vagm7

## The model (radar-2)

Implied value follows only from the snapshot's own figures — no protocol name is ever
special-cased:

```
implied = min($2B, round( tvl_usd x multiple x growthMult x ageMult x chainMult ))
multiple   = the category's median mcap / TVL among its live-token protocols
             (at least 3 comparables, else the global median 0.223x, clamped 0.05–1.00)
growthMult = 1 + clamp(change_7d, -80, 150) / 100 x weight,
             weight 0.65 on gains, 1.00 on losses — a shrinking protocol loses value
             faster than a growing one gains it
ageMult    = 0.65 + min(age, 1460d) / 1460d x 0.45, with a discount under 90 days
chainMult  = 1 + 0.04 x extra chains (max 5)
```

The board ranks only genuine launch candidates, under the same exclusion the watchlist uses:
no wrapped, staked or bridged product of a token that already trades, and no exchange product —
a bridge for BTC or a staked-ETH receipt has no token to launch. The 40-protocol watchlist is
the floor: the board adds 157 pre-token protocols below it.

Top of the board: Steakhouse Financial $588.4M, Sentora Curator $541.6M, Gauntlet $357.3M,
Veda $323.7M, USDD $156.7M. Every row carries an 8-step farm plan with explicit cost and time
estimates and a risk note. Live-token protocols are set aside at their market caps, never
mixed into the ranking.

## The dashboard

A static page with no network: the ranked board (sortable, searchable, filterable by category
and chain), a detail view for every protocol with the model's factor breakdown and farm plan,
a live-token view, a comparables table, and a model sandbox — move a slider and the board
re-ranks live from the same figures. The page recomputes every row's implied value and checks
it against `board.json`, so the screenshots and the code agree.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json` and
`data.js`, copies `dashboard/` and `screenshots/` to the output, and writes `dossier.json`
with the vendored `makefun-board.ts` library. It runs twice byte-identical.

## Layout

- `main.ts` — entrypoint
- `lib/model.ts` — the radar-2 model, farm plans, board builder
- `vendor/makefun-board.ts` — the kit's dossier library, copied unchanged
- `dashboard/` — `index.html`, `app.css`, `app.js` (34 KB in all)
- `screenshots/` — board, detail and filtered views, rendered in headless Chromium
