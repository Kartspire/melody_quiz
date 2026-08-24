import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeInterRound,
  $audioAssets,
  $mediaTracks,
  $session,
  commonThemeTrackAdvanced,
  interRoundAnswerRevealed,
  interRoundNextRequested,
  interRoundStarted,
} from '../model/game';
import type { AudioAsset } from '../model/types';
import { useObjectUrl } from '../hooks/useObjectUrl';
import { getInterRoundTemplate } from './templates';

export function InterRoundPlayer() {
  const [interRound, session, mediaTracks, audioAssets] = useUnit([$activeInterRound, $session, $mediaTracks, $audioAssets]);
  const trackById = useMemo(() => new Map(mediaTracks.map((track) => [track.id, track])), [mediaTracks]);
  const audioById = useMemo(() => new Map(audioAssets.map((asset) => [asset.id, asset])), [audioAssets]);

  if (!interRound || !session) return null;
  const progress = session.interRound?.interRoundId === interRound.id ? session.interRound : null;
  const template = getInterRoundTemplate(interRound.templateId);

  if (!progress || progress.phase === 'intro') {
    return (
      <main className="inter-round-screen inter-round-intro page-shell">
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
      commonTheme={stage.commonTheme}
      onAdvance={() => commonThemeTrackAdvanced()}
      onReveal={() => interRoundAnswerRevealed()}
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
  onNext: () => void;
  last: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cutFrameRef = useRef<number | null>(null);
  const source = useObjectUrl(asset?.blob);
  const [playing, setPlaying] = useState(false);
  const [cutReached, setCutReached] = useState(false);

  const stopCutMonitor = () => {
    if (cutFrameRef.current !== null) cancelAnimationFrame(cutFrameRef.current);
    cutFrameRef.current = null;
  };

  const startCutMonitor = () => {
    stopCutMonitor();
    const check = () => {
      const audio = audioRef.current;
      if (!audio || phase !== 'play' || audio.paused) {
        cutFrameRef.current = null;
        return;
      }
      if (audio.currentTime * 1000 >= cutAtMs) {
        audio.pause();
        try { audio.currentTime = cutAtMs / 1000; } catch { /* ignore seek errors */ }
        setPlaying(false);
        setCutReached(true);
        cutFrameRef.current = null;
        return;
      }
      cutFrameRef.current = requestAnimationFrame(check);
    };
    cutFrameRef.current = requestAnimationFrame(check);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    let cancelled = false;
    const startAt = 0;
    audio.pause();
    audio.src = source;
    audio.load();
    setPlaying(false);
    setCutReached(phase === 'answer');

    const prepare = () => {
      if (cancelled) return;
      const safeStart = Number.isFinite(audio.duration) ? Math.min(startAt, Math.max(0, audio.duration - 0.01)) : startAt;
      try { audio.currentTime = Math.max(0, safeStart); } catch { /* metadata may still be unavailable in exotic browsers */ }
      if (phase === 'answer') {
        void audio.play().catch(() => setPlaying(false));
      }
    };

    if (audio.readyState >= 1) prepare();
    else audio.addEventListener('loadedmetadata', prepare, { once: true });
    return () => {
      cancelled = true;
      stopCutMonitor();
      audio.removeEventListener('loadedmetadata', prepare);
    };
  }, [source, phase, cutAtMs]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    if (audio.paused) {
      if (phase === 'play' && audio.currentTime >= cutAtMs / 1000) audio.currentTime = 0;
      if (phase === 'answer' && Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.05) audio.currentTime = 0;
      try {
        await audio.play();
        setPlaying(true);
        if (phase === 'play') startCutMonitor();
      } catch (error) {
        console.error('Inter-round audio playback failed', error);
        setPlaying(false);
      }
    } else {
      audio.pause();
      stopCutMonitor();
      setPlaying(false);
    }
  };

  return (
    <main className="inter-round-screen page-shell">
      <div className="inter-round-play-heading">
        <div><span className="eyebrow">{title}</span><h1>{phase === 'answer' ? 'Правильный ответ' : `Задание ${taskNumber} из ${totalTasks}`}</h1></div>
        <span className="inter-round-counter">{taskNumber}/{totalTasks}</span>
      </div>
      {phase === 'play' ? (
        <section className="lyrics-challenge-card">
          <div className="lyrics-word-count"><strong>{requiredWordsCount}</strong><span>{wordLabel(requiredWordsCount)}</span></div>
          <p>После остановки трека запишите следующие {requiredWordsCount} {wordLabel(requiredWordsCount).toLowerCase()}.</p>
          <div className="inter-round-track-name">Аудиофрагмент</div>
          <button className="primary-button" disabled={!source} onClick={() => void toggle()}>{playing ? 'Пауза' : cutReached ? 'Проиграть фрагмент заново' : '▶ Запустить фрагмент'}</button>
          <audio
            ref={audioRef}
            onPlay={() => { setPlaying(true); startCutMonitor(); }}
            onPause={() => { stopCutMonitor(); setPlaying(false); }}
            onEnded={() => { stopCutMonitor(); setPlaying(false); setCutReached(true); }}
          />
          {cutReached && <div className="inter-round-waiting-note">Трек остановлен. Дождитесь, пока команды сдадут ответы.</div>}
          <button className="secondary-button inter-round-reveal-button" disabled={!cutReached} onClick={onReveal}>Показать правильный ответ</button>
        </section>
      ) : (
        <section className="lyrics-answer-card">
          <span className="eyebrow">Нужно было написать</span>
          <blockquote>{answerText}</blockquote>
          <div className="inter-round-track-name">Полный исходный трек</div>
          <button className="primary-button" disabled={!source} onClick={() => void toggle()}>{playing ? 'Пауза' : '▶ Включить полный трек'}</button>
          <audio ref={audioRef} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
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
  commonTheme,
  onAdvance,
  onReveal,
  onNext,
  lastStage,
}: {
  title: string;
  stageNumber: number;
  totalStages: number;
  phase: 'play' | 'answer';
  playbackIndex: number;
  tracks: Array<{ id: string; answerTitle: string; answerArtist: string; asset?: AudioAsset }>;
  commonTheme: string;
  onAdvance: () => void;
  onReveal: () => void;
  onNext: () => void;
  lastStage: boolean;
}) {
  const playingComplete = playbackIndex >= tracks.length;
  const currentIndex = Math.min(Math.max(playbackIndex, 0), tracks.length - 1);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const current = tracks[currentIndex];
  const source = useObjectUrl(current?.asset?.blob);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source || phase !== 'play' || playingComplete) return;
    audio.pause();
    audio.src = source;
    audio.currentTime = 0;
    audio.load();
    setPlaying(false);
  }, [source, currentIndex, phase, playingComplete]);

  const play = async () => {
    const audio = audioRef.current;
    if (!audio || !source || playingComplete) return;
    if (!audio.paused) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch (error) {
      console.error('Inter-round audio playback failed', error);
      setPlaying(false);
    }
  };

  const advance = () => {
    const audio = audioRef.current;
    audio?.pause();
    setPlaying(false);
    onAdvance();
  };

  if (phase === 'answer') {
    return (
      <main className="inter-round-screen page-shell">
        <span className="eyebrow">{title} · Этап {stageNumber} из {totalStages}</span>
        <h1>Правильные ответы</h1>
        <section className="common-theme-answer-list">
          {tracks.map((item, index) => (
            <article key={item.id}><span>{index + 1}</span><div><strong>{item.answerArtist}</strong><p>{item.answerTitle}</p></div></article>
          ))}
        </section>
        <section className="common-theme-final-answer"><span>Общая тема</span><strong>{commonTheme}</strong></section>
        <button className="primary-button inter-round-main-action" onClick={onNext}>{lastStage ? 'Завершить межраунд →' : 'Следующий этап →'}</button>
      </main>
    );
  }

  return (
    <main className="inter-round-screen page-shell">
      <div className="inter-round-play-heading">
        <div><span className="eyebrow">Межраунд · Этап {stageNumber} из {totalStages}</span><h1>{title}</h1></div>
        <span className="inter-round-counter">{playingComplete ? '4/4' : `${currentIndex + 1}/4`}</span>
      </div>
      <section className="common-theme-player-card">
        <div className="four-track-progress">
          {tracks.map((item, index) => (
            <span key={item.id} className={playingComplete || index < currentIndex ? 'done' : index === currentIndex ? 'active' : ''}>{index + 1}</span>
          ))}
        </div>
        {playingComplete ? (
          <>
            <h2>Все четыре трека прозвучали</h2>
            <p>Дождитесь, пока команды допишут общую тему и сдадут бланки ведущему.</p>
            <button className="primary-button" onClick={onReveal}>Показать правильные ответы</button>
          </>
        ) : (
          <>
            <h2>Трек {currentIndex + 1}</h2>
            <p>Запишите название и исполнителя. После четырёх треков определите общую тему.</p>
            <button className="primary-button" disabled={!source} onClick={() => void play()}>{playing ? 'Пауза' : '▶ Включить трек'}</button>
            <audio ref={audioRef} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={advance} />
            <div className="inter-round-inline-actions">
              <button className="secondary-button" onClick={advance}>{currentIndex < 3 ? 'Следующий трек →' : 'Закончить прослушивание →'}</button>
            </div>
          </>
        )}
      </section>
    </main>
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
