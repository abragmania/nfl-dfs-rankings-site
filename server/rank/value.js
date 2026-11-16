// The value maths' Node-side entry point. It used to load data/config/rank.json too; that file is retired (review
// Q1, Adam 2026-10-14, and Adam 2026-10-15, Lev measure to be redesigned: nothing is left to configure). The maths
// lives in value-core.js, which is pure so the public site can run it in a browser (DECISIONS.md D71); everything
// there is re-exported here, so every existing caller is unchanged.
export {
  isSidelined,
  rowIsSidelined,
  toNumber,
  hasRealProjection,
  valueOf,
  computeValue
} from "./value-core.js";
