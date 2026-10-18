// DraftKings points for one finished game, from the box-score fields on NFLDepthCharts' game log. Pure (the site runs
// it too, so it cannot import dk-scoring.js, which reads files); tests/playercard-resolve.test.mjs checks it against
// dk-scoring.js offensePoints. Offense only: the log has no return, two-point or fumble-recovery figures, so those
// score nothing here (the card's column header says so). The table is PROJECT.md Part 4 "DraftKings scoring".
const SCORING = Object.freeze({
  passYd: 0.04, passTd: 4, passInt: -1, pass300: 3, pass300Line: 300,
  rushYd: 0.1, rushTd: 6, rush100: 3, rush100Line: 100,
  rec: 1, recYd: 0.1, recTd: 6, rec100: 3, rec100Line: 100,
  fumLost: -1,
});

// The log keeps only non-zero numbers, so a stat missing from a game's stats object is a real 0 (a played game).
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** DraftKings offence points for one game's `stats` object ({passing_yards, rushing_tds, ...}); a number, unrounded. */
export function dkGamePoints(stats) {
  const s = stats ?? {};
  const passYd = n(s.passing_yards);
  const rushYd = n(s.rushing_yards);
  const recYd = n(s.receiving_yards);
  const bonus = (yards, line, worth) => (yards > 0 && yards >= line ? worth : 0);
  return passYd * SCORING.passYd
    + n(s.passing_tds) * SCORING.passTd
    + n(s.passing_interceptions) * SCORING.passInt
    + bonus(passYd, SCORING.pass300Line, SCORING.pass300)
    + rushYd * SCORING.rushYd
    + n(s.rushing_tds) * SCORING.rushTd
    + bonus(rushYd, SCORING.rush100Line, SCORING.rush100)
    + n(s.receptions) * SCORING.rec
    + recYd * SCORING.recYd
    + n(s.receiving_tds) * SCORING.recTd
    + bonus(recYd, SCORING.rec100Line, SCORING.rec100)
    + n(s.fumbles_lost_total) * SCORING.fumLost;
}
