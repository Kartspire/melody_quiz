import { createInitialState, createRound, createRoundStage, createSession } from '../../src/model/defaults';
import { loadState, restoreState, saveState } from '../../src/lib/storage';
import { exportAppBackup, parseAppBackup } from '../../src/lib/appBackup';
import { transitionGameSession } from '../../src/model/games/domain/sessionTransitions';
import { createAudioProject } from '../../src/features/audioEditor/audioProject';

if (import.meta.env.MODE !== 'test-browser') throw new Error('Запустите npm run test:browser');
const run = document.querySelector<HTMLButtonElement>('#run')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const corrupt = document.querySelector<HTMLButtonElement>('#corrupt')!;

run.onclick = async () => {
  run.disabled = true;
  corrupt.disabled = true;
  results.replaceChildren();
  summary.textContent = 'Проверяем…';
  let passed = 0;
  let peer: HTMLIFrameElement | undefined;
  const check = async (title: string, action: () => Promise<void>) => {
    const item = document.createElement('li');
    results.append(item);
    try { await action(); item.textContent = `PASS: ${title}`; passed += 1; }
    catch (error) { item.textContent = `FAIL: ${title}: ${String(error)}`; throw error; }
  };
  try {
    const initial = createInitialState();
    await restoreState(initial);
    await check('Сохранение и повторная загрузка партии', async () => {
      const game = initial.games[0];
      const round = createRound(1);
      game.rounds.push(round);
      game.stages.push(createRoundStage(round.id));
      let session = transitionGameSession(game, createSession(game), { type: 'nextStage' });
      session = transitionGameSession(game, session, { type: 'openQuestion', questionId: round.categories[0].questions[0].id });
      session = transitionGameSession(game, session, { type: 'awardTeam', teamId: game.teams[0].id });
      session = transitionGameSession(game, session, { type: 'closeQuestion', completed: true });
      await restoreState({ ...initial, sessions: [session] });
      const reloaded = await loadState();
      assert(reloaded.sessions[0].selectingTeamId === game.teams[0].id, 'Изменилась выбирающая команда');
    });
    await check('Полная копия проходит экспорт, проверку и восстановление', async () => {
      const state = await loadState();
      const backup = await exportAppBackup(state);
      const parsed = await parseAppBackup(backup.blob);
      await restoreState(parsed.state);
      assert(JSON.stringify((await loadState()).sessions) === JSON.stringify(state.sessions), 'Изменилась партия');
    });
    await check('Аудиопроекты сохраняются в отдельном IndexedDB store', async () => {
      const state = await loadState();
      const project = createAudioProject('Browser storage check');
      await restoreState({ ...state, audioProjects: [project] });
      const reloaded = await loadState();
      assert(reloaded.audioProjects.some((item) => item.id === project.id), 'Аудиопроект не восстановился');
    });
    await check('Синхронная ошибка записи откатывает полное восстановление', async () => {
      const state = await loadState();
      const invalid = { ...state, games: [{ ...state.games[0], notCloneable: () => undefined }] };
      await mustReject(() => restoreState(invalid));
      assert((await loadState()).games[0].id === state.games[0].id, 'Игры удалены при неудачном восстановлении');
    });
    await check('Синхронная ошибка откатывает частичное сохранение', async () => {
      const state = await loadState();
      const invalid = { ...state, games: [{ ...state.games[0], title: 'Must roll back' }], songs: [{ id: 'bad', title: 'Test', artist: '', createdAt: Date.now(), updatedAt: Date.now(), notCloneable: () => undefined }] };
      await mustReject(() => saveState(invalid));
      assert((await loadState()).games[0].title === state.games[0].title, 'Частичная запись сохранилась');
    });
    await check('Восстановление очищает повреждённую запись после ошибки загрузки', async () => {
      const valid = await loadState();
      await corruptDatabase();
      await mustReject(loadState);
      await restoreState(valid);
      assert((await loadState()).audioAssets.length === 0, 'Повреждённая запись осталась');
    });
    await check('Вторая вкладка получает уведомление и не может затереть новую ревизию', async () => {
      peer = document.createElement('iframe');
      peer.hidden = true;
      peer.src = './peer.html';
      await new Promise<void>((resolve) => { peer!.onload = () => resolve(); document.body.append(peer!); });
      const request = (command: string) => new Promise<{ error?: string; externalRevision: number }>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timeout = setTimeout(() => { window.removeEventListener('message', receive); reject(new Error('Peer timeout')); }, 5000);
        const receive = (event: MessageEvent) => {
          if (event.origin !== location.origin || event.source !== peer!.contentWindow || event.data.id !== id) return;
          clearTimeout(timeout); window.removeEventListener('message', receive); resolve(event.data);
        };
        window.addEventListener('message', receive);
        peer!.contentWindow!.postMessage({ id, command }, location.origin);
      });
      await request('load');
      const state = await loadState();
      await saveState({ ...state, games: state.games.map((game) => ({ ...game, title: 'Changed in first tab' })) });
      const response = await request('save');
      assert(response.error === 'StorageConflictError', 'Устаревшая вкладка перезаписала данные');
      // BroadcastChannel delivery is asynchronous relative to the transaction response.
      const notification = await request('status');
      assert(notification.externalRevision > 0, 'Нет уведомления BroadcastChannel');
    });
    summary.textContent = `${passed}/7 проверок пройдено`;
  } catch (error) {
    summary.textContent = `Проверки остановлены: ${String(error)}`;
  } finally {
    peer?.remove();
    run.disabled = false;
    corrupt.disabled = false;
  }
};

corrupt.onclick = async () => {
  await corruptDatabase();
  summary.textContent = 'Тестовая база повреждена. Откройте приложение на этом порту для проверки восстановления.';
};

async function corruptDatabase() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('melody-quiz-test-db');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('audio', 'readwrite');
      transaction.objectStore('audio').put({ id: 'corrupt-fixture', blob: 'invalid' });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
async function mustReject(action: () => Promise<unknown>) {
  try { await action(); } catch { return; }
  throw new Error('Операция должна была завершиться ошибкой');
}
