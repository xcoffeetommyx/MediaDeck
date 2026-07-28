import { afterEach, describe, expect, it, vi } from 'vitest';

import { getGamepadAction, moveFocus } from './navigation';

function gamepad({
  axes = [0, 0],
  pressedButtons = [],
}: {
  axes?: number[];
  pressedButtons?: number[];
} = {}): Gamepad {
  return {
    axes,
    buttons: Array.from({ length: 16 }, (_, index) => ({
      pressed: pressedButtons.includes(index),
      touched: pressedButtons.includes(index),
      value: pressedButtons.includes(index) ? 1 : 0,
    })),
    connected: true,
    hapticActuators: [],
    id: 'test-controller',
    index: 0,
    mapping: 'standard',
    timestamp: 1,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

describe('gamepad input mapping', () => {
  it('maps standard A and B buttons', () => {
    expect(getGamepadAction(gamepad({ pressedButtons: [0] }))).toBe('select');
    expect(getGamepadAction(gamepad({ pressedButtons: [1] }))).toBe('back');
  });

  it('maps the d-pad and left stick with a dead zone', () => {
    expect(getGamepadAction(gamepad({ pressedButtons: [12] }))).toBe('up');
    expect(getGamepadAction(gamepad({ pressedButtons: [15] }))).toBe('right');
    expect(getGamepadAction(gamepad({ axes: [-0.8, 0] }))).toBe('left');
    expect(getGamepadAction(gamepad({ axes: [0, 0.8] }))).toBe('down');
    expect(getGamepadAction(gamepad({ axes: [0.3, -0.3] }))).toBeNull();
  });
});

describe('spatial focus movement', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('moves by rendered direction and stops at a layout edge', () => {
    const left = document.createElement('button');
    const upperRight = document.createElement('button');
    const lowerRight = document.createElement('button');
    for (const button of [left, upperRight, lowerRight]) {
      button.dataset.focusable = 'true';
      document.body.append(button);
    }

    vi.spyOn(left, 'getBoundingClientRect').mockReturnValue(rect(0, 0));
    vi.spyOn(upperRight, 'getBoundingClientRect').mockReturnValue(rect(200, 0));
    vi.spyOn(lowerRight, 'getBoundingClientRect').mockReturnValue(rect(200, 200));

    upperRight.focus();
    moveFocus('down');
    expect(lowerRight).toHaveFocus();

    moveFocus('right');
    expect(lowerRight).toHaveFocus();
  });
});

function rect(left: number, top: number): DOMRect {
  return {
    bottom: top + 100,
    height: 100,
    left,
    right: left + 100,
    toJSON: () => ({}),
    top,
    width: 100,
    x: left,
    y: top,
  };
}
