import { DATA_LIMITS } from '../../model/limits';

export function CreateGamePanel({
  title,
  onTitleChange,
  onCreate,
  onCancel,
}: {
  title: string;
  onTitleChange: (title: string) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="create-game-panel">
      <label className="field">
        <span>Название новой игры</span>
        <input
          autoFocus
          maxLength={DATA_LIMITS.text.gameTitle}
          value={title}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onTitleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && title.trim()) onCreate();
            if (event.key === 'Escape') onCancel();
          }}
        />
      </label>
      <div className="inline-actions">
        <button className="primary-button" disabled={!title.trim()} onClick={onCreate}>Создать и настроить</button>
        <button className="secondary-button" onClick={onCancel}>Отмена</button>
      </div>
    </section>
  );
}
