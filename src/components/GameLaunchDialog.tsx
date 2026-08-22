import { useUnit } from 'effector-react';
import {
  $gameLaunchPrompt,
  gameLaunchPromptDismissed,
  gameLaunchRestartConfirmed,
} from '../model/game';
import { Dialog } from './Dialog';

const MAX_VISIBLE_ISSUES = 8;

export function GameLaunchDialog() {
  const prompt = useUnit($gameLaunchPrompt);
  if (!prompt) return null;

  if (prompt.type === 'confirm-restart') {
    return (
      <Dialog
        eyebrow="Новая партия"
        title={`Начать «${prompt.gameTitle || 'Без названия'}» заново?`}
        description="Текущие баллы и прогресс сохранённой партии будут сброшены. Настройки самой игры и медиатека не изменятся."
        onClose={() => gameLaunchPromptDismissed()}
        className="game-launch-dialog"
      >
        <div className="game-launch-dialog__actions">
          <button className="primary-button" autoFocus onClick={() => gameLaunchRestartConfirmed()}>Начать заново</button>
          <button className="secondary-button" onClick={() => gameLaunchPromptDismissed()}>Отмена</button>
        </div>
      </Dialog>
    );
  }

  const visibleIssues = prompt.issues.slice(0, MAX_VISIBLE_ISSUES);
  const hiddenCount = prompt.issues.length - visibleIssues.length;

  return (
    <Dialog
      eyebrow="Проверка игры"
      title="Игра пока не готова к запуску"
      description={`Исправьте проблемы в редакторе «${prompt.gameTitle || 'Без названия'}», затем попробуйте запустить игру снова.`}
      onClose={() => gameLaunchPromptDismissed()}
      className="game-launch-dialog"
    >
      <ul className="game-launch-dialog__issues">
        {visibleIssues.map((issue, index) => <li key={`${index}:${issue}`}>{issue}</li>)}
        {hiddenCount > 0 && <li>…и ещё {hiddenCount}</li>}
      </ul>
      <div className="game-launch-dialog__actions">
        <button className="primary-button" autoFocus onClick={() => gameLaunchPromptDismissed()}>Перейти к исправлению</button>
      </div>
    </Dialog>
  );
}
