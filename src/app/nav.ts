// Path routing (/games, /game/bricks, /play/bricks…) with the History API. GitHub Pages has no rewrites,
// so the build also ships 404.html (and <route>.html for the tabs) as copies of the app shell
// (vite.config.ts); the service worker serves the shell for every navigation once installed.

type Listener = () => void;
let listener: Listener = () => {};

/** Called on every navigation: link clicks, navigate(), back/forward. */
export function onNavigate(fn: Listener) {
  listener = fn;
}

/** Go to an in-app path like `/game/bricks`. `replace` swaps the current history entry instead. */
function navigate(path: string, replace = false) {
  if (path === location.pathname + location.search) return replace ? undefined : listener();
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  listener();
}

addEventListener('popstate', () => listener());
// Same-origin <a href="/…"> clicks route in place instead of reloading the page.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a');
  const href = a?.getAttribute('href');
  if (!a || !href || !href.startsWith('/') || href.startsWith('//') || a.target || a.hasAttribute('download')) return;
  e.preventDefault();
  navigate(href);
});
