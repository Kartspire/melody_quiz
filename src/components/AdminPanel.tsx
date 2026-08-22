import { useMemo, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeGame,
  $songs,
  $session,
  categoryAdded,
  categoryNameChanged,
  categoryRemoved,
  gameDeleted,
  gameProgressResetRequested,
  gameLaunchRequested,
  hasSessionProgress,
  gameTitleChanged,
  questionAdded,
  questionChanged,
  questionRemoved,
  questionSongChanged,
  roundAdded,
  roundNameChanged,
  roundRemoved,
  stageMoved,
  screenChanged,
  teamAdded,
  teamChanged,
  teamRemoved,
} from '../model/game';
import { DATA_LIMITS, GAME_LIMITS } from '../model/limits';
import { DraftNumberInput } from './DraftNumberInput';
import { SongForm } from './SongForm';
import {
  PickerDialog,
  PickerEmpty,
  PickerFooterAction,
  PickerList,
  PickerRow,
  PickerToolbar,
} from './PickerDialog';
import { InterRoundEditor } from '../interRounds/InterRoundEditor';
import { InterRoundTemplateDialog } from '../interRounds/InterRoundTemplateDialog';
import { normalizeSearchText } from '../lib/search';

type EditorTab = 'structure' | 'teams' | 'settings';

export function AdminPanel() {
  const [config, songs, session] = useUnit([$activeGame, $songs, $session]);
  const [tab, setTab] = useState<EditorTab>('structure');
  const [picker, setPicker] = useState<{ roundId: string; categoryId: string; questionId: string; songId?: string } | null>(null);
  const [showInterRoundLibrary, setShowInterRoundLibrary] = useState(false);
  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);

  if (!config) return null;

  const startGame = () => {
    gameLaunchRequested({ gameId: config.id, mode: 'fresh' });
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
          <p>{config.rounds.length} раундов · {config.interRounds.length} межраундов · {assignedCount}/{questionsCount} песен назначено · {config.teams.length} команд</p>
        </div>
        <button className="primary-button" onClick={startGame}>▶ Начать новую игру</button>
      </div>

      <nav className="editor-tabs" aria-label="Разделы редактора">
        <EditorTabButton active={tab === 'structure'} onClick={() => setTab('structure')} label="Структура игры" description="Раунды, межраунды и порядок игры" />
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
            if (window.confirm('Сбросить сохранённые баллы, сыгранные вопросы и штрафы этой партии?')) gameProgressResetRequested();
          }}>Сбросить прогресс</button>
        </div>
      )}

      {tab === 'structure' && (
        <section className="editor-tab-content">
          <div className="section-intro">
            <div><h2>Структура игры</h2><p>Раунды и межраунды идут в том порядке, в котором будут показаны во время игры. Этапы можно перемещать стрелками.</p></div>
          </div>

          <section className="rounds-editor">
            {config.stages.map((stage, stageIndex) => {
              if (stage.kind === 'interRound') {
                const interRound = config.interRounds.find((item) => item.id === stage.interRoundId);
                if (!interRound) return null;
                return (
                  <article className="round-editor inter-round-editor" key={stage.id}>
                    <div className="round-editor__header round-editor__header--actions inter-round-editor__header">
                      <div className="round-number round-number--inter">М</div>
                      <div className="inter-round-stage-title">
                        <span className="eyebrow">Этап {stageIndex + 1} · Межраунд</span>
                        <strong>{interRound.title || 'Без названия'}</strong>
                      </div>
                      <StageOrderActions
                        canMoveUp={stageIndex > 0}
                        canMoveDown={stageIndex < config.stages.length - 1}
                        onMoveUp={() => stageMoved({ stageId: stage.id, direction: -1 })}
                        onMoveDown={() => stageMoved({ stageId: stage.id, direction: 1 })}
                      />
                    </div>
                    <InterRoundEditor interRound={interRound} />
                  </article>
                );
              }

              const round = config.rounds.find((item) => item.id === stage.roundId);
              if (!round) return null;
              const roundIndex = config.stages.slice(0, stageIndex + 1).filter((item) => item.kind === 'round').length - 1;
              return (
                <article className="round-editor" key={stage.id}>
                  <div className="round-editor__header round-editor__header--actions">
                    <div className="round-number">{roundIndex + 1}</div>
                    <input className="round-name-input" maxLength={DATA_LIMITS.text.roundName} value={round.name} onChange={(event) => roundNameChanged({ roundId: round.id, name: event.target.value })} />
                    <StageOrderActions
                      canMoveUp={stageIndex > 0}
                      canMoveDown={stageIndex < config.stages.length - 1}
                      onMoveUp={() => stageMoved({ stageId: stage.id, direction: -1 })}
                      onMoveDown={() => stageMoved({ stageId: stage.id, direction: 1 })}
                    />
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
                            maxLength={DATA_LIMITS.text.categoryName}
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
                            const song = question.songId ? songById.get(question.songId) : undefined;
                            return (
                              <article className="question-editor question-editor--library" key={question.id}>
                                <label className="field compact-field">
                                  <span>Стоимость</span>
                                  <DraftNumberInput
                                    value={question.points}
                                    min={1}
                                    onCommit={(points) => questionChanged({ roundId: round.id, categoryId: category.id, questionId: question.id, patch: { points } })}
                                  />
                                </label>
                                <div className="question-song-field">
                                  <span>Песня</span>
                                  {song ? (
                                    <button className="selected-song-button" onClick={() => setPicker({ roundId: round.id, categoryId: category.id, questionId: question.id, songId: song.id })}>
                                      <strong>{song.artist || 'Без исполнителя'}</strong>
                                      <span>{song.title || 'Без названия'}</span>
                                      <small>{song.minusTrackId ? 'Минус ✓' : 'Нет минуса'} · {song.plusTrackId ? 'Плюс ✓' : 'Нет плюса'}</small>
                                    </button>
                                  ) : (
                                    <button className="select-song-button" onClick={() => setPicker({ roundId: round.id, categoryId: category.id, questionId: question.id })}>+ Выбрать песню из медиатеки</button>
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

                    <button
                      className="add-structure-card add-structure-card--category"
                      disabled={round.categories.length >= GAME_LIMITS.categoriesPerRound}
                      onClick={() => categoryAdded({ roundId: round.id })}
                    >
                      <span>＋</span><strong>Добавить категорию</strong><small>Максимум {GAME_LIMITS.categoriesPerRound} категорий в раунде</small>
                    </button>
                  </div>
                </article>
              );
            })}
          </section>

          <div className="add-stage-grid">
            <button className="add-structure-card add-structure-card--round" disabled={config.rounds.length >= GAME_LIMITS.rounds} onClick={() => roundAdded()}>
              <span>＋</span><strong>Добавить раунд</strong><small>Максимум {GAME_LIMITS.rounds} обычных раундов</small>
            </button>
            <button className="add-structure-card add-structure-card--inter-round" disabled={config.interRounds.length >= GAME_LIMITS.interRounds} onClick={() => setShowInterRoundLibrary(true)}>
              <span>＋</span><strong>Добавить межраунд</strong><small>Выбрать механику из библиотеки шаблонов</small>
            </button>
          </div>
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
                <label className="field"><span>Название команды</span><input maxLength={DATA_LIMITS.text.teamName} value={team.name} onChange={(event) => teamChanged({ teamId: team.id, patch: { name: event.target.value } })} placeholder="Название команды" /></label>
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
              <label className="field"><span>Название игры</span><input maxLength={DATA_LIMITS.text.gameTitle} value={config.title} onChange={(event) => gameTitleChanged(event.target.value)} /></label>
              <div className="readonly-setting"><span>Раундов</span><strong>{config.rounds.length}</strong><small>Добавляются во вкладке «Структура игры»</small></div>
              <div className="readonly-setting"><span>Межраундов</span><strong>{config.interRounds.length}</strong><small>Выбираются из библиотеки шаблонов</small></div>
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
      </div>

      {showInterRoundLibrary && <InterRoundTemplateDialog onClose={() => setShowInterRoundLibrary(false)} />}

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

function StageOrderActions({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="stage-order-actions" aria-label="Изменить порядок этапов">
      <button className="stage-move-button" disabled={!canMoveUp} onClick={onMoveUp} title="Переместить выше" aria-label="Переместить выше">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 12.5 10 7l5 5.5" /></svg>
      </button>
      <button className="stage-move-button" disabled={!canMoveDown} onClick={onMoveDown} title="Переместить ниже" aria-label="Переместить ниже">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5.5 5-5.5" /></svg>
      </button>
    </div>
  );
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
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const filtered = useMemo(() => {
    const normalized = normalizeSearchText(query);
    return normalized ? songs.filter((song) => normalizeSearchText(`${song.artist} ${song.title}`).includes(normalized)) : songs;
  }, [query, songs]);

  return (
    <PickerDialog eyebrow="Медиатека" title={adding ? 'Новая песня' : 'Выберите песню'} onClose={onClose}>
      {adding ? (
        <SongForm compact onCreated={(songId) => onSelect(songId)} onCancel={() => setAdding(false)} />
      ) : (
        <>
          <PickerToolbar>
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск песни…" />
            <button className="secondary-button" onClick={() => setAdding(true)}>+ Новая песня</button>
          </PickerToolbar>

          <PickerList>
            {filtered.length === 0 ? (
              <PickerEmpty>Ничего не найдено.</PickerEmpty>
            ) : filtered.map((song) => (
              <PickerRow
                key={song.id}
                selected={song.id === currentSongId}
                onClick={() => onSelect(song.id)}
                primary={song.artist || 'Без исполнителя'}
                secondary={song.title || 'Без названия'}
                meta={`${song.minusTrackId ? 'Минус ✓' : 'Нет минуса'} · ${song.plusTrackId ? 'Плюс ✓' : 'Нет плюса'}`}
              />
            ))}
          </PickerList>

          {currentSongId && (
            <PickerFooterAction>
              <button className="text-button" onClick={() => onSelect(undefined)}>Убрать песню из вопроса</button>
            </PickerFooterAction>
          )}
        </>
      )}
    </PickerDialog>
  );
}
