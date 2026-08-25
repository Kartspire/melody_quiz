export function NoResults({ onClear }: { onClear: () => void }) {
  return <div className="empty-state"><h2>Ничего не найдено</h2><p>Попробуйте изменить запрос или очистить строку поиска.</p><button className="secondary-button" onClick={onClear}>Очистить поиск</button></div>;
}
