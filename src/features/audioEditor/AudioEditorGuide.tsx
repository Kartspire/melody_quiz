import { useState } from 'react';
import { Dialog } from '../../components/Dialog';

const STEPS = [
  {
    title: '1. Добавьте исходник',
    text: 'Выберите трек из медиатеки и нажмите «Добавить в монтаж». В простом режиме новый материал автоматически раздвигает всё, что находится справа.',
    visual: '♫  Выбрать трек  →  + Добавить в монтаж',
  },
  {
    title: '2. Обрежьте нужный кусок',
    text: 'Нажмите на цветной фрагмент с waveform. Тяните его левый и правый края, чтобы оставить только нужный отрывок песни. Исходный файл при этом не меняется.',
    visual: '[──────── песня ────────]  →  [── нужный кусок ──]',
  },
  {
    title: '3. Разрежьте и переставьте',
    text: 'Поставьте вертикальный курсор внутрь фрагмента и нажмите «Разрезать по курсору» или клавишу S. После этого части можно двигать независимо.',
    visual: '[───────│───────]  →  [──────] [──────]',
  },
  {
    title: '4. Прослушайте результат',
    text: 'Клик по линейке или пустому месту ставит курсор. Нажмите ▶ или Space, чтобы слушать с этой позиции. Ctrl/Cmd + колесо мыши меняет масштаб таймлайна.',
    visual: '0:00 ────────│──────── 0:30        ▶ Space',
  },
  {
    title: '5. Сохраните готовый микс',
    text: 'Нажмите «Подготовить WAV». После рендера результат можно скачать или сразу добавить в медиатеку и использовать в игре как обычный трек.',
    visual: 'Подготовить WAV  →  Скачать WAV / В медиатеку',
  },
] as const;

export function AudioEditorGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  return (
    <Dialog
      eyebrow="Быстрый старт"
      title="Как пользоваться аудиоредактором"
      description="Пять шагов, которых достаточно, чтобы собрать первую нарезку. Расширенные инструменты можно включить позже."
      className="audio-editor-guide-dialog"
      onClose={onClose}
    >
      <div className="audio-editor-guide">
        <div className="audio-editor-guide__progress" aria-label={`Шаг ${step + 1} из ${STEPS.length}`}>
          {STEPS.map((item, index) => (
            <button
              key={item.title}
              type="button"
              className={index === step ? 'audio-editor-guide__dot audio-editor-guide__dot--active' : index < step ? 'audio-editor-guide__dot audio-editor-guide__dot--done' : 'audio-editor-guide__dot'}
              aria-label={`Перейти к шагу ${index + 1}`}
              onClick={() => setStep(index)}
            />
          ))}
        </div>
        <section className="audio-editor-guide__card">
          <span className="audio-editor-guide__step">Шаг {step + 1} из {STEPS.length}</span>
          <h3>{current.title}</h3>
          <p>{current.text}</p>
          <div className="audio-editor-guide__visual" aria-hidden="true">{current.visual}</div>
        </section>
        <div className="audio-editor-guide__footer">
          <button type="button" className="secondary-button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>← Назад</button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="primary-button" onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}>Далее →</button>
          ) : (
            <button type="button" className="primary-button" onClick={onClose}>Понятно, начать монтаж</button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function AudioEditorHelpTip({ text }: { text: string }) {
  return <span className="audio-editor-help-tip" tabIndex={0} role="note" aria-label={text} data-tooltip={text}>?</span>;
}
