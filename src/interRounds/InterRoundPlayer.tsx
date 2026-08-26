import { useEffect, useMemo, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeInterRound,
  $audioAssets,
  $canGoToPreviousStage,
  $mediaTracks,
  $session,
  commonThemeTrackAdvanced,
  interRoundAnswerRevealed,
  interRoundNextRequested,
  interRoundStarted,
  previousStageRequested,
} from '../model/game';
import type { AudioAsset } from '../model/types';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { AudioTimeline } from '../components/AudioTimeline';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { getInterRoundTemplate } from './templates';

export function InterRoundPlayer() {
  const [interRound, session, canGoBack, mediaTracks, audioAssets] = useUnit([
    $activeInterRound,
    $session,
    $canGoToPreviousStage,
    $mediaTracks,
    $audioAssets,
  ]);
  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const audioById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);

  if (!interRound || !session) return null;
  const progress = session.interRound?.interRoundId === interRound.id ? session.interRound : null;
  const template = getInterRoundTemplate(interRound.templateId);

  if (!progress || progress.phase === 'intro') {
    return (
      <main className="inter-round-screen inter-round-intro page-shell">
        {canGoBack && <GameBackButton onBack={() => previousStageRequested()} />}
        <span className="eyebrow">Межраунд</span>
        <h1>{interRound.title}</h1>
        <section className="inter-round-rules-card">
          <h2>{template.rulesTitle}</h2>
          <ol>{template.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
        </section>
        <p className="inter-round-scoring-note">Баллы за межраунд ведущий начисляет вручную через табло команд.</p>
        <button className="primary-button inter-round-main-action" onClick={() => interRoundStarted()}>Начать межраунд</button>
      </main>
    );
  }

  if (interRound.templateId === 'continueLyrics') {
    const taskIndex = Math.min(progress.taskIndex, interRound.tasks.length - 1);
    const task = interRound.tasks[taskIndex];
    const resolved = resolveTrack(task.trackId, trackById, audioById);
    return (
      <ContinueLyricsPlayer
        key={`${interRound.id}:${task.id}`}
        title={interRound.title}
        taskNumber={taskIndex + 1}
        totalTasks={interRound.tasks.length}
        phase={progress.phase}
        requiredWordsCount={task.requiredWordsCount}
        cutAtMs={task.cutAtMs}
        answerText={task.answerText}
        asset={resolved.asset}
        onReveal={() => interRoundAnswerRevealed()}
        onBack={() => previousStageRequested()}
        onNext={() => interRoundNextRequested()}
        last={taskIndex === interRound.tasks.length - 1}
      />
    );
  }

  const stageIndex = Math.min(progress.taskIndex, interRound.stages.length - 1);
  const stage = interRound.stages[stageIndex];
  const resolved = stage.tracks.map((item) => resolveTrack(item.trackId, trackById, audioById));
  return (
    <CommonThemePlayer
      key={`${interRound.id}:${stage.id}:${progress.phase}`}
      title={interRound.title}
      stageNumber={stageIndex + 1}
      totalStages={interRound.stages.length}
      phase={progress.phase}
      playbackIndex={progress.trackIndex}
      tracks={stage.tracks.map((item, index) => ({ ...item, ...resolved[index] }))}
      answerStages={interRound.stages}
      onAdvance={() => commonThemeTrackAdvanced()}
      onReveal={() => interRoundAnswerRevealed()}
      onBack={() => previousStageRequested()}
      onNext={() => interRoundNextRequested()}
      lastStage={stageIndex === interRound.stages.length - 1}
    />
  );
}

function ContinueLyricsPlayer({
  title,
  taskNumber,
  totalTasks,
  phase,
  requiredWordsCount,
  cutAtMs,
  answerText,
  asset,
  onReveal,
  onBack,
  onNext,
  last,
}: {
  title: string;
  taskNumber: number;
  totalTasks: number;
  phase: 'play' | 'answer';
  requiredWordsCount: number;
  cutAtMs: number;
  answerText: string;
  asset?: AudioAsset;
  onReveal: () => void;
  onBack: () => void;
  onNext: () => void;
  last: boolean;
}) {
  const source = useObjectUrl(asset?.blob);
  const cutAtSeconds = cutAtMs / 1000;
  const [cutReached, setCutReached] = useState(phase === 'answer');
  const player = useAudioPlayer({
    source,
    autoPlay: phase === 'answer' && Boolean(source),
    startAt: 0,
    stopAt: phase === 'play' ? cutAtSeconds : undefined,
    resetOnRangeChange: true,
    rangeEndBehavior: 'pause',
    onRangeEnd: () => setCutReached(true),
    playErrorMessage: 'Не удалось запустить аудио межраунда.',
    mediaErrorMessage: 'Браузер не смог прочитать аудиофайл межраунда.',
  });

  useEffect(() => {
    setCutReached(phase === 'answer');
  }, [phase, cutAtMs, asset?.id]);

  return (
    <main className="inter-round-screen page-shell">
      <GameBackButton onBack={onBack} />
      <audio ref={player.audioRef} src={source ?? undefined} preload="auto" />
      <div className="inter-round-play-heading">
        <div><span className="eyebrow">{title}</span><h1>{phase === 'answer' ? 'Правильный ответ' : `Задание ${taskNumber} из ${totalTasks}`}</h1></div>
        <span className="inter-round-counter">{taskNumber}/{totalTasks}</span>
      </div>
      {phase === 'play' ? (
        <section className="lyrics-challenge-card">
          <div className="lyrics-word-count"><strong>{requiredWordsCount}</strong><span>{wordLabel(requiredWordsCount)}</span></div>
          <p>После остановки трека запишите следующие {requiredWordsCount} {wordLabel(requiredWordsCount).toLowerCase()}.</p>
          <div className="inter-round-track-name">Аудиофрагмент</div>
          <button className="primary-button" disabled={!source} onClick={() => void player.toggle()}>{player.playing ? 'Пауза' : cutReached ? 'Проиграть фрагмент заново' : '▶ Запустить фрагмент'}</button>
          {player.error && <p className="audio-playback-error" role="alert">{player.error}</p>}
          {source && (
            <AudioTimeline
              className="inter-round-audio-timeline"
              progress={Math.min(player.currentTime, cutAtSeconds)}
              duration={player.duration ? Math.min(player.duration, cutAtSeconds) : 0}
              onSeek={(time) => {
                player.seek(time);
                if (time >= cutAtSeconds - 0.05) setCutReached(true);
              }}
            />
          )}
          {cutReached && <div className="inter-round-waiting-note">Трек остановлен. Дождитесь, пока команды сдадут ответы.</div>}
          <button className="secondary-button inter-round-reveal-button" disabled={!cutReached} onClick={onReveal}>Показать правильный ответ</button>
        </section>
      ) : (
        <section className="lyrics-answer-card">
          <span className="eyebrow">Нужно было написать</span>
          <blockquote>{answerText}</blockquote>
          <div className="inter-round-track-name">Полный исходный трек</div>
          <button className="primary-button" disabled={!source} onClick={() => void player.toggle()}>{player.playing ? 'Пауза' : '▶ Включить полный трек'}</button>
          {player.error && <p className="audio-playback-error" role="alert">{player.error}</p>}
          {source && (
            <AudioTimeline
              className="inter-round-audio-timeline"
              progress={player.currentTime}
              duration={player.duration}
              onSeek={player.seek}
            />
          )}
          <button className="secondary-button inter-round-next-button" onClick={onNext}>{last ? 'Завершить межраунд →' : 'Следующее задание →'}</button>
        </section>
      )}
    </main>
  );
}

function CommonThemePlayer({
  title,
  stageNumber,
  totalStages,
  phase,
  playbackIndex,
  tracks,
  answerStages,
  onAdvance,
  onReveal,
  onBack,
  onNext,
  lastStage,
}: {
  title: string;
  stageNumber: number;
  totalStages: number;
  phase: 'play' | 'answer';
  playbackIndex: number;
  tracks: Array<{ id: string; answerTitle: string; answerArtist: string; asset?: AudioAsset }>;
  answerStages: Array<{
    id: string;
    tracks: Array<{ id: string; answerTitle: string; answerArtist: string }>;
    commonTheme: string;
  }>;
  onAdvance: () => void;
  onReveal: () => void;
  onBack: () => void;
  onNext: () => void;
  lastStage: boolean;
}) {
  const playingComplete = playbackIndex >= tracks.length;
  const currentIndex = Math.min(Math.max(playbackIndex, 0), tracks.length - 1);
  const current = tracks[currentIndex];
  const source = useObjectUrl(current?.asset?.blob);
  const activeSource = phase === 'play' && !playingComplete ? source : null;
  const player = useAudioPlayer({
    source: activeSource,
    onEnded: onAdvance,
    playErrorMessage: 'Не удалось запустить трек межраунда.',
    mediaErrorMessage: 'Браузер не смог прочитать трек межраунда.',
  });

  const advance = () => {
    player.pause();
    onAdvance();
  };

  if (phase === 'answer') {
    return (
      <main className="inter-round-screen page-shell">
        <GameBackButton onBack={onBack} />
        <span className="eyebrow">{title} · Все этапы завершены</span>
        <h1>Правильные ответы</h1>
        <div className="common-theme-all-answers">
          {answerStages.map((answerStage, answerStageIndex) => (
            <section className="common-theme-answer-stage" key={answerStage.id}>
              <div className="common-theme-answer-stage__heading">
                <span className="eyebrow">Этап {answerStageIndex + 1} из {answerStages.length}</span>
                <h2>Ответы этапа {answerStageIndex + 1}</h2>
              </div>
              <div className="common-theme-answer-list">
                {answerStage.tracks.map((item, index) => (
                  <article key={item.id}>
                    <span>{index + 1}</span>
                    <div><strong>{item.answerArtist}</strong><p>{item.answerTitle}</p></div>
                  </article>
                ))}
              </div>
              <div className="common-theme-final-answer">
                <span>Общая тема</span>
                <strong>{answerStage.commonTheme}</strong>
              </div>
            </section>
          ))}
        </div>
        <button className="primary-button inter-round-main-action" onClick={onNext}>Завершить межраунд →</button>
      </main>
    );
  }

  return (
    <main className="inter-round-screen page-shell">
      <GameBackButton onBack={onBack} />
      <audio ref={player.audioRef} src={activeSource ?? undefined} preload="auto" />
      <div className="inter-round-play-heading">
        <div><span className="eyebrow">Межраунд · Этап {stageNumber} из {totalStages}</span><h1>{title}</h1></div>
        <span className="inter-round-counter">{playingComplete ? `${tracks.length}/${tracks.length}` : `${currentIndex + 1}/${tracks.length}`}</span>
      </div>
      <section className="common-theme-player-card">
        <div className="four-track-progress">
          {tracks.map((item, index) => (
            <span key={item.id} className={playingComplete || index < currentIndex ? 'done' : index === currentIndex ? 'active' : ''}>{index + 1}</span>
          ))}
        </div>
        {playingComplete ? (
          <>
            <h2>{lastStage ? 'Все этапы межраунда сыграны' : `Этап ${stageNumber} завершён`}</h2>
            <p>
              {lastStage
                ? 'Все треки прозвучали. После сдачи бланков можно показать ответы сразу по всем этапам.'
                : 'Ответы пока не показываются. Переходите к следующему этапу — все ответы будут показаны в самом конце межраунда.'}
            </p>
            <button className="primary-button" onClick={lastStage ? onReveal : onNext}>
              {lastStage ? 'Показать все правильные ответы' : 'Следующий этап →'}
            </button>
          </>
        ) : (
          <>
            <h2>Трек {currentIndex + 1}</h2>
            <p>Запишите название и исполнителя. После четырёх треков определите общую тему.</p>
            <button className="primary-button" disabled={!activeSource} onClick={() => void player.toggle()}>{player.playing ? 'Пауза' : '▶ Включить трек'}</button>
            {player.error && <p className="audio-playback-error" role="alert">{player.error}</p>}
            {activeSource && (
              <AudioTimeline
                className="inter-round-audio-timeline"
                progress={player.currentTime}
                duration={player.duration}
                onSeek={player.seek}
              />
            )}
            <div className="inter-round-inline-actions">
              <button className="secondary-button" onClick={advance}>{currentIndex < tracks.length - 1 ? 'Следующий трек →' : 'Закончить прослушивание →'}</button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function GameBackButton({ onBack }: { onBack: () => void }) {
  return (
    <div className="game-step-navigation">
      <button className="text-button game-back-button" onClick={onBack}>← Вернуться на предыдущий этап</button>
    </div>
  );
}

function resolveTrack(trackId: string | undefined, trackById: Map<string, { audioId: string }>, audioById: Map<string, AudioAsset>) {
  const track = trackId ? trackById.get(trackId) : undefined;
  return { asset: track ? audioById.get(track.audioId) : undefined };
}

function wordLabel(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'слово';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'слова';
  return 'слов';
}
