import { useCallback, useEffect, useRef, useState } from 'react';

import { openExternalUrl } from './desktop';
import type { Settings } from './settings';
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  isUpdateBannerVisible,
  shouldCheckNow,
  type UpdateInfo,
} from './updateCheck';

export interface UseUpdateCheck {
  info: UpdateInfo | null;
  bannerVisible: boolean;
  checking: boolean;
  installing: boolean;
  checkNow: () => Promise<void>;
  dismissBanner: () => void;
  viewRelease: () => void;
  install: () => Promise<void>;
}

/**
 * Owns the launch update check (24h throttle) and the resulting state.
 * `ready` gates the launch check until persisted settings have loaded, so we
 * never check against the initial defaults.
 */
export function useUpdateCheck(
  settings: Settings,
  onSettingsChange: (next: Settings) => void,
  ready: boolean,
): UseUpdateCheck {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const launchedRef = useRef(false);

  // Keep the latest settings in a ref so callbacks can read/merge without
  // being re-created on every settings change.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const result = await checkForUpdate();
      setInfo(result);
      onSettingsChange({ ...settingsRef.current, lastUpdateCheckAt: Date.now() });
    } catch (error) {
      console.error('Update check failed:', error);
    } finally {
      setChecking(false);
    }
  }, [onSettingsChange]);

  useEffect(() => {
    if (!ready || launchedRef.current) {
      return;
    }
    launchedRef.current = true;
    if (shouldCheckNow(settings.updateCheckEnabled, settings.lastUpdateCheckAt, Date.now())) {
      void runCheck();
    }
  }, [ready, runCheck, settings.updateCheckEnabled, settings.lastUpdateCheckAt]);

  const bannerVisible = isUpdateBannerVisible(
    info,
    sessionDismissed,
    settings.dismissedUpdateVersion,
  );

  const dismissBanner = useCallback(() => {
    setSessionDismissed(true);
    if (info) {
      onSettingsChange({ ...settingsRef.current, dismissedUpdateVersion: info.latestVersion });
    }
  }, [info, onSettingsChange]);

  const checkNow = useCallback(() => runCheck(), [runCheck]);

  const viewRelease = useCallback(() => {
    if (info) {
      void openExternalUrl(info.releaseUrl);
    }
  }, [info]);

  const install = useCallback(async () => {
    if (!info) {
      return;
    }
    if (!info.dmgUrl) {
      void openExternalUrl(info.releaseUrl);
      return;
    }
    setInstalling(true);
    try {
      await downloadAndInstallUpdate(info.dmgUrl);
    } catch (error) {
      console.error('Update install failed:', error);
      setInstalling(false);
    }
    // On success the app exits and relaunches, so we leave `installing` true.
  }, [info]);

  return {
    info,
    bannerVisible,
    checking,
    installing,
    checkNow,
    dismissBanner,
    viewRelease,
    install,
  };
}
