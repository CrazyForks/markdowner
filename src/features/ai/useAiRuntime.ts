import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import {
  AI_ACTIVITY_CHANGED_EVENT,
  AI_HISTORY_CHANGED_EVENT,
  aiHistoryPage,
  aiListActive,
} from '@/lib/desktop';
import type { AiActiveRun, AiHistoryPage } from './types';

const EMPTY_HISTORY: AiHistoryPage = { items: [], page: 0, pageSize: 20, total: 0 };

export interface AiRuntimeServices {
  listActive: () => Promise<AiActiveRun[]>;
  historyPage: (page: number, pageSize: number) => Promise<AiHistoryPage>;
  listen: (
    event: string,
    callback: () => void | Promise<void>,
  ) => Promise<() => void>;
}

const DEFAULT_SERVICES: AiRuntimeServices = {
  listActive: aiListActive,
  historyPage: aiHistoryPage,
  listen: async (event, callback) => listen(event, () => void callback()),
};

export function useAiRuntime({
  historyEnabled,
  services = DEFAULT_SERVICES,
}: {
  historyEnabled: boolean;
  services?: AiRuntimeServices;
}) {
  const [activeRuns, setActiveRuns] = useState<AiActiveRun[]>([]);
  const [history, setHistory] = useState<AiHistoryPage>(EMPTY_HISTORY);
  const [historyPageIndex, setHistoryPageIndex] = useState(0);
  const [activityLoading, setActivityLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(historyEnabled);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyPageRef = useRef(historyPageIndex);

  useEffect(() => {
    historyPageRef.current = historyPageIndex;
  }, [historyPageIndex]);

  const reloadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      setActiveRuns(await services.listActive());
      setActivityError(null);
    } catch (reason) {
      setActivityError(errorMessage(reason));
    } finally {
      setActivityLoading(false);
    }
  }, [services]);

  const loadHistoryPage = useCallback(
    async (page: number) => {
      if (!historyEnabled) {
        setHistory(EMPTY_HISTORY);
        setHistoryError(null);
        setHistoryLoading(false);
        return;
      }
      setHistoryLoading(true);
      try {
        setHistory(await services.historyPage(page, 20));
        setHistoryError(null);
      } catch (reason) {
        setHistoryError(errorMessage(reason));
      } finally {
        setHistoryLoading(false);
      }
    },
    [historyEnabled, services],
  );

  const reloadHistory = useCallback(
    () => loadHistoryPage(historyPageRef.current),
    [loadHistoryPage],
  );

  useEffect(() => {
    void reloadActivity();
  }, [reloadActivity]);

  useEffect(() => {
    void loadHistoryPage(historyPageIndex);
  }, [historyPageIndex, loadHistoryPage]);

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    Promise.all([
      services.listen(AI_ACTIVITY_CHANGED_EVENT, reloadActivity),
      services.listen(AI_HISTORY_CHANGED_EVENT, reloadHistory),
    ]).then((resolved) => {
      if (disposed) {
        resolved.forEach((cleanup) => cleanup());
      } else {
        cleanups.push(...resolved);
      }
    }).catch((reason) => {
      if (!disposed) setActivityError(errorMessage(reason));
    });
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [reloadActivity, reloadHistory, services]);

  return {
    activeRuns,
    history,
    historyPageIndex,
    activityLoading,
    historyLoading,
    activityError,
    historyError,
    setHistoryPage: setHistoryPageIndex,
    reloadActivity,
    reloadHistory,
  };
}

function errorMessage(reason: unknown): string {
  if (reason && typeof reason === 'object' && 'message' in reason) {
    return String(reason.message);
  }
  return String(reason || 'AI runtime state is unavailable.');
}
