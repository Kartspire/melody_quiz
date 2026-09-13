export function AudioEditorQuickStart({ clipCount, selectedCount, hasRendered }: {
  clipCount: number;
  selectedCount: number;
  hasRendered: boolean;
}) {
  const activeStep = clipCount === 0 ? 0 : hasRendered ? 3 : selectedCount === 0 ? 1 : 2;
  const steps = [
    ['1', 'Добавьте трек', 'Выберите песню выше и нажмите «Добавить в монтаж».'],
    ['2', 'Выберите и обрежьте', 'Кликните по фрагменту и тяните его края.'],
    ['3', 'Прослушайте', 'Поставьте курсор и нажмите ▶ или Space.'],
    ['4', 'Сохраните', 'Внизу нажмите «Подготовить WAV».'],
  ] as const;

  return (
    <section className="audio-editor-quick-start" aria-label="Быстрый порядок работы">
      {steps.map(([number, title, text], index) => (
        <div key={number} className={`audio-editor-quick-start__step${index === activeStep ? ' audio-editor-quick-start__step--active' : ''}${index < activeStep ? ' audio-editor-quick-start__step--done' : ''}`}>
          <span>{index < activeStep ? '✓' : number}</span>
          <div><strong>{title}</strong><small>{text}</small></div>
        </div>
      ))}
    </section>
  );
}
