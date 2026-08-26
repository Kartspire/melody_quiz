import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $audioAssets,
  $mediaTracks,
  commonThemeChanged,
  commonThemeStageAdded,
  commonThemeStageRemoved,
  commonThemeTrackChanged,
  continueLyricsTaskAdded,
  continueLyricsTaskChanged,
  continueLyricsTaskRemoved,
  interRoundRemoved,
  interRoundRulesChanged,
  interRoundTitleChanged,
} from '../model/game';
import { DATA_LIMITS, GAME_LIMITS, INTER_ROUND_LIMITS } from '../model/limits';
import type { AudioAsset, InterRound } from '../model/types';
import { DraftNumberInput } from '../components/DraftNumberInput';
import { MediaTrackPicker } from '../components/MediaTrackPicker';
import { useFeedback } from '../components/feedback/FeedbackProvider';
import { AudioTimeline } from '../components/AudioTimeline';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { getInterRoundRules, getInterRoundTemplate } from './templates';

export function InterRoundEditor({ interRound }: { interRound: InterRound }) {
  const [mediaTracks, audioAssets] = useUnit([$mediaTracks, $audioAssets]);
  const { confirm } = useFeedback();
  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const audioById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);
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

      <label className="field inter-round-rules-editor">
        <span>Правила перед межраундом</span>
        <textarea
          maxLength={DATA_LIMITS.text.interRoundRules}
          rows={6}
          value={interRound.rules}
          onChange={(event) => interRoundRulesChanged({ interRoundId: interRound.id, rules: event.target.value })}
        />
        <small className="field-hint">Каждая непустая строка отображается отдельным пунктом правил.</small>
      </label>

      <details className="inter-round-rules-preview">
        <summary>Предпросмотр правил</summary>
        <h4>{template.rulesTitle}</h4>
        <ol>{getInterRoundRules(interRound).map((rule, index) => <li key={`${index}:${rule}`}>{rule}</li>)}</ol>
      </details>

      {interRound.templateId === 'continueLyrics' ? (
        <div className="inter-round-task-list">
          {interRound.tasks.map((task, index) => {
            const track = task.trackId ? trackById.get(task.trackId) : undefined;
            const asset = track ? audioById.get(track.audioId) : undefined;
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
                    <small className="field-hint">Можно дробно, например 12,5 сек</small>
                  </label>
                </div>
                <ContinueLyricsFragmentPreview asset={asset} cutAtMs={task.cutAtMs} />
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
                    void confirm({
                      title: `Удалить этап ${stageIndex + 1} из межраунда?`,
                      description: 'Все четыре назначения треков и ответ для этого этапа будут удалены.',
                      confirmLabel: 'Удалить этап',
                      tone: 'danger',
                    }).then((confirmed) => {
                      if (confirmed) commonThemeStageRemoved({ interRoundId: interRound.id, stageId: stage.id });
                    });
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
          void confirm({
            title: `Удалить межраунд «${interRound.title}»?`,
            description: 'Межраунд и все его задания будут удалены из структуры игры.',
            confirmLabel: 'Удалить межраунд',
            tone: 'danger',
          }).then((confirmed) => { if (confirmed) interRoundRemoved(interRound.id); });
        }}>Удалить межраунд</button>
      </div>

      {picker && <MediaTrackPicker currentTrackId={picker.currentTrackId} onSelect={picker.onSelect} onClose={() => setPicker(null)} />}
    </div>
  );
}



function ContinueLyricsFragmentPreview({ asset, cutAtMs }: { asset?: AudioAsset; cutAtMs: number }) {
  const source = useObjectUrl(asset?.blob);
  const cutAtSeconds = cutAtMs / 1000;
  const player = useAudioPlayer({
    source,
    startAt: 0,
    stopAt: cutAtSeconds,
    resetOnRangeChange: true,
    rangeEndBehavior: 'reset',
    playErrorMessage: 'Не удалось воспроизвести фрагмент межраунда.',
    mediaErrorMessage: 'Браузер не смог прочитать аудиофайл межраунда.',
  });
  const visibleDuration = player.duration > 0 ? Math.min(player.duration, cutAtSeconds) : cutAtSeconds;

  return (
    <div className="continue-lyrics-preview">
      <div className="continue-lyrics-preview__heading">
        <div>
          <span className="eyebrow">Предпрослушивание</span>
          <strong>От начала трека до {formatSeconds(cutAtMs)} сек</strong>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!source}
          onClick={() => void player.toggle()}
        >
          {player.playing ? 'Пауза' : '▶ Прослушать фрагмент'}
        </button>
      </div>
      {source ? (
        <>
          <audio ref={player.audioRef} src={source} preload="metadata" />
          <AudioTimeline
            className="continue-lyrics-preview__timeline"
            progress={Math.min(player.currentTime, visibleDuration)}
            duration={visibleDuration}
            onSeek={(time) => player.seek(Math.min(time, visibleDuration))}
          />
          {player.error && <p className="audio-playback-error" role="alert">{player.error}</p>}
        </>
      ) : (
        <p className="continue-lyrics-preview__empty">Выберите аудиотрек, чтобы проверить игровой фрагмент.</p>
      )}
    </div>
  );
}

function formatSeconds(valueMs: number) {
  return String(Math.round(valueMs) / 1000).replace('.', ',');
}

function DraftSecondsInput({ valueMs, onCommit }: { valueMs: number; onCommit: (valueMs: number) => void }) {
  const format = formatSeconds;
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
