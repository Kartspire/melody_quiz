import { interRoundAdded } from '../model/game';
import { Dialog } from '../components/Dialog';
import { INTER_ROUND_TEMPLATE_LIST } from './templates';

export function InterRoundTemplateDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      eyebrow="Библиотека межраундов"
      title="Выберите готовый шаблон"
      description="Шаблон задаёт механику, правила, редактор и экран игры."
      onClose={onClose}
      className="inter-round-library-dialog"
    >
      <div className="inter-round-template-grid">
        {INTER_ROUND_TEMPLATE_LIST.map((template) => (
          <article className="inter-round-template-card" key={template.id}>
            <span className="inter-round-template-card__icon">{template.id === 'continueLyrics' ? '✎' : '4♪'}</span>
            <h3>{template.name}</h3>
            <p>{template.shortDescription}</p>
            <ul>{template.rules.slice(0, 3).map((rule) => <li key={rule}>{rule}</li>)}</ul>
            <button className="primary-button" onClick={() => { interRoundAdded(template.id); onClose(); }}>Добавить в игру</button>
          </article>
        ))}
      </div>
    </Dialog>
  );
}
