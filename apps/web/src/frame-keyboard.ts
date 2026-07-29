/*
 * On a console or TV browser the controller's A button arrives as a left
 * click, and the embedded stream client focuses its hidden capture field on
 * every press — which raised the on-screen keyboard every single time.
 *
 * `inputmode="none"` is the platform's own way to say "focus this, but do not
 * raise a virtual keyboard". It is used here in preference to stealing focus:
 * the client keeps its text field focused to capture typing, so blurring it
 * would break physical keyboards, and a blur issued during `focusin` is
 * overridden once the browser finishes the focus it was already performing.
 */

const nonTextInputTypes = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

const suppressedInputModeFlag = 'mediadeckPriorInputMode';

const textEntrySelector = 'input, textarea, [contenteditable]';

/*
 * The stream frame is a separate realm, so its elements are not instances of
 * this window's HTMLInputElement. Everything here is checked structurally.
 */
export function isTextEntryElement(node: EventTarget | null): node is HTMLElement {
  if (!node || typeof node !== 'object') return false;
  const element = node as {
    isContentEditable?: boolean;
    setAttribute?: unknown;
    tagName?: string;
    type?: string;
  };
  if (typeof element.setAttribute !== 'function') return false;

  const tagName = element.tagName?.toUpperCase();
  if (tagName === 'TEXTAREA') return true;
  if (tagName === 'INPUT') {
    return !nonTextInputTypes.has((element.type ?? 'text').toLowerCase());
  }
  return element.isContentEditable === true;
}

export function suppressElementKeyboard(element: HTMLElement): void {
  if (!isTextEntryElement(element)) return;
  if (element.dataset[suppressedInputModeFlag] !== undefined) return;
  element.dataset[suppressedInputModeFlag] = element.getAttribute('inputmode') ?? '';
  element.setAttribute('inputmode', 'none');
}

export function restoreElementKeyboard(element: HTMLElement): void {
  const previous = element.dataset[suppressedInputModeFlag];
  if (previous === undefined) return;
  delete element.dataset[suppressedInputModeFlag];
  if (previous) element.setAttribute('inputmode', previous);
  else element.removeAttribute('inputmode');
}

/**
 * Suppresses the virtual keyboard on every text field the stream client owns,
 * including ones it creates later. Returns a disposer.
 */
export function suppressFrameKeyboard(frameDocument: Document): () => void {
  const applyWithin = (root: ParentNode) => {
    for (const element of root.querySelectorAll<HTMLElement>(textEntrySelector)) {
      suppressElementKeyboard(element);
    }
  };

  applyWithin(frameDocument);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (!(added as Partial<Element>).querySelectorAll) continue;
        suppressElementKeyboard(added as HTMLElement);
        applyWithin(added as Element);
      }
    }
  });

  if (frameDocument.documentElement) {
    observer.observe(frameDocument.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  return () => observer.disconnect();
}
