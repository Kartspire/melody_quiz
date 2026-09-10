import type { PreparedMediaMerge } from '../../lib/melodyPackage';
import { Dialog } from '../Dialog';
import { ImportVerificationSummary } from '../ImportVerificationSummary';

export function LibraryImportDialog({ prepared, onCancel, onImport, busy = false }: { prepared: PreparedMediaMerge; onCancel: () => void; onImport: () => void; busy?: boolean }) {
  return (
    <Dialog busy={busy} eyebrow="Проверка завершена" title="Импорт медиатеки" onClose={onCancel} className="import-dialog">
      <ImportVerificationSummary
        title="Медиатека готова к импорту"
        stats={prepared.stats}
        checks={[
          'Архив не повреждён',
          'Связи песен и аудиотреков проверены',
          'Все вложенные аудиофайлы доступны',
        ]}
        sectionTitle="Что будет добавлено"
      />
      <div className="import-dialog__actions">
        <button className="primary-button" onClick={onImport}>Добавить в медиатеку</button>
        <button className="secondary-button" onClick={onCancel}>Отмена</button>
      </div>
    </Dialog>
  );
}
