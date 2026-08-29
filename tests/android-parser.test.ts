import { describe, expect, it } from 'vitest';
import {
  normalizeAndroidKey,
  parseAaptBadging,
  parseAdbDevices,
  parseAndroidLs,
  parseAndroidKeyboardState,
  parseAndroidLockState,
  parseAndroidWebViewSockets
} from '@astur-mobile/android';
import { parseUiAutomatorXml } from '../packages/android/src/uiautomatorXml.js';

describe('Android parser utilities', () => {
  it('normalizes emulator and real device states from adb devices output', () => {
    const devices = parseAdbDevices(`List of devices attached
emulator-5554 device product:sdk_gphone64 model:Pixel_8 device:emu64x
R5CT offline usb:338690048X model:Galaxy_S23
R8XYZ unauthorized usb:338690049X
`);

    expect(devices).toHaveLength(3);
    expect(devices.map((device) => [device.id, device.kind, device.state, device.name])).toEqual([
      ['emulator-5554', 'emulator', 'online', 'Pixel 8'],
      ['R5CT', 'real', 'offline', 'Galaxy S23'],
      ['R8XYZ', 'real', 'unauthorized', 'R8XYZ']
    ]);
  });

  it('creates normalized snapshots from uiautomator XML', () => {
    const tree = parseUiAutomatorXml(`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="Welcome &amp; Start" resource-id="com.example:id/title" class="android.widget.TextView" package="com.example" content-desc="" enabled="true" selected="false" focused="false" bounds="[10,20][210,70]" />
  <node index="1" text="" resource-id="" class="android.widget.Button" package="com.example" content-desc="Sign &quot;in&quot;" enabled="false" selected="true" focused="true" bounds="[30,100][180,160]" />
</hierarchy>`);

    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]).toMatchObject({
      id: 'com.example:id/title',
      text: 'Welcome & Start',
      type: 'android.widget.TextView',
      enabled: true,
      visible: true,
      bounds: { x: 10, y: 20, width: 200, height: 50 }
    });
    expect(tree.children[1]).toMatchObject({
      label: 'Sign "in"',
      enabled: false,
      selected: true,
      focused: true,
      bounds: { x: 30, y: 100, width: 150, height: 60 }
    });
  });

  it('keeps malformed bounds non-visible with zero geometry', () => {
    const tree = parseUiAutomatorXml('<hierarchy><node text="Broken" class="android.view.View" bounds="" /></hierarchy>');

    expect(tree.children[0].visible).toBe(false);
    expect(tree.children[0].bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('extracts package and launch activity from aapt badging output', () => {
    const metadata = parseAaptBadging(`
package: name='com.wdiodemoapp' versionCode='20' versionName='2.1.0'
application-label:'wdiodemoapp'
launchable-activity: name='com.wdiodemoapp.MainActivity'  label='' icon=''
`);

    expect(metadata).toEqual({
      packageName: 'com.wdiodemoapp',
      launchActivity: 'com.wdiodemoapp.MainActivity',
      versionName: '2.1.0'
    });
  });

  it('normalizes friendly Android system keys', () => {
    expect(normalizeAndroidKey('back')).toBe('KEYCODE_BACK');
    expect(normalizeAndroidKey('home')).toBe('KEYCODE_HOME');
    expect(normalizeAndroidKey('recent apps')).toBe('KEYCODE_APP_SWITCH');
    expect(normalizeAndroidKey('sleep')).toBe('KEYCODE_SLEEP');
    expect(normalizeAndroidKey('wakeup')).toBe('KEYCODE_WAKEUP');
    expect(normalizeAndroidKey('KEYCODE_ENTER')).toBe('KEYCODE_ENTER');
    expect(normalizeAndroidKey('82')).toBe('82');
  });

  it('detects Android lock state from window dumps', () => {
    expect(parseAndroidLockState(`
      showing=true
      mInputRestricted=true
      mAwake=false mScreenOnEarly=false mScreenOnFully=false
    `)).toBe(true);

    expect(parseAndroidLockState(`
      showing=false
      mInputRestricted=false
      mAwake=true mScreenOnEarly=true mScreenOnFully=true
    `)).toBe(false);
  });

  it('detects visible Android keyboard bounds from window dumps', () => {
    const state = parseAndroidKeyboardState(`
      InsetsSource id=3 type=ime frame=[0,1440][1080,2424] visibleFrame=[0,1440][1080,2424] visible=true flags= sideHint=BOTTOM boundingRects=null
      ImeInsetsSourceProvider
        mImeShowing=true
    `);

    expect(state).toEqual({
      visible: true,
      bounds: { x: 0, y: 1440, width: 1080, height: 984 }
    });
  });

  it('reports the Android keyboard as hidden when ime insets are invisible', () => {
    expect(parseAndroidKeyboardState(`
      InsetsSource id=3 type=ime frame=[0,0][0,0] visibleFrame=[0,2361][1080,2424] visible=false flags= sideHint=NONE boundingRects=null
        mImeShowing=false
    `)).toEqual({ visible: false });
  });

  it('trusts the ime insets source over a stale mImeShowing elsewhere in the dump', () => {
    // Captured from an emulator with a hardware keyboard attached: the field
    // has focus, no soft keyboard is on screen, and the ime source says so —
    // but `mImeShowing=true` is still sitting in the dump. Believing it is
    // expensive, because callers dismiss a "visible" keyboard by pressing
    // Back, which navigates the app instead of hiding anything.
    expect(parseAndroidKeyboardState(`
      InsetsSource id=3 type=ime frame=[0,2424][1080,2424] visibleFrame=[0,2424][1080,2424] visible=false flags= sideHint=NONE boundingRects=null
      ImeInsetsSourceProvider
        mImeShowing=true
    `)).toEqual({ visible: false });
  });

  it('treats a collapsed ime frame as hidden even when it claims to be visible', () => {
    // Zero height at the bottom edge is how a hidden IME reports itself; it is
    // not a keyboard covering that row.
    expect(parseAndroidKeyboardState(`
      InsetsSource id=3 type=ime frame=[0,2424][1080,2424] visibleFrame=[0,2424][1080,2424] visible=true flags= sideHint=NONE boundingRects=null
    `)).toEqual({ visible: false });
  });

  it('never takes keyboard bounds from the display config', () => {
    // The first mBounds=Rect(...) in a real `dumpsys window` belongs to the
    // display, so a dump-wide search reported the keyboard as covering the
    // whole screen — which makes every element look obstructed.
    const state = parseAndroidKeyboardState(`
      overrideConfig={1.0 [en_US] winConfig={ mBounds=Rect(0, 0 - 1080, 2424) mAppBounds=Rect(0, 0 - 1080, 2424)}}
      InsetsSource id=3 type=ime frame=[0,1541][1080,2424] visibleFrame=[0,1541][1080,2424] visible=true flags= sideHint=BOTTOM boundingRects=null
    `);

    expect(state).toEqual({
      visible: true,
      bounds: { x: 0, y: 1541, width: 1080, height: 883 }
    });
  });

  it('discovers Android WebView DevTools sockets from proc net unix output', () => {
    expect(parseAndroidWebViewSockets(`
0000000000000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_4012
0000000000000000: 00000002 00000000 00010000 0001 01 12346 @chrome_devtools_remote
0000000000000000: 00000002 00000000 00010000 0001 01 12347 @webview_devtools_remote_4012
    `)).toEqual([
      'chrome_devtools_remote',
      'webview_devtools_remote_4012'
    ]);
  });

  it('parses Android ls output into file entries', () => {
    expect(parseAndroidLs(`
total 12
drwxrwx--x 2 shell shell 4096 2026-05-21 00:01 .
drwxrwx--x 3 shell shell 4096 2026-05-21 00:01 ..
-rw-rw---- 1 shell shell 42 2026-05-21 00:02 report.txt
drwxrwx--- 2 shell shell 4096 2026-05-21 00:03 screenshots
    `, '/sdcard/Download')).toEqual([
      {
        name: 'report.txt',
        path: '/sdcard/Download/report.txt',
        type: 'file',
        size: 42
      },
      {
        name: 'screenshots',
        path: '/sdcard/Download/screenshots',
        type: 'directory',
        size: 4096
      }
    ]);
  });
});

describe('uiautomator checked state', () => {
  it('reports checked only for elements that are checkable', () => {
    const tree = parseUiAutomatorXml(
      '<hierarchy>'
      + '<node class="android.widget.CheckBox" checkable="true" checked="true" bounds="[0,0][10,10]" />'
      + '<node class="android.widget.CheckBox" checkable="true" checked="false" bounds="[0,0][10,10]" />'
      + '<node class="android.widget.TextView" checkable="false" checked="false" bounds="[0,0][10,10]" />'
      + '</hierarchy>'
    );

    expect(tree.children[0].checked).toBe(true);
    expect(tree.children[1].checked).toBe(false);
    // Not checkable: the concept does not apply, so it must stay unknown
    // rather than report an unchecked checkbox that does not exist.
    expect(tree.children[2].checked).toBeUndefined();
  });
});
