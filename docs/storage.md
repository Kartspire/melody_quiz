# Хранилище и защита данных

## IndexedDB

Основная база: `melody-quiz-db`, текущая версия схемы — 5.

Object stores:

- `games` — `GameConfig`;
- `songs` — `Song`;
- `media-tracks` — `MediaTrack`;
- `audio` — `AudioAsset` с Blob;
- `sessions` — `GameSession`;
- `meta` — active game, initialization flag и storage revision;
- `state` — legacy store для миграции старого формата.

## Autosave

Обычные изменения редактора и медиатеки сохраняются с debounce. Значимые изменения игровой сессии получают priority flush по изменению `GameSession.updatedAt`.

Persistence хранит ссылку на последний неподтверждённый snapshot. Успешное завершение старой записи не очищает более новый pending snapshot.

Записи сериализованы через `createSerializedSaveQueue`: ошибка одной операции возвращается её caller'у, но не блокирует последующие сохранения.

## Конфликты вкладок

Каждая успешная запись увеличивает `state-revision`. Перед записью вкладка сравнивает известную revision с текущим значением в IndexedDB.

Если revision изменилась извне:

1. запись отменяется;
2. возникает `StorageConflictError`;
3. вкладка переводится в read-only;
4. пользователь может сохранить аварийную резервную копию;
5. после перезагрузки загружается актуальная версия данных.

`BroadcastChannel` ускоряет обнаружение изменений другой вкладки, но корректность не зависит от него: revision проверяется непосредственно внутри транзакции.

## Ошибка сохранения

При обычной ошибке IndexedDB (например, quota/transaction error) pending snapshot остаётся в памяти. Кнопка «Повторить сохранение» повторно отправляет последний snapshot.

Перед закрытием страницы при dirty-state браузеру выставляется `beforeunload` protection. `visibilitychange/pagehide` инициируют best-effort flush, но они не считаются гарантией записи.

## Full backup

Полная резервная копия включает игры, песни, медиатрек, физические AudioAsset, сессии и activeGameId. Перед восстановлением проверяются структура архива, CRC32/SHA-256 и audio contracts.

Экспорт одной игры `.melody` не переносит текущий прогресс партии и не является заменой full backup.
