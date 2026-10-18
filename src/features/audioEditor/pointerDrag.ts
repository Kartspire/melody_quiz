const active = new WeakMap<Element, () => void>();
export function cancelPointerDrag(owner: Element) { active.get(owner)?.(); }
export function startPointerDrag(owner: HTMLElement, pointerId: number, move: (event: PointerEvent) => void, end: (cancelled: boolean) => void) {
  cancelPointerDrag(owner);
  owner.setPointerCapture?.(pointerId);
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    active.delete(owner);
    if (owner.hasPointerCapture?.(pointerId)) owner.releasePointerCapture(pointerId);
  };
  const up = () => { cleanup(); end(false); };
  const cancel = () => { cleanup(); end(true); };
  active.set(owner, cancel);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
}
