import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

const KEY_PREFIX = 'scrollpos:';
const RESTORE_TIMEOUT_MS = 2000;

// Restores a scrollable container's scroll position when returning to a
// route, keyed by pathname. Without this, every page snaps back to the top
// on any navigation back to it -- a Back button, a breadcrumb click, and a
// plain navigate() call all remount the page the same way -- even when
// "back" should mean returning to exactly where you left off in a list.
//
// The saved position is applied as soon as the container mounts, but most
// of this app's list pages fetch their data AFTER mount (a "Loading…"
// placeholder renders first), so the container's scrollHeight is still too
// small to actually hold that scroll position yet. A MutationObserver
// re-applies it as content streams in, until it either settles at the saved
// position or a couple of seconds pass -- so it eventually gets out of the
// way rather than fighting the user's own scrolling indefinitely.
//
// `id` distinguishes multiple independently-scrollable containers on the
// same route (e.g. RouteSetup's route list and its two point lists) --
// leave it off for a page's one main scroll container.
export default function useScrollRestoration(ref, id = '') {
  const location = useLocation();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const key = `${KEY_PREFIX}${location.pathname}${id ? `:${id}` : ''}`;
    const saved = parseInt(sessionStorage.getItem(key), 10) || 0;
    let stopObserving = () => {};

    if (saved > 0) {
      el.scrollTop = saved;
      const observer = new MutationObserver(() => {
        if (el.scrollHeight > saved && Math.abs(el.scrollTop - saved) > 2) {
          el.scrollTop = saved;
        }
      });
      observer.observe(el, { childList: true, subtree: true });
      const timer = setTimeout(() => observer.disconnect(), RESTORE_TIMEOUT_MS);
      stopObserving = () => { observer.disconnect(); clearTimeout(timer); };
    }

    function save() {
      sessionStorage.setItem(key, String(el.scrollTop));
    }
    el.addEventListener('scroll', save, { passive: true });
    return () => {
      save();
      el.removeEventListener('scroll', save);
      stopObserving();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
}
