import type {
  Bounds,
  Coordinates,
  KeyboardDismissMode,
  KeyboardState
} from '@astur-mobile/protocol';
import type { PlatformSession } from './session.js';
import { delay } from './wait.js';

/**
 * Whether `pressKey(key)` means "type this character" rather than "send this
 * key". Both platforms have to agree on the answer or a digit-by-digit flow —
 * the usual shape for OTP entry — needs a platform branch in the test.
 *
 * A single character a user could type qualifies. Control characters do not, so
 * `'\n'` still resolves as a named key, and neither does anything longer than
 * one character, which leaves named keys (`'BACK'`) and raw Android keycode
 * numbers (`'66'`) untouched.
 */
export function isPrintableCharacter(key: string): boolean {
  return [...key].length === 1 && !/\p{C}/u.test(key);
}

export async function preparePointerTargetForKeyboard(
  session: PlatformSession,
  point: Coordinates,
  mode?: KeyboardDismissMode
): Promise<boolean> {
  const dismissMode = mode ?? session.capabilities.keyboard?.dismiss ?? 'auto';
  if (dismissMode === 'preserve' || !session.getKeyboardState || !session.dismissKeyboard) {
    return false;
  }

  const state = await session.getKeyboardState().catch((): KeyboardState => ({ visible: false }));
  if (!state.visible || !state.bounds || !containsPoint(state.bounds, point)) {
    return false;
  }

  await session.dismissKeyboard();
  await waitForKeyboardHidden(session);
  return true;
}

function containsPoint(bounds: Bounds, point: Coordinates): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

async function waitForKeyboardHidden(session: PlatformSession): Promise<void> {
  const deadline = Date.now() + 1_500;

  while (Date.now() <= deadline) {
    const state = await session.getKeyboardState?.().catch((): KeyboardState => ({ visible: false }));
    if (!state?.visible) {
      return;
    }

    await delay(100);
  }
}
