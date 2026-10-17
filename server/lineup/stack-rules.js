// Rules repo 2026-10-17, D55 as amended 2026-10-17: RB, WR and TE all count toward the QB's stack; a leaf module because optimize.js and multi.js (which imports optimize.js) both need it.
export const countsTowardStack = (pos) => pos === "RB" || pos === "WR" || pos === "TE";
