import type { GameConflictMode, PreparedGameImport } from '../../lib/melodyPackage';
import { Dialog } from '../Dialog';
import { ImportVerificationSummary } from '../ImportVerificationSummary';

export function GameImportDialog({
  prepared,
  onCancel,
  onImport,
}: {
  prepared: PreparedGameImport;
  onCancel: () => void;
  onImport: (mode: GameConflictMode) => void;
}) {
  const game = prepared.package.game!;

  return (
    <Dialog eyebrow="Проверка завершена" title={`Импорт «${game.title}»`} onClose={onCancel} className="import-dialog">
      <ImportVerificationSummary
        title={`Игра «${game.title}» готова к импорту`}
        stats={prepared.media.stats}
        checks={[
          'Архив не повреждён',
          'Структура данных проверена',
          'Все вложенные аудиофайлы доступны',
        ]}
      />

      <p className="import-note">Прогресс партии не переносится: после импорта игра начнётся с нулевыми баллами и всеми неразыгранными карточками.</p>
      {prepared.playabilityIssues.length > 0 && (
        <p className="import-note import-note--warning">
          Архив целостен, но игра требует настройки перед запуском: {prepared.playabilityIssues[0]}
          {prepared.playabilityIssues.length > 1 ? ` Ещё замечаний: ${prepared.playabilityIssues.length - 1}.` : ''}
        </p>
      )}

      {prepared.hasGameConflict ? (
        <div className="import-conflict">
          <strong>Эта же игра уже есть в библиотеке.</strong>
          <p>Её постоянный идентификатор совпадает с архивом. Выберите, что сделать.</p>
          <div className="import-dialog__actions">
            <button className="primary-button" onClick={() => onImport('replace')}>Заменить существующую</button>
            <button className="secondary-button" onClick={() => onImport('copy')}>Импортировать как копию</button>
            <button className="text-button" onClick={onCancel}>Отмена</button>
          </div>
        </div>
      ) : (
        <div className="import-dialog__actions">
          <button className="primary-button" onClick={() => onImport('copy')}>Импортировать игру</button>
          <button className="secondary-button" onClick={onCancel}>Отмена</button>
        </div>
      )}
    </Dialog>
  );
}
