import { useMemo, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeGame,
  $audioAssets,
  $songs,
  $session,
  categoryAdded,
  categoryNameChanged,
  categoryRemoved,
  gameDeleted,
  gameRestarted,
  getGameStartIssues,
  hasSessionProgress,
  gameTitleChanged,
  questionAdded,
  questionChanged,
  questionRemoved,
  questionSongChanged,
  roundAdded,
  roundNameChanged,
  roundRemoved,
  screenChanged,
  teamAdded,
  teamChanged,
  teamRemoved,
} from '../model/game';
import { GAME_LIMITS } from '../model/limits';
import { DraftNumberInput } from './DraftNumberInput';
import { SongForm } from './SongForm';
import { useEscapeClose } from './useEscapeClose';

type EditorTab = 'structure' | 'teams' | 'settings';

export function AdminPanel() {
  const [config, songs, audioAssets, session] = useUnit([$activeGame, $songs, $audioAssets, $session]);
  const [tab, setTab] = useState<EditorTab>('structure');
  const [picker, setPicker] = useState<{ roundId: string; categoryId: string; questionId: string; songId?: string } | null>(null);

  if (!config) return null;

  const startGame = () => {
    const issues = getGameStartIssues(config, songs, audioAssets);
    if (issues.length > 0) {
      window.alert(formatGameIssues(issues));
      return;
    }
    if (hasSessionProgress(session) && !window.confirm(`Начать «${config.title}» заново? Текущие баллы и прогресс партии будут сброшены.`)) return;
    gameRestarted();
    screenChanged('game');
  };

  const questionsCount = config.rounds.reduce(
    (total, round) => total + round.categories.reduce((sum, category) => sum + category.questions.length, 0),
    0,
  );
  const assignedCount = config.rounds.reduce(
    (total, round) => total + round.categories.reduce((sum, category) => sum + category.questions.filter((question) => question.songId).length, 0),
    0,
  );

  return (
    <main className="admin-page page-shell editor-page">
      <button className="editor-back" onClick={() => screenChanged('library')}>← Мои игры</button>

      <div className="page-heading editor-heading">
        <div>
          <span className="eyebrow">Редактор игры</span>
          <h1>{config.title || 'Без названия'}</h1>
          <p>{config.rounds.length} раундов · {assignedCount}/{questionsCount} песен назначено · {config.teams.length} команд</p>
        </div>
        <button className="primary-button" onClick={startGame}>▶ Начать новую игру</button>
      </div>

      <nav className="editor-tabs" aria-label="Разделы редактора">
        <EditorTabButton active={tab === 'structure'} onClick={() => setTab('structure')} label="Структура игры" description="Раунды, категории и песни" />
        <EditorTabButton active={tab === 'teams'} onClick={() => setTab('teams')} label="Команды" description="Названия и цвета" />
        <EditorTabButton active={tab === 'settings'} onClick={() => setTab('settings')} label="Настройки" description="Название и управление игрой" />
      </nav>

      {hasSessionProgress(session) && (
        <div className="session-edit-warning">
          <div>
            <strong>У этой игры есть сохранённая партия.</strong>
            <span>Изменения структуры не пересчитывают уже начисленные баллы и сыгранные вопросы. Если вы готовите новый вариант игры, лучше сбросить прогресс.</span>
          </div>
          <button className="secondary-button" onClick={() => {
            if (window.confirm('Сбросить сохранённые баллы, сыгранные вопросы и штрафы этой партии?')) gameRestarted();
          }}>Сбросить прогресс</button>
        </div>
      )}

      {tab === 'structure' && (
        <section className="editor-tab-content">
          <div className="section-intro">
            <div><h2>Структура игры</h2><p>Добавляйте раунды напрямую. Количество раундов определяется самой структурой игры.</p></div>
            <button className="secondary-button" disabled={config.rounds.length >= GAME_LIMITS.rounds} onClick={() => roundAdded()}>+ Добавить раунд</button>
          </div>

          <section className="rounds-editor">
            {config.rounds.map((round, roundIndex) => (
              <article className="round-editor" key={round.id}>
                <div className="round-editor__header round-editor__header--actions">
                  <div className="round-number">{roundIndex + 1}</div>
                  <input className="round-name-input" value={round.name} onChange={(event) => roundNameChanged({ roundId: round.id, name: event.target.value })} />
                  <button className="secondary-button" disabled={round.categories.length >= GAME_LIMITS.categoriesPerRound} onClick={() => categoryAdded({ roundId: round.id })}>+ Категория</button>
                  <button
                    className="danger-ghost"
                    disabled={config.rounds.length <= 1}
                    onClick={() => {
                      const questionCount = round.categories.reduce((sum, category) => sum + category.questions.length, 0);
                      const suffix = questionCount > 0 ? ` В нём ${questionCount} вопросов.` : '';
                      if (window.confirm(`Удалить «${round.name}»?${suffix}`)) roundRemoved(round.id);
                    }}
                  >Удалить раунд</button>
                </div>

                <div className="categories-editor">
                  {round.categories.map((category) => (
                    <section className="category-editor" key={category.id}>
                      <div className="category-editor__header">
                        <input
                          value={category.name}
                          onChange={(event) => categoryNameChanged({ roundId: round.id, categoryId: category.id, name: event.target.value })}
                          placeholder="Название категории"
                        />
                        <button
                          className="danger-ghost"
                          disabled={round.categories.length <= 1}
                          title={round.categories.length <= 1 ? 'В раунде должна остаться хотя бы одна категория' : 'Удалить категорию'}
                          onClick={() => {
                            const assigned = category.questions.filter((question) => question.songId).length;
                            const suffix = assigned > 0 ? ` В ней назначено песен: ${assigned}.` : '';
                            if (window.confirm(`Удалить категорию «${category.name}»?${suffix}`)) categoryRemoved({ roundId: round.id, categoryId: category.id });
                          }}
                        >Удалить категорию</button>
                      </div>

                      <div className="question-list">
                        {category.questions.map((question) => {
                          const song = songs.find((item) => item.id === question.songId);
                          return (
                            <article className="question-editor question-editor--library" key={question.id}>
                              <label className="field compact-field">
                                <span>Стоимость</span>
                                <DraftNumberInput
                                  value={question.points}
                                  min={1}
                                  onCommit={(points) => questionChanged({
                                    roundId: round.id,
                                    categoryId: category.id,
                                    questionId: question.id,
                                    patch: { points },
                                  })}
                                />
                              </label>

                              <div className="question-song-field">
                                <span>Песня</span>
                                {song ? (
                                  <button className="selected-song-button" onClick={() => setPicker({ roundId: round.id, categoryId: category.id, questionId: question.id, songId: song.id })}>
                                    <strong>{song.artist || 'Без исполнителя'}</strong>
                                    <span>{song.title || 'Без названия'}</span>
                                    <small>{song.minusAudioId ? 'Минус ✓' : 'Нет минуса'} · {song.plusAudioId ? 'Плюс ✓' : 'Нет плюса'}</small>
                                  </button>
                                ) : (
                                  <button className="select-song-button" onClick={() => setPicker({ roundId: round.id, categoryId: category.id, questionId: question.id })}>
                                    + Выбрать песню из медиатеки
                                  </button>
                                )}
                              </div>

                              <button
                                className="question-delete"
                                disabled={category.questions.length <= 1}
                                onClick={() => {
                                  if (question.songId && !window.confirm('Удалить вопрос с назначенной песней?')) return;
                                  questionRemoved({ roundId: round.id, categoryId: category.id, questionId: question.id });
                                }}
                                title={category.questions.length <= 1 ? 'В категории должен остаться хотя бы один вопрос' : 'Удалить вопрос'}
                              >×</button>
                            </article>
                          );
                        })}
                      </div>
                      <button className="add-question" disabled={category.questions.length >= GAME_LIMITS.questionsPerCategory} onClick={() => questionAdded({ roundId: round.id, categoryId: category.id })}>+ Добавить вопрос</button>
                    </section>
                  ))}
                </div>
              </article>
            ))}
          </section>

          <button className="add-round-card" disabled={config.rounds.length >= GAME_LIMITS.rounds} onClick={() => roundAdded()}>
            <span>＋</span><strong>Добавить раунд</strong><small>Максимум {GAME_LIMITS.rounds} раундов</small>
          </button>
        </section>
      )}

      {tab === 'teams' && (
        <section className="editor-tab-content">
          <div className="section-intro">
            <div><h2>Команды</h2><p>Цвет команды используется на табло и при выборе правильного ответа.</p></div>
            <button className="secondary-button" disabled={config.teams.length >= GAME_LIMITS.teams} onClick={() => teamAdded()}>+ Добавить команду</button>
          </div>
          <div className="team-settings-grid team-settings-grid--large">
            {config.teams.map((team, index) => (
              <article className="team-settings-card team-settings-card--large" key={team.id} style={{ '--team-color': team.color } as React.CSSProperties}>
                <div className="team-card-index">{index + 1}</div>
                <input
                  className="color-input"
                  type="color"
                  value={team.color}
                  onChange={(event) => teamChanged({ teamId: team.id, patch: { color: event.target.value } })}
                  aria-label={`Цвет ${team.name}`}
                />
                <label className="field"><span>Название команды</span><input value={team.name} onChange={(event) => teamChanged({ teamId: team.id, patch: { name: event.target.value } })} placeholder="Название команды" /></label>
                <button
                  className="danger-ghost"
                  disabled={config.teams.length <= 1}
                  onClick={() => {
                    if (hasSessionProgress(session) && !window.confirm(`Удалить команду «${team.name}»? Её текущие баллы в сохранённой партии будут потеряны.`)) return;
                    teamRemoved(team.id);
                  }}
                >Удалить</button>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === 'settings' && (
        <section className="editor-tab-content">
          <section className="admin-section">
            <div className="section-title"><div><h2>Основные настройки</h2><p>Параметры только этой игры.</p></div></div>
            <div className="game-settings-grid">
              <label className="field"><span>Название игры</span><input value={config.title} onChange={(event) => gameTitleChanged(event.target.value)} /></label>
              <div className="readonly-setting"><span>Раундов</span><strong>{config.rounds.length}</strong><small>Добавляются во вкладке «Структура игры»</small></div>
              <div className="readonly-setting"><span>Вопросов</span><strong>{questionsCount}</strong><small>{assignedCount} с назначенными песнями</small></div>
              <div className="readonly-setting"><span>Команд</span><strong>{config.teams.length}</strong><small>Настраиваются во вкладке «Команды»</small></div>
            </div>
          </section>

          <section className="danger-zone">
            <div><span className="eyebrow">Опасная зона</span><h2>Удалить игру</h2><p>Будет удалена конфигурация и сохранённая сессия. Песни из общей медиатеки останутся.</p></div>
            <button
              className="danger-button"
              onClick={() => {
                if (window.confirm(`Удалить игру «${config.title}»? Это действие нельзя отменить.`)) {
                  gameDeleted(config.id);
                  screenChanged('library');
                }
              }}
            >Удалить игру</button>
          </section>
        </section>
      )}

      <div className="admin-footer editor-footer">
        <p>Изменения сохраняются автоматически. Песни находятся в общей медиатеке и могут использоваться в других играх.</p>
        <button className="primary-button" onClick={startGame}>▶ Начать новую игру</button>
      </div>

      {picker && (
        <SongPicker
          currentSongId={picker.songId}
          onSelect={(songId) => {
            questionSongChanged({ ...picker, songId });
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </main>
  );
}

function formatGameIssues(issues: string[]) {
  const visible = issues.slice(0, 8);
  const rest = issues.length - visible.length;
  return `Игра пока не готова к запуску:

${visible.map((issue) => `• ${issue}`).join('\n')}${rest > 0 ? `\n• …и ещё ${rest}` : ''}

Исправьте эти пункты в структуре игры или медиатеке.`;
}

function EditorTabButton({ active, onClick, label, description }: { active: boolean; onClick: () => void; label: string; description: string }) {
  return (
    <button className={active ? 'editor-tab editor-tab--active' : 'editor-tab'} onClick={onClick}>
      <strong>{label}</strong><span>{description}</span>
    </button>
  );
}

function SongPicker({ currentSongId, onSelect, onClose }: { currentSongId?: string; onSelect: (songId?: string) => void; onClose: () => void }) {
  const songs = useUnit($songs);
  useEscapeClose(onClose);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? songs.filter((song) => `${song.artist} ${song.title}`.toLowerCase().includes(normalized)) : songs;
  }, [query, songs]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="song-picker-dialog" role="dialog" aria-modal="true" aria-label="Выбор песни">
        <div className="song-picker-dialog__header">
          <div><span className="eyebrow">Медиатека</span><h2>Выберите песню</h2></div>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>

        {adding ? (
          <SongForm compact onCreated={(songId) => onSelect(songId)} onCancel={() => setAdding(false)} />
        ) : (
          <>
            <div className="song-picker-toolbar">
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск песни…" />
              <button className="secondary-button" onClick={() => setAdding(true)}>+ Новая песня</button>
            </div>

            <div className="song-picker-list">
              {filtered.length === 0 ? (
                <div className="empty-state compact-empty"><p>Ничего не найдено.</p></div>
              ) : filtered.map((song) => (
                <button key={song.id} className={song.id === currentSongId ? 'song-picker-row song-picker-row--selected' : 'song-picker-row'} onClick={() => onSelect(song.id)}>
                  <div><strong>{song.artist || 'Без исполнителя'}</strong><span>{song.title || 'Без названия'}</span></div>
                  <small>{song.minusAudioId ? 'Минус ✓' : 'Нет минуса'} · {song.plusAudioId ? 'Плюс ✓' : 'Нет плюса'}</small>
                </button>
              ))}
            </div>

            {currentSongId && <button className="text-button unlink-song" onClick={() => onSelect(undefined)}>Убрать песню из вопроса</button>}
          </>
        )}
      </section>
    </div>
  );
}
