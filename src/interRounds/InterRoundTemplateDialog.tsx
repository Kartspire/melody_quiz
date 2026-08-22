import { interRoundAdded } from '../model/game';
import { INTER_ROUND_TEMPLATE_LIST } from './templates';
import { useEscapeClose } from '../components/useEscapeClose';

export function InterRoundTemplateDialog({ onClose }: { onClose: () => void }) {
  useEscapeClose(onClose);
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="inter-round-library-dialog" role="dialog" aria-modal="true" aria-label="Библиотека межраундов">
        <div className="song-picker-dialog__header">
          <div><span className="eyebrow">Библиотека межраундов</span><h2>Выберите готовый шаблон</h2><p>Шаблон задаёт механику, правила, редактор и экран игры.</p></div>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>
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
      </section>
    </div>
  );
}
