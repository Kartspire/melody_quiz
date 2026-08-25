import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';
import { appStarted } from './model/game';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { FeedbackProvider } from './components/feedback/FeedbackProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </AppErrorBoundary>
  </StrictMode>,
);

appStarted();
