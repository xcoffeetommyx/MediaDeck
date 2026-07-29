/*
 * A registry of open dialogs so that Back — Escape, Backspace, or the
 * controller's B button — always closes the topmost dialog before it changes
 * view. Native window.confirm() cannot be reached with a gamepad, so every
 * confirmation in MediaDeck is a real dialog registered here.
 */
type DialogEntry = { close: () => void };

const openDialogs: DialogEntry[] = [];

export function registerDialog(entry: DialogEntry): () => void {
  openDialogs.push(entry);
  return () => {
    const index = openDialogs.indexOf(entry);
    if (index !== -1) openDialogs.splice(index, 1);
  };
}

export function closeTopDialog(): boolean {
  const top = openDialogs.at(-1);
  if (!top) return false;
  top.close();
  return true;
}
