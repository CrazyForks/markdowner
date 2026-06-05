import { describe, expect, it } from 'vitest';

import {
  isUpdateBannerVisible,
  shouldCheckNow,
  type UpdateInfo,
} from './updateCheck';

const DAY = 24 * 60 * 60 * 1000;

const available: UpdateInfo = {
  available: true,
  currentVersion: '0.260528.2',
  latestVersion: '0.260601.0',
  dmgUrl: 'https://example.com/Markdowner_0.260601.0_universal.dmg',
  releaseUrl: 'https://example.com/release',
  notes: 'notes',
};

describe('shouldCheckNow', () => {
  it('returns false when disabled', () => {
    expect(shouldCheckNow(false, null, 1_000_000)).toBe(false);
  });
  it('returns true when never checked', () => {
    expect(shouldCheckNow(true, null, 1_000_000)).toBe(true);
  });
  it('returns false within 24h of the last check', () => {
    expect(shouldCheckNow(true, 1_000_000, 1_000_000 + DAY - 1)).toBe(false);
  });
  it('returns true after 24h', () => {
    expect(shouldCheckNow(true, 1_000_000, 1_000_000 + DAY)).toBe(true);
  });
});

describe('isUpdateBannerVisible', () => {
  it('hidden when no info or not available', () => {
    expect(isUpdateBannerVisible(null, false, null)).toBe(false);
    expect(
      isUpdateBannerVisible({ ...available, available: false }, false, null),
    ).toBe(false);
  });
  it('visible when available and not dismissed', () => {
    expect(isUpdateBannerVisible(available, false, null)).toBe(true);
  });
  it('hidden when dismissed this session', () => {
    expect(isUpdateBannerVisible(available, true, null)).toBe(false);
  });
  it('hidden when the persisted dismissal matches this version', () => {
    expect(isUpdateBannerVisible(available, false, '0.260601.0')).toBe(false);
  });
  it('visible again when a newer version supersedes a stale dismissal', () => {
    expect(isUpdateBannerVisible(available, false, '0.260529.0')).toBe(true);
  });
});
