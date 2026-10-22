/**
 * The RxJS DevTools icon: a marble diagram (a timeline with two marbles and
 * an arrow head) on the RxJS magenta. Deliberately nothing like the Redux
 * DevTools logo.
 */
export const RXJS_DEVTOOLS_ICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="RxJS DevTools">',
  '<rect width="32" height="32" rx="7" fill="#C2185B"/>',
  '<path d="M5 16h21" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>',
  '<path d="M22.5 11.5 27 16l-4.5 4.5" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  '<circle cx="9.5" cy="16" r="3.25" fill="#fff"/>',
  '<circle cx="16.5" cy="16" r="3.25" fill="#fff"/>',
  "</svg>",
].join("");

export const RXJS_DEVTOOLS_ICON_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  RXJS_DEVTOOLS_ICON_SVG,
)}`;
