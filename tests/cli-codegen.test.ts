import { describe, expect, it } from 'vitest';
import { __testing } from '@astur-mobile/cli';

const { generateTestCode, generateRecordedStepCode } = __testing.inspectorServer;

type Step = Parameters<typeof generateRecordedStepCode>[0];

const step = (partial: Partial<Step>): Step => ({
  index: 0,
  action: 'tap',
  locator: '',
  ...partial
});

describe('inspector codegen emitters', () => {
  it('emits an empty-recording marker when there are no steps', () => {
    expect(generateTestCode([], 'typescript')).toBe('// No steps recorded yet');
  });

  it('emits a runnable TypeScript test with import, fixture, and steps', () => {
    const code = generateTestCode(
      [step({ locator: "getByTestId('login-submit')" })],
      'typescript'
    );

    expect(code).toContain("import { test, expect } from '@astur-mobile/test';");
    expect(code).toContain("test('recorded flow', async ({ device }) => {");
    expect(code).toContain("  await device.getByTestId('login-submit').tap();");
  });

  it('emits a require() import for JavaScript', () => {
    const code = generateTestCode([step({ locator: "getByText('Go')" })], 'javascript');

    expect(code).toContain("const { test, expect } = require('@astur-mobile/test');");
  });

  it('emits the webContext handle once when web steps are present', () => {
    const code = generateTestCode(
      [
        step({ locator: "getByTestId('email')", action: 'fill', value: 'qa@astur.dev', web: true }),
        step({ index: 1, locator: "getByText('Submit')", web: true })
      ],
      'typescript'
    );

    expect(code.match(/const web = await device\.webContext\(\);/g)).toHaveLength(1);
    expect(code).toContain('await web.getByTestId(\'email\').fill("qa@astur.dev");');
    expect(code).toContain("await web.getByText('Submit').tap();");
  });

  it('strips a leading device. prefix from recorded locators', () => {
    expect(generateRecordedStepCode(step({ locator: "device.getById('menu')" })))
      .toBe("  await device.getById('menu').tap();");
  });

  it('emits gestures and coordinate taps verbatim', () => {
    const gesture = { start: { x: 10, y: 500 }, end: { x: 10, y: 100 }, durationMs: 300 };

    expect(generateRecordedStepCode(step({ action: 'swipe', gesture })))
      .toBe(`  await device.swipe(${JSON.stringify(gesture)});`);
    expect(generateRecordedStepCode(step({ action: 'drag', gesture })))
      .toBe(`  await device.drag(${JSON.stringify(gesture)});`);
    expect(generateRecordedStepCode(step({ action: 'drag', gesture, locator: "getByTestId('tile')" })))
      .toBe("  await device.getByTestId('tile').dragTo({ x: 10, y: 100 });");
    expect(generateRecordedStepCode(step({ action: 'tapPoint', point: { x: 5, y: 9 } })))
      .toBe('  await device.tap({"x":5,"y":9});');
  });

  it('never emits broken calls for locator-less fill or expect steps', () => {
    expect(generateRecordedStepCode(step({ action: 'fill', value: 'oops' })))
      .toContain('// TODO: fill target had no stable locator');
    expect(generateRecordedStepCode(step({ action: 'expect', assertion: 'visible' })))
      .toContain('// TODO: expect target had no stable locator');
    expect(generateRecordedStepCode(step({ action: 'tap' })))
      .toContain('// TODO: tap target had no stable locator');

    // With a fallback point available, a coordinate tap is emitted instead.
    expect(generateRecordedStepCode(step({ action: 'tap', point: { x: 1, y: 2 } })))
      .toBe('  await device.tap({"x":1,"y":2});');
  });

  it('emits every assertion kind against the recorded locator', () => {
    const cases: Array<[Step['assertion'], string | undefined, string]> = [
      ['visible', undefined, '.toBeVisible();'],
      ['text', 'Welcome', '.toHaveText("Welcome");'],
      ['containsText', 'Wel', '.toContainText("Wel");'],
      ['value', 'qa@astur.dev', '.toHaveValue("qa@astur.dev");'],
      ['label', 'Sign in', '.toHaveLabel("Sign in");'],
      ['type', 'android.widget.Button', '.toHaveType("android.widget.Button");'],
      ['enabled', undefined, '.toBeEnabled();'],
      ['disabled', undefined, '.toBeDisabled();'],
      ['selected', undefined, '.toBeSelected();'],
      ['focused', undefined, '.toBeFocused();'],
      ['count', '3', '.toHaveCount(3);']
    ];

    for (const [assertion, value, expected] of cases) {
      const code = generateRecordedStepCode(
        step({ action: 'expect', locator: "getByRole('button')", assertion, value })
      );
      expect(code).toBe(`  await expect(device.getByRole('button'))${expected}`);
    }
  });

  it('coerces non-numeric count values to a safe integer', () => {
    expect(generateRecordedStepCode(
      step({ action: 'expect', locator: "getByRole('menuitem')", assertion: 'count', value: 'lots' })
    )).toBe("  await expect(device.getByRole('menuitem')).toHaveCount(1);");

    expect(generateRecordedStepCode(
      step({ action: 'expect', locator: "getByRole('menuitem')", assertion: 'count', value: '0' })
    )).toBe("  await expect(device.getByRole('menuitem')).toHaveCount(0);");
  });
});
