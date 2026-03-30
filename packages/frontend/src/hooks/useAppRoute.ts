import { useState, useEffect, useCallback } from 'react';
import type { ActiveView } from '../components/Sidebar';

const VIEW_PATHS: Record<string, ActiveView> = {
  '/': 'wizard',
  '/new-call': 'wizard',
  '/history': 'history',
  '/evaluations': 'evaluations',
  '/test-runs': 'test-runs',
};

const VIEW_TO_PATH: Record<ActiveView, string> = {
  wizard: '/',
  history: '/history',
  evaluations: '/evaluations',
  'test-runs': '/test-runs',
};

function parsePathname(pathname: string): {
  view: ActiveView;
  runId: string | null;
} {
  if (pathname.startsWith('/test-runs/')) {
    const runId = decodeURIComponent(pathname.slice('/test-runs/'.length));
    return { view: 'test-runs', runId: runId || null };
  }
  const view = VIEW_PATHS[pathname] ?? 'wizard';
  return { view, runId: null };
}

export function useAppRoute() {
  const [route, setRoute] = useState(() =>
    parsePathname(window.location.pathname)
  );

  useEffect(() => {
    function onPopState() {
      setRoute(parsePathname(window.location.pathname));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateToView = useCallback((view: ActiveView) => {
    const path = VIEW_TO_PATH[view];
    window.history.pushState(null, '', path);
    setRoute({ view, runId: null });
  }, []);

  const navigateToRun = useCallback((runId: string) => {
    const path = `/test-runs/${encodeURIComponent(runId)}`;
    window.history.pushState(null, '', path);
    setRoute({ view: 'test-runs', runId });
  }, []);

  const clearRun = useCallback(() => {
    window.history.pushState(null, '', '/test-runs');
    setRoute({ view: 'test-runs', runId: null });
  }, []);

  return { route, navigateToView, navigateToRun, clearRun };
}
