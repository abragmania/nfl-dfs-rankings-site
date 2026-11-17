// G71 (screen scaling): every CSS size is rem off a root font-size that grows with the window (style.css: 16px at 1920 wide, 21.33px at 2560).
// A pixel constant that is combined with measured pixels (a gap added to a getBoundingClientRect height, a floor on a height) must grow with it:
// `remPx(n)` is n design pixels (the 1920 page) in the real pixels of the page as it is now. The one copy; a value read from the page (a rect,
// scrollTop, clientX) is already real pixels and does not go through it. Outside a browser (a test) the root is 16px, so it returns n.
export function remPx(n) {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return n;
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return n * ((Number.isFinite(root) && root > 0 ? root : 16) / 16);
}
