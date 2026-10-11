import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The iOS agent has two copies: agents/ is the project developers open in
// Xcode, and packages/ios/assets/ is what @astur-mobile/ios ships and builds on
// users' machines. They drifted once, unnoticed for months, so features that
// worked in development (keyboard.type, by.native) never reached users.
// The Xcode project files differ on purpose (a personal signing team lives in
// the development copy), so only the Swift sources are compared.
const root = fileURLToPath(new URL('..', import.meta.url));
const development = join(root, 'agents/ios-xctest-agent');
const shipped = join(root, 'packages/ios/assets/ios-xctest-agent');

function swiftSources(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.swift')).sort();
}

describe('iOS agent sources', () => {
  it('ship the same Swift files the development project builds', () => {
    expect(swiftSources(shipped)).toEqual(swiftSources(development));
  });

  it.each(swiftSources(development))('ship %s unchanged', (name) => {
    expect(readFileSync(join(shipped, name), 'utf8')).toBe(readFileSync(join(development, name), 'utf8'));
  });
});
