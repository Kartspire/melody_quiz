import type { ImportStats } from '../lib/melodyPackage';

type ImportVerificationSummaryProps = {
  title: string;
  stats: ImportStats;
  checks: string[];
  sectionTitle?: string;
};

export function ImportVerificationSummary({
  title,
  stats,
  checks,
  sectionTitle = 'Что будет импортировано',
}: ImportVerificationSummaryProps) {
  const songsTotal = stats.newSongs + stats.reusedSongs + stats.deduplicatedSongs;
  const tracksTotal = stats.newTracks + stats.reusedTracks + stats.deduplicatedTracks;
  const audioTotal = stats.newAudio + stats.reusedAudio;
  const nothingNew = stats.newSongs === 0 && stats.newTracks === 0 && stats.newAudio === 0;

  return (
    <div className="import-verification">
      <div className="import-verification__status">
        <span className="import-verification__icon" aria-hidden="true">✓</span>
        <div>
          <strong>{title}</strong>
          <ul className="import-check-list">{checks.map((check) => <li key={check}>{check}</li>)}</ul>
        </div>
      </div>

      <div className="import-verification__content">
        <strong className="import-section-title">{sectionTitle}</strong>
        <div className="import-summary-grid import-summary-grid--three">
          <ImportSummaryCard
            label="Песни"
            total={songsTotal}
            details={buildDetails(stats.reusedSongs, stats.newSongs, stats.deduplicatedSongs, 'совпали внутри архива')}
          />
          <ImportSummaryCard
            label="Аудиотреки"
            total={tracksTotal}
            details={buildDetails(stats.reusedTracks, stats.newTracks, stats.deduplicatedTracks, 'совпали внутри архива')}
          />
          <ImportSummaryCard
            label="Физические файлы"
            total={audioTotal}
            details={buildDetails(stats.reusedAudio, stats.newAudio, stats.internalAudioReuses, 'повторных ссылок внутри архива')}
          />
        </div>
        <p className="import-dedup-note">
          {nothingNew
            ? 'Все необходимые песни, аудиотреки и файлы уже есть в медиатеке. Дубликаты созданы не будут.'
            : 'Существующие песни, аудиотреки и физические файлы будут переиспользованы. Добавится только новое содержимое.'}
        </p>
      </div>
    </div>
  );
}

function buildDetails(reused: number, added: number, internalMatches: number, internalLabel: string) {
  return [
    `${reused} уже в медиатеке`,
    `будет добавлено: ${added}`,
    internalMatches > 0 ? `${internalMatches} ${internalLabel}` : '',
  ].filter(Boolean).join(' · ');
}

function ImportSummaryCard({ label, total, details }: { label: string; total: number; details: string }) {
  return (
    <div className="import-summary-card">
      <span>{label}</span>
      <strong>{total} всего</strong>
      <small>{details}</small>
    </div>
  );
}
