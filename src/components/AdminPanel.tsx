import { useUnit } from 'effector-react';
import {
  $config,
  categoryAdded,
  categoryNameChanged,
  categoryRemoved,
  gameRestarted,
  gameTitleChanged,
  questionAdded,
  questionAudioChanged,
  questionChanged,
  questionRemoved,
  roundCountChanged,
  roundNameChanged,
  screenChanged,
  teamAdded,
  teamChanged,
  teamRemoved,
} from '../model/game';
import type { AudioAsset } from '../model/types';

const fileToAsset = (file: File): AudioAsset => ({
  name: file.name,
  type: file.type,
  size: file.size,
  blob: file,
});

export function AdminPanel() {
  const config = useUnit($config);

  const startGame = () => {
    gameRestarted();
    screenChanged('game');
  };

  return (
    <main className="admin-page page-shell">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Настройки</span>
          <h1>Админ-панель</h1>
          <p>Настройте команды, раунды, категории и загрузите аудиофайлы для каждой мелодии.</p>
        </div>
        <button className="primary-button" onClick={startGame}>Начать новую игру</button>
      </div>

      <section className="admin-section">
        <div className="section-title">
          <div><h2>Основные настройки</h2><p>Название и количество раундов.</p></div>
        </div>
        <div className="settings-grid">
          <label className="field">
            <span>Название игры</span>
            <input value={config.title} onChange={(event) => gameTitleChanged(event.target.value)} />
          </label>
          <label className="field">
            <span>Количество раундов</span>
            <input
              type="number"
              min={1}
              max={10}
              value={config.rounds.length}
              onChange={(event) => roundCountChanged(Number(event.target.value))}
            />
          </label>
        </div>
      </section>

      <section className="admin-section">
        <div className="section-title">
          <div><h2>Команды</h2><p>Цвет команды используется в верхней панели и при выборе победителя вопроса.</p></div>
          <button className="secondary-button" onClick={() => teamAdded()}>+ Добавить команду</button>
        </div>
        <div className="team-settings-grid">
          {config.teams.map((team) => (
            <article className="team-settings-card" key={team.id}>
              <input
                className="color-input"
                type="color"
                value={team.color}
                onChange={(event) => teamChanged({ teamId: team.id, patch: { color: event.target.value } })}
                aria-label={`Цвет ${team.name}`}
              />
              <input
                value={team.name}
                onChange={(event) => teamChanged({ teamId: team.id, patch: { name: event.target.value } })}
                placeholder="Название команды"
              />
              <button
                className="danger-ghost"
                disabled={config.teams.length <= 1}
                onClick={() => teamRemoved(team.id)}
                title="Удалить команду"
              >
                Удалить
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="rounds-editor">
        {config.rounds.map((round, roundIndex) => (
          <article className="round-editor" key={round.id}>
            <div className="round-editor__header">
              <div className="round-number">{roundIndex + 1}</div>
              <input
                className="round-name-input"
                value={round.name}
                onChange={(event) => roundNameChanged({ roundId: round.id, name: event.target.value })}
              />
              <button className="secondary-button" onClick={() => categoryAdded({ roundId: round.id })}>
                + Категория
              </button>
            </div>

            <div className="categories-editor">
              {round.categories.map((category) => (
                <section className="category-editor" key={category.id}>
                  <div className="category-editor__header">
                    <input
                      value={category.name}
                      onChange={(event) =>
                        categoryNameChanged({ roundId: round.id, categoryId: category.id, name: event.target.value })
                      }
                      placeholder="Название категории"
                    />
                    <button
                      className="danger-ghost"
                      onClick={() => categoryRemoved({ roundId: round.id, categoryId: category.id })}
                    >
                      Удалить категорию
                    </button>
                  </div>

                  <div className="question-list">
                    {category.questions.map((question) => (
                      <article className="question-editor" key={question.id}>
                        <label className="field compact-field">
                          <span>Стоимость</span>
                          <input
                            type="number"
                            min={0}
                            step={50}
                            value={question.points}
                            onChange={(event) =>
                              questionChanged({
                                roundId: round.id,
                                categoryId: category.id,
                                questionId: question.id,
                                patch: { points: Number(event.target.value) || 0 },
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Исполнитель</span>
                          <input
                            value={question.artist}
                            placeholder="Например: Кино"
                            onChange={(event) =>
                              questionChanged({
                                roundId: round.id,
                                categoryId: category.id,
                                questionId: question.id,
                                patch: { artist: event.target.value },
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Название песни</span>
                          <input
                            value={question.title}
                            placeholder="Например: Группа крови"
                            onChange={(event) =>
                              questionChanged({
                                roundId: round.id,
                                categoryId: category.id,
                                questionId: question.id,
                                patch: { title: event.target.value },
                              })
                            }
                          />
                        </label>
                        <AudioUpload
                          label="Минус"
                          fileName={question.minus?.name}
                          onChange={(asset) =>
                            questionAudioChanged({
                              roundId: round.id,
                              categoryId: category.id,
                              questionId: question.id,
                              kind: 'minus',
                              asset,
                            })
                          }
                        />
                        <AudioUpload
                          label="Плюс"
                          fileName={question.plus?.name}
                          onChange={(asset) =>
                            questionAudioChanged({
                              roundId: round.id,
                              categoryId: category.id,
                              questionId: question.id,
                              kind: 'plus',
                              asset,
                            })
                          }
                        />
                        <button
                          className="question-delete"
                          onClick={() =>
                            questionRemoved({ roundId: round.id, categoryId: category.id, questionId: question.id })
                          }
                          title="Удалить вопрос"
                        >
                          ×
                        </button>
                      </article>
                    ))}
                  </div>
                  <button className="add-question" onClick={() => questionAdded({ roundId: round.id, categoryId: category.id })}>
                    + Добавить песню
                  </button>
                </section>
              ))}
            </div>
          </article>
        ))}
      </section>

      <div className="admin-footer">
        <p>Изменения сохраняются автоматически в этом браузере.</p>
        <button className="primary-button" onClick={startGame}>Начать новую игру</button>
      </div>
    </main>
  );
}

function AudioUpload({ label, fileName, onChange }: { label: string; fileName?: string; onChange: (asset?: AudioAsset) => void }) {
  return (
    <div className="audio-upload">
      <span>{label}</span>
      <label className={fileName ? 'file-picker file-picker--ready' : 'file-picker'}>
        <input
          type="file"
          accept="audio/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onChange(fileToAsset(file));
            event.currentTarget.value = '';
          }}
        />
        <span className="file-picker__title">{fileName ? '✓ Загружен' : 'Загрузить'}</span>
        <small title={fileName}>{fileName ?? 'MP3, WAV, OGG…'}</small>
      </label>
      {fileName && <button className="remove-file" onClick={() => onChange(undefined)}>Удалить файл</button>}
    </div>
  );
}
