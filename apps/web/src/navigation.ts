import { useEffect, useRef, useState } from 'react';

export type Direction = 'down' | 'left' | 'right' | 'up';
export type GamepadAction = 'back' | 'down' | 'left' | 'right' | 'select' | 'up';

const focusableSelector = '[data-focusable="true"]:not(:disabled)';

export function getGamepadAction(gamepad: Gamepad): GamepadAction | null {
  if (gamepad.buttons[0]?.pressed) return 'select';
  if (gamepad.buttons[1]?.pressed) return 'back';
  if (gamepad.buttons[12]?.pressed || (gamepad.axes[1] ?? 0) < -0.55) return 'up';
  if (gamepad.buttons[13]?.pressed || (gamepad.axes[1] ?? 0) > 0.55) return 'down';
  if (gamepad.buttons[14]?.pressed || (gamepad.axes[0] ?? 0) < -0.55) return 'left';
  if (gamepad.buttons[15]?.pressed || (gamepad.axes[0] ?? 0) > 0.55) return 'right';
  return null;
}

export function moveFocus(direction: Direction, root?: ParentNode): void {
  const navigationRoot =
    root ??
    document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]') ??
    document;
  const candidates = [
    ...navigationRoot.querySelectorAll<HTMLElement>(focusableSelector),
  ].filter((element) => element.getAttribute('aria-hidden') !== 'true');
  if (candidates.length === 0) return;

  const current =
    document.activeElement instanceof HTMLElement &&
    candidates.includes(document.activeElement)
      ? document.activeElement
      : null;
  if (!current) {
    candidates[0]?.focus();
    return;
  }

  const currentRect = current.getBoundingClientRect();
  const currentCenter = {
    x: currentRect.left + currentRect.width / 2,
    y: currentRect.top + currentRect.height / 2,
  };
  const ranked = candidates
    .filter((candidate) => candidate !== current)
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;
      const isForward =
        (direction === 'right' && dx > 1) ||
        (direction === 'left' && dx < -1) ||
        (direction === 'down' && dy > 1) ||
        (direction === 'up' && dy < -1);
      const primary =
        direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
      const secondary =
        direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
      return { candidate, isForward, score: primary + secondary * 2.4 };
    })
    .filter(({ isForward }) => isForward)
    .sort((first, second) => first.score - second.score);

  const spatialTarget = ranked[0]?.candidate;
  if (spatialTarget) {
    spatialTarget.focus();
    return;
  }

  const hasRenderedGeometry =
    currentRect.width > 0 ||
    currentRect.height > 0 ||
    candidates.some((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    });
  if (hasRenderedGeometry) return;

  const currentIndex = candidates.indexOf(current);
  const delta = direction === 'left' || direction === 'up' ? -1 : 1;
  const fallbackIndex = Math.min(
    candidates.length - 1,
    Math.max(0, currentIndex + delta),
  );
  candidates[fallbackIndex]?.focus();
}

export function useAutoFocus(key: string): void {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const navigationRoot =
        document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]') ??
        document;
      const target =
        navigationRoot.querySelector<HTMLElement>('[data-autofocus="true"]') ??
        navigationRoot.querySelector<HTMLElement>(focusableSelector);
      window.scrollTo(0, 0);
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [key]);
}

export function useInputNavigation({ onBack }: { onBack: () => void }): {
  controllerConnected: boolean;
} {
  const onBackRef = useRef(onBack);
  const [controllerConnected, setControllerConnected] = useState(false);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if (event.key === 'Escape' || (event.key === 'Backspace' && !isTextInput)) {
        event.preventDefault();
        onBackRef.current();
        return;
      }
      if (isTextInput) return;

      const directions: Partial<Record<string, Direction>> = {
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
      };
      const direction = directions[event.key];
      if (direction) {
        event.preventDefault();
        moveFocus(direction);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (typeof navigator.getGamepads !== 'function') return;

    let frame = 0;
    let lastAction: GamepadAction | null = null;
    let nextRepeatAt = 0;
    let lastConnected = false;

    const invokeAction = (action: GamepadAction) => {
      if (action === 'back') {
        onBackRef.current();
      } else if (action === 'select') {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.click();
        }
      } else {
        moveFocus(action);
      }
    };

    const poll = (timestamp: number) => {
      const pads = [...navigator.getGamepads()].filter(
        (gamepad): gamepad is Gamepad => gamepad !== null,
      );
      const connected = pads.length > 0;
      if (connected !== lastConnected) {
        lastConnected = connected;
        setControllerConnected(connected);
      }

      const action = pads[0] ? getGamepadAction(pads[0]) : null;
      if (!action) {
        lastAction = null;
        nextRepeatAt = 0;
      } else if (action !== lastAction || timestamp >= nextRepeatAt) {
        invokeAction(action);
        nextRepeatAt =
          action === 'select' || action === 'back'
            ? Number.POSITIVE_INFINITY
            : timestamp + (action === lastAction ? 120 : 360);
        lastAction = action;
      }

      frame = window.requestAnimationFrame(poll);
    };

    frame = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return { controllerConnected };
}
