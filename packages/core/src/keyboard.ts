import type {
  Bounds,
  Coordinates,
  KeyboardDismissMode,
  KeyboardState
} from '@astur-mobile/protocol';
import type { PlatformSession } from './session.js';
import { delay } from './wait.js';

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
