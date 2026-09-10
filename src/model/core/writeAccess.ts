// A state replacement must exclude commands even when they come from an async
// operation or a keyboard shortcut rather than the currently visible UI.
let replacingState = false;
let applyingReplacement = false;
let replacementVersion = 0;

export function canWriteState() {
  return !replacingState || applyingReplacement;
}

export function assertStateWritable() {
  if (!canWriteState()) throw new Error('Дождитесь завершения импорта и повторите действие.');
}

export function beginStateReplacement() {
  assertStateWritable();
  replacingState = true;
  replacementVersion += 1;
  return {
    apply(action: () => void) {
      applyingReplacement = true;
      try { action(); } finally { applyingReplacement = false; }
    },
    release() { replacingState = false; },
  };
}

export function captureStateWrite() {
  assertStateWritable();
  const version = replacementVersion;
  return () => {
    assertStateWritable();
    if (version !== replacementVersion) throw new Error('Данные были импортированы во время обработки. Повторите добавление файла.');
  };
}
