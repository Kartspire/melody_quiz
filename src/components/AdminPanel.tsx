import { useMemo, useState } from 'react';
import { useUnit } from 'effector-react';
import {
  $activeGame,
  $songs,
  $session,
  gameLaunchRequested,
  gameProgressResetRequested,
  hasSessionProgress,
  questionSongChanged,
  screenChanged,
} from '../model/game';
import { InterRoundTemplateDialog } from '../interRounds/InterRoundTemplateDialog';
import { SongPicker } from './SongPicker';
import { AdminSettingsTab } from './admin/AdminSettingsTab';
import { AdminStructureTab, type QuestionSongPickerTarget } from './admin/AdminStructureTab';
import { AdminTeamsTab } from './admin/AdminTeamsTab';
import { useFeedback } from './feedback/FeedbackProvider';

type EditorTab = 'structure' | 'teams' | 'settings';

export function AdminPanel() {
  const [config, songs, session] = useUnit([$activeGame, $songs, $session]);
  const { confirm } = useFeedback();
  const [tab, setTab] = useState<EditorTab>('structure');
  const [picker, setPicker] = useState<QuestionSongPickerTarget | null>(null);
  const [showInterRoundLibrary, setShowInterRoundLibrary] = useState(false);
  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);

  if (!config) return null;

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
        <button className="primary-button" onClick={() => gameLaunchRequested({ gameId: config.id, mode: 'fresh' })}>▶ Начать новую игру</button>
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
            void confirm({
              title: 'Сбросить сохранённую партию?',
              description: 'Баллы, сыгранные вопросы, штрафы и текущий этап будут сброшены.',
              confirmLabel: 'Сбросить прогресс',
              tone: 'danger',
            }).then((confirmed) => { if (confirmed) gameProgressResetRequested(); });
          }}>Сбросить прогресс</button>
        </div>
      )}

      {tab === 'structure' && (
        <AdminStructureTab
          config={config}
          songById={songById}
          onPickSong={setPicker}
          onAddInterRound={() => setShowInterRoundLibrary(true)}
        />
      )}
      {tab === 'teams' && <AdminTeamsTab config={config} session={session} />}
      {tab === 'settings' && <AdminSettingsTab config={config} questionsCount={questionsCount} assignedCount={assignedCount} />}

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

function EditorTabButton({ active, onClick, label, description }: { active: boolean; onClick: () => void; label: string; description: string }) {
  return (
    <button className={active ? 'editor-tab editor-tab--active' : 'editor-tab'} onClick={onClick}>
      <strong>{label}</strong><span>{description}</span>
    </button>
  );
}
