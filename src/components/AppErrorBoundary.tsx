import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render error', error, info);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="fatal-error-page" role="alert">
        <div className="fatal-error-card">
          <span className="eyebrow">Ошибка интерфейса</span>
          <h1>Не удалось отобразить приложение</h1>
          <p>Локальные данные не удалены. Можно попробовать заново отрисовать интерфейс или перезагрузить страницу.</p>
          <details>
            <summary>Техническая информация</summary>
            <code>{this.state.error.message || 'Неизвестная ошибка'}</code>
          </details>
          <div className="inline-actions">
            <button className="primary-button" onClick={this.retry}>Попробовать снова</button>
            <button className="secondary-button" onClick={() => window.location.reload()}>Перезагрузить страницу</button>
          </div>
        </div>
      </main>
    );
  }
}
