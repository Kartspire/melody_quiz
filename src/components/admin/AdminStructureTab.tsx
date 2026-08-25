import { useState } from 'react';
import {
  categoryAdded,
  categoryNameChanged,
  categoryRemoved,
  questionAdded,
  questionChanged,
  questionRemoved,
  roundAdded,
  roundNameChanged,
  roundRemoved,
  stageMoved,
} from '../../model/game';
import { DATA_LIMITS, EDITOR_LIMITS, GAME_LIMITS } from '../../model/limits';
import type { GameConfig, Song } from '../../model/types';
import { InterRoundEditor } from '../../interRounds/InterRoundEditor';
import { DraftNumberInput } from '../DraftNumberInput';
import { useFeedback } from '../feedback/FeedbackProvider';

export type QuestionSongPickerTarget = {
  roundId: string;
  categoryId: string;
  questionId: string;
  songId?: string;
};

export function AdminStructureTab({
  config,
  songById,
  onPickSong,
  onAddInterRound,
}: {
  config: GameConfig;
  songById: Map<string, Song>;
  onPickSong: (target: QuestionSongPickerTarget) => void;
  onAddInterRound: () => void;
}) {
  const { confirm } = useFeedback();
  const [visibleCategoryCounts, setVisibleCategoryCounts] = useState<Record<string, number>>({});
  const [visibleQuestionCounts, setVisibleQuestionCounts] = useState<Record<string, number>>({});

  return (
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
          const visibleCategories = visibleCategoryCounts[round.id] ?? EDITOR_LIMITS.categoriesPerRound;

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
                    void confirm({
                      title: `Удалить «${round.name}»?`,
                      description: questionCount > 0 ? `В раунде ${questionCount} вопросов. Это действие нельзя отменить.` : 'Это действие нельзя отменить.',
                      confirmLabel: 'Удалить раунд',
                      tone: 'danger',
                    }).then((confirmed) => { if (confirmed) roundRemoved(round.id); });
                  }}
                >Удалить раунд</button>
              </div>

              <div className="categories-editor">
                {round.categories.slice(0, visibleCategories).map((category) => {
                  const visibleQuestions = visibleQuestionCounts[category.id] ?? EDITOR_LIMITS.questionsPerCategory;
                  return (
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
                            void confirm({
                              title: `Удалить категорию «${category.name}»?`,
                              description: assigned > 0 ? `В категории назначено песен: ${assigned}. Это действие нельзя отменить.` : 'Это действие нельзя отменить.',
                              confirmLabel: 'Удалить категорию',
                              tone: 'danger',
                            }).then((confirmed) => {
                              if (confirmed) categoryRemoved({ roundId: round.id, categoryId: category.id });
                            });
                          }}
                        >Удалить категорию</button>
                      </div>

                      <div className="question-list">
                        {category.questions.slice(0, visibleQuestions).map((question) => {
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
                                  <button className="selected-song-button" onClick={() => onPickSong({ roundId: round.id, categoryId: category.id, questionId: question.id, songId: song.id })}>
                                    <strong>{song.artist || 'Без исполнителя'}</strong>
                                    <span>{song.title || 'Без названия'}</span>
                                    <small>{song.minusTrackId ? 'Минус ✓' : 'Нет минуса'} · {song.plusTrackId ? 'Плюс ✓' : 'Нет плюса'}</small>
                                  </button>
                                ) : (
                                  <button className="select-song-button" onClick={() => onPickSong({ roundId: round.id, categoryId: category.id, questionId: question.id })}>+ Выбрать песню из медиатеки</button>
                                )}
                              </div>
                              <button
                                className="question-delete"
                                disabled={category.questions.length <= 1}
                                onClick={() => {
                                  const remove = () => questionRemoved({ roundId: round.id, categoryId: category.id, questionId: question.id });
                                  if (!question.songId) {
                                    remove();
                                    return;
                                  }
                                  void confirm({
                                    title: 'Удалить вопрос с назначенной песней?',
                                    description: 'Песня останется в общей медиатеке.',
                                    confirmLabel: 'Удалить вопрос',
                                    tone: 'danger',
                                  }).then((confirmed) => { if (confirmed) remove(); });
                                }}
                                title={category.questions.length <= 1 ? 'В категории должен остаться хотя бы один вопрос' : 'Удалить вопрос'}
                              >×</button>
                            </article>
                          );
                        })}
                      </div>

                      {category.questions.length > visibleQuestions && (
                        <button
                          className="secondary-button editor-load-more"
                          onClick={() => setVisibleQuestionCounts((counts) => ({
                            ...counts,
                            [category.id]: visibleQuestions + EDITOR_LIMITS.questionsPerCategory,
                          }))}
                        >Показать ещё вопросы</button>
                      )}
                      <button className="add-question" disabled={category.questions.length >= EDITOR_LIMITS.questionsPerCategory} onClick={() => questionAdded({ roundId: round.id, categoryId: category.id })}>+ Добавить вопрос</button>
                    </section>
                  );
                })}

                {round.categories.length > visibleCategories && (
                  <button
                    className="secondary-button editor-load-more editor-load-more--categories"
                    onClick={() => setVisibleCategoryCounts((counts) => ({
                      ...counts,
                      [round.id]: visibleCategories + EDITOR_LIMITS.categoriesPerRound,
                    }))}
                  >Показать ещё категории</button>
                )}

                <button
                  className="add-structure-card add-structure-card--category"
                  disabled={round.categories.length >= EDITOR_LIMITS.categoriesPerRound}
                  onClick={() => categoryAdded({ roundId: round.id })}
                >
                  <span>＋</span><strong>Добавить категорию</strong><small>Максимум {EDITOR_LIMITS.categoriesPerRound} категорий в раунде</small>
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
        <button className="add-structure-card add-structure-card--inter-round" disabled={config.interRounds.length >= GAME_LIMITS.interRounds} onClick={onAddInterRound}>
          <span>＋</span><strong>Добавить межраунд</strong><small>Выбрать механику из библиотеки шаблонов</small>
        </button>
      </div>
    </section>
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
