import { describe, expect, it } from 'vitest';
import { parseAndroidForegroundApp, parseAndroidPackageList } from '@astur-mobile/android';
import { parseSimctlAppList } from '@astur-mobile/ios';

describe('android package list', () => {
  it('reads one identifier per line and sorts them', () => {
    const output = [
      'package:com.astur.demo',
      'package:com.example.other',
      'package:com.astur.demo',
      ''
    ].join('\n');

    expect(parseAndroidPackageList(output, false)).toEqual([
      { identifier: 'com.astur.demo' },
      { identifier: 'com.example.other' }
    ]);
  });

  it('marks entries as system only when a system listing was asked for', () => {
    const apps = parseAndroidPackageList('package:com.android.settings', true);
    expect(apps).toEqual([{ identifier: 'com.android.settings', system: true }]);
  });

  it('ignores lines that are not package entries', () => {
    expect(parseAndroidPackageList('WARNING: linker\npackage:com.astur.demo', false))
      .toEqual([{ identifier: 'com.astur.demo' }]);
  });
});

describe('android foreground app', () => {
  it('prefers the focused window over the resumed activity', () => {
    const output = [
      '  mCurrentFocus=Window{a1b2c3 u0 com.astur.demo/com.astur.demo.MainActivity}',
      '  mResumedActivity: ActivityRecord{d4e5f6 u0 com.other.app/.HomeActivity t42}'
    ].join('\n');

    expect(parseAndroidForegroundApp(output)).toEqual({
      identifier: 'com.astur.demo',
      activity: 'com.astur.demo.MainActivity'
    });
  });

  it('falls back to the resumed activity when no window is focused', () => {
    const output = '  mResumedActivity: ActivityRecord{d4e5f6 u0 com.astur.demo/.MainActivity t42}';
    expect(parseAndroidForegroundApp(output)).toEqual({
      identifier: 'com.astur.demo',
      activity: 'com.astur.demo.MainActivity'
    });
  });

  it('expands a relative activity name against its package', () => {
    const output = 'mCurrentFocus=Window{x u0 com.astur.demo/.MainActivity}';
    expect(parseAndroidForegroundApp(output)?.activity).toBe('com.astur.demo.MainActivity');
  });

  it('reports nothing when the launcher is showing rather than an app', () => {
    expect(parseAndroidForegroundApp('  mCurrentFocus=null')).toBeUndefined();
  });
});

describe('simctl app list', () => {
  const output = `{
    "com.astur.demo" =     {
        ApplicationType = User;
        CFBundleDisplayName = "Astur Demo";
        CFBundleIdentifier = "com.astur.demo";
    };
    "com.apple.Maps" =     {
        ApplicationType = System;
        CFBundleDisplayName = Maps;
        CFBundleIdentifier = "com.apple.Maps";
    };
}`;

  it('returns third-party apps by default', () => {
    expect(parseSimctlAppList(output, false)).toEqual([
      { identifier: 'com.astur.demo', name: 'Astur Demo' }
    ]);
  });

  it('includes system apps when asked', () => {
    const apps = parseSimctlAppList(output, true);
    expect(apps.map((app) => app.identifier)).toEqual(['com.apple.Maps', 'com.astur.demo']);
    expect(apps.find((app) => app.identifier === 'com.apple.Maps')?.system).toBe(true);
  });

  it('degrades to an empty list rather than throwing on an unexpected format', () => {
    expect(parseSimctlAppList('not a plist at all', false)).toEqual([]);
  });
});
