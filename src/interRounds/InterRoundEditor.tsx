import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $mediaTracks,
  commonThemeChanged,
  commonThemeStageAdded,
  commonThemeStageRemoved,
  commonThemeTrackChanged,
  continueLyricsTaskAdded,
  continueLyricsTaskChanged,
  continueLyricsTaskRemoved,
  interRoundRemoved,
  interRoundTitleChanged,
} from '../model/game';
import { DATA_LIMITS, GAME_LIMITS, INTER_ROUND_LIMITS } from '../model/limits';
import type { InterRound } from '../model/types';
import { DraftNumberInput } from '../components/DraftNumberInput';
import { MediaTrackPicker } from '../components/MediaTrackPicker';
import { getInterRoundTemplate } from './templates';

export function InterRoundEditor({ interRound }: { interRound: InterRound }) {
  const mediaTracks = useUnit($mediaTracks);
  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const [picker, setPicker] = useState<{ currentTrackId?: string; onSelect: (trackId?: string) => void } | null>(null);
  const template = getInterRoundTemplate(interRound.templateId);

  const chooseTrack = (currentTrackId: string | undefined, onSelect: (trackId?: string) => void) => setPicker({ currentTrackId, onSelect });

  return (
    <div className="inter-round-editor__content">
      <div className="inter-round-template-summary">
        <div>
          <span className="eyebrow">Шаблон межраунда</span>
          <strong>{template.name}</strong>
          <p>{template.shortDescription}</p>
        </div>
      </div>

      <label className="field">
        <span>Название межраунда</span>
        <input
          maxLength={DATA_LIMITS.text.interRoundTitle}
          value={interRound.title}
          onChange={(event) => interRoundTitleChanged({ interRoundId: interRound.id, title: event.target.value })}
        />
      </label>

      <details className="inter-round-rules-preview">
        <summary>Правила, которые увидят игроки</summary>
        <h4>{template.rulesTitle}</h4>
        <ol>{template.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
      </details>

      {interRound.templateId === 'continueLyrics' ? (
        <div className="inter-round-task-list">
          {interRound.tasks.map((task, index) => {
            const track = task.trackId ? trackById.get(task.trackId) : undefined;
            return (
              <article className="inter-round-task-card" key={task.id}>
                <div className="inter-round-task-card__header">
                  <strong>Задание {index + 1}</strong>
                  <button
                    className="danger-ghost"
                    disabled={interRound.tasks.length <= 1}
                    onClick={() => continueLyricsTaskRemoved({ interRoundId: interRound.id, taskId: task.id })}
                  >Удалить</button>
                </div>
                <div className="inter-round-task-grid">
                  <div className="field">
                    <span>Аудиотрек</span>
                    <button className={track ? 'selected-song-button' : 'select-song-button'} onClick={() => chooseTrack(task.trackId, (trackId) => {
                      continueLyricsTaskChanged({ interRoundId: interRound.id, taskId: task.id, patch: { trackId } });
                      setPicker(null);
                    })}>
                      {track ? <><strong>{track.name}</strong><small>Из общей медиатеки</small></> : '+ Выбрать аудиотрек'}
                    </button>
                  </div>
                  <label className="field compact-field">
                    <span>Слов в ответе</span>
                    <DraftNumberInput
                      value={task.requiredWordsCount}
                      min={INTER_ROUND_LIMITS.continueLyrics.requiredWordsCount.min}
                      max={INTER_ROUND_LIMITS.continueLyrics.requiredWordsCount.max}
                      onCommit={(requiredWordsCount) => continueLyricsTaskChanged({ interRoundId: interRound.id, taskId: task.id, patch: { requiredWordsCount } })}
                    />
                  </label>
                  <label className="field compact-field">
                    <span>Момент остановки</span>
                    <DraftSecondsInput valueMs={task.cutAtMs} onCommit={(cutAtMs) => continueLyricsTaskChanged({ interRoundId: interRound.id, taskId: task.id, patch: { cutAtMs } })} />
                  </label>
                </div>
                <label className="field">
                  <span>Правильное продолжение текста</span>
                  <textarea
                    maxLength={DATA_LIMITS.text.interRoundAnswer}
                    value={task.answerText}
                    onChange={(event) => continueLyricsTaskChanged({ interRoundId: interRound.id, taskId: task.id, patch: { answerText: event.target.value } })}
                    placeholder="Например: я тебя никогда не забуду"
                  />
                </label>
              </article>
            );
          })}
          <button className="add-question" disabled={interRound.tasks.length >= GAME_LIMITS.continueLyricsTasks} onClick={() => continueLyricsTaskAdded(interRound.id)}>+ Добавить задание</button>
        </div>
      ) : (
        <div className="common-theme-stage-list">
          {interRound.stages.map((stage, stageIndex) => (
            <section className="common-theme-stage-editor" key={stage.id}>
              <div className="common-theme-stage-editor__header">
                <div>
                  <span className="eyebrow">Набор из четырёх треков</span>
                  <strong>Этап {stageIndex + 1}</strong>
                </div>
                <button
                  className="danger-ghost"
                  disabled={interRound.stages.length <= 1}
                  title={interRound.stages.length <= 1 ? 'В межраунде должен остаться хотя бы один этап' : 'Удалить этап'}
                  onClick={() => {
                    if (window.confirm(`Удалить этап ${stageIndex + 1} из межраунда?`)) {
                      commonThemeStageRemoved({ interRoundId: interRound.id, stageId: stage.id });
                    }
                  }}
                >Удалить этап</button>
              </div>

              <div className="inter-round-task-list common-theme-stage-editor__tracks">
                {stage.tracks.map((item, trackIndex) => {
                  const track = item.trackId ? trackById.get(item.trackId) : undefined;
                  return (
                    <article className="inter-round-task-card" key={item.id}>
                      <div className="inter-round-task-card__header"><strong>Трек {trackIndex + 1} из 4</strong></div>
                      <div className="inter-round-common-track-grid">
                        <div className="field">
                          <span>Аудиотрек</span>
                          <button className={track ? 'selected-song-button' : 'select-song-button'} onClick={() => chooseTrack(item.trackId, (trackId) => {
                            commonThemeTrackChanged({ interRoundId: interRound.id, stageId: stage.id, itemId: item.id, patch: { trackId } });
                            setPicker(null);
                          })}>
                            {track ? <><strong>{track.name}</strong><small>Из общей медиатеки</small></> : '+ Выбрать аудиотрек'}
                          </button>
                        </div>
                        <label className="field">
                          <span>Название для ответа</span>
                          <input maxLength={DATA_LIMITS.text.songTitle} value={item.answerTitle} onChange={(event) => commonThemeTrackChanged({ interRoundId: interRound.id, stageId: stage.id, itemId: item.id, patch: { answerTitle: event.target.value } })} />
                        </label>
                        <label className="field">
                          <span>Исполнитель для ответа</span>
                          <input maxLength={DATA_LIMITS.text.artist} value={item.answerArtist} onChange={(event) => commonThemeTrackChanged({ interRoundId: interRound.id, stageId: stage.id, itemId: item.id, patch: { answerArtist: event.target.value } })} />
                        </label>
                      </div>
                    </article>
                  );
                })}
              </div>

              <label className="field common-theme-stage-editor__theme">
                <span>Общая тема четырёх треков</span>
                <textarea maxLength={DATA_LIMITS.text.commonTheme} value={stage.commonTheme} onChange={(event) => commonThemeChanged({ interRoundId: interRound.id, stageId: stage.id, commonTheme: event.target.value })} placeholder="Например: лето" />
              </label>
            </section>
          ))}

          <button
            className="add-question common-theme-add-stage"
            disabled={interRound.stages.length >= GAME_LIMITS.commonThemeStages}
            onClick={() => commonThemeStageAdded(interRound.id)}
          >+ Добавить этап из 4 треков</button>
        </div>

      )}

      <div className="inter-round-danger-zone">
        <button className="danger-ghost" onClick={() => {
          if (window.confirm(`Удалить межраунд «${interRound.title}»?`)) interRoundRemoved(interRound.id);
        }}>Удалить межраунд</button>
      </div>

      {picker && <MediaTrackPicker currentTrackId={picker.currentTrackId} onSelect={picker.onSelect} onClose={() => setPicker(null)} />}
    </div>
  );
}


function DraftSecondsInput({ valueMs, onCommit }: { valueMs: number; onCommit: (valueMs: number) => void }) {
  const format = (value: number) => String(Math.round(value) / 1000).replace('.', ',');
  const [draft, setDraft] = useState(format(valueMs));
  const [focused, setFocused] = useState(false);
  const skipNextBlurCommit = useRef(false);

  useEffect(() => {
    if (!focused) setDraft(format(valueMs));
  }, [valueMs, focused]);

  const commit = () => {
    const normalized = draft.trim().replace(',', '.');
    const seconds = Number(normalized);
    if (!normalized || !Number.isFinite(seconds)) {
      setDraft(format(valueMs));
      return;
    }
    const boundedSeconds = Math.min(
      INTER_ROUND_LIMITS.continueLyrics.cutAtMs.max / 1000,
      Math.max(INTER_ROUND_LIMITS.continueLyrics.cutAtMs.min / 1000, seconds),
    );
    const nextMs = Math.round(boundedSeconds * 1000);
    setDraft(format(nextMs));
    if (nextMs !== valueMs) onCommit(nextMs);
  };

  return (
    <div className="seconds-input">
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onFocus={(event) => { setFocused(true); event.currentTarget.select(); }}
        onChange={(event) => {
          const next = event.target.value;
          if (!/^\d*(?:[.,]\d{0,3})?$/.test(next)) return;
          setDraft(next);
        }}
        onBlur={() => {
          setFocused(false);
          if (skipNextBlurCommit.current) {
            skipNextBlurCommit.current = false;
            setDraft(format(valueMs));
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            skipNextBlurCommit.current = true;
            setDraft(format(valueMs));
            event.currentTarget.blur();
          }
        }}
        aria-label="Время остановки трека в секундах"
      />
      <span>сек</span>
    </div>
  );
}
