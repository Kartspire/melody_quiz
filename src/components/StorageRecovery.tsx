import { useRef, useState } from 'react';
import { parseAppBackup, type ParsedAppBackup } from '../lib/appBackup';
import { storageRecoveryFx, storageRetryRequested } from '../model/game';
import { Dialog } from './Dialog';

export function StorageRecovery({ message }: { message: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedAppBackup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectBackup = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try { setPreview(await parseAppBackup(file)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось проверить копию.'); }
    finally { setBusy(false); }
  };

  const restore = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try { await storageRecoveryFx(preview.state); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось восстановить данные.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="app-loader storage-recovery">
      <strong>Не удалось безопасно открыть локальные данные</strong>
      <span>{message}</span>
      <div className="storage-recovery__actions">
        <button disabled={busy} className="primary-button" onClick={() => storageRetryRequested()}>Повторить загрузку</button>
        <button disabled={busy} className="secondary-button" onClick={() => inputRef.current?.click()}>
          {busy ? 'Проверяем копию…' : 'Восстановить из резервной копии'}
        </button>
      </div>
      <input ref={inputRef} className="hidden-file-input" type="file" accept=".melody-backup,application/zip" onChange={(event) => {
        const file = event.target.files?.[0];
        event.currentTarget.value = '';
        void selectBackup(file);
      }} />
      <small>Выбор файла только проверяет копию. Замена локальных данных потребует подтверждения.</small>
      {error && !preview && <p role="alert">{error}</p>}
      {preview && (
        <Dialog busy={busy} title="Восстановить локальные данные?" onClose={() => setPreview(null)}
          description="Копия проверена. Текущие игры, медиатека и партии будут полностью заменены данными из этого файла.">
          <p>Создана: {new Date(preview.manifest.createdAt).toLocaleString('ru-RU')}</p>
          <p>Игр: {preview.state.games.length} · Песен: {preview.state.songs.length} · Треков: {preview.state.mediaTracks.length} · Партий: {preview.state.sessions.length}</p>
          {error && <p role="alert">{error}</p>}
          <div className="import-dialog__actions">
            <button className="secondary-button" onClick={() => setPreview(null)}>Отмена</button>
            <button className="primary-button" onClick={() => void restore()}>Заменить данные и восстановить</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
