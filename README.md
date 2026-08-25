# Угадай мелодию

Локальное браузерное приложение для подготовки и проведения игр «Угадай мелодию». Игры, медиатека, аудиофайлы и прогресс партий хранятся на устройстве ведущего в IndexedDB; сервер для обычной работы не требуется.

## Возможности

- несколько независимых игр с раундами, категориями, командами и межраундами;
- общая медиатека песен и переиспользуемых аудиотреков;
- content-addressed хранение физических аудиофайлов по SHA-256;
- импорт/экспорт игр и медиатеки в `.melody`;
- полная резервная копия приложения вместе с прогрессом партий;
- browser-only нарезка аудио и создание instrumental-версии через HTDemucs;
- автоматическое сохранение с защитой от конфликтов между вкладками;
- восстановление игровой сессии после перезагрузки страницы.

## Запуск

Требуется Node.js 18+. Для браузерного E2E quality gate используется Node.js 22+ и установленный Chrome/Chromium.

```bash
npm ci
npm run dev
```

Приложение открывается на `http://127.0.0.1:5173`.

## Основные команды

```bash
npm run dev                # локальная разработка
npm run typecheck          # строгий TypeScript
npm run lint               # архитектурные и AST quality gates
npm run format:check       # LF / trailing whitespace / EOF hygiene
npm run format             # автоматически исправить format hygiene
npm test                   # unit + regression tests
npm run coverage:critical  # контракт тестов для критичных модулей
npm run build              # production build
npm run e2e                # build + реальный browser/IndexedDB smoke test
npm run e2e:smoke          # только smoke test для уже собранного dist
npm run check              # основной CI quality gate
```

`npm run lint` — намеренно проектный AST-linter поверх TypeScript: он проверяет не только синтаксис, но и архитектурные правила приложения (циклические импорты, `window.alert/confirm`, `.getState()` в UI, слишком крупные UI-модули и debug-код). `.prettierrc.json` и `.editorconfig` задают единый формат для редактора; CI дополнительно проверяет форматную гигиену без добавления новых npm-зависимостей.

## Архитектура данных

Ключевая цепочка медиатеки:

```text
Song
  ↓ minusTrackId / plusTrackId
MediaTrack
  ↓ audioId
AudioAsset
  ↓ sha256 / Blob
IndexedDB
```

`Song` хранит музыкальную сущность, `MediaTrack` — логическое использование конкретной записи, `AudioAsset` — физический файл. Несколько `MediaTrack` могут ссылаться на один физический `AudioAsset`.

Игровая логика отделена от Effector orchestration: редактирование конфигурации и переходы сессии находятся в pure domain-функциях, а Effector связывает команды с UI и persistence.

## Документация

- [Архитектура](docs/architecture.md)
- [Хранилище и резервные копии](docs/storage.md)
- [Аудио-пайплайн](docs/audio.md)
- [Формат `.melody`](docs/package-format.md)
- [Тестирование и CI](docs/testing.md)

## Перед важной игрой

Сделайте **полную резервную копию приложения** в разделе «Настройки». Экспорт отдельной игры предназначен прежде всего для переноса набора и не заменяет full backup с прогрессом текущих партий.
