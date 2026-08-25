# Тестирование и CI

## Уровни проверки

### TypeScript

`npm run typecheck` запускает project references с `strict`, `noUnusedLocals` и `noUnusedParameters`.

### Project lint

`npm run lint` использует TypeScript AST и проверяет проектные инварианты:

- синтаксис всех TS/TSX;
- отсутствие циклических относительных импортов;
- запрет `window.alert` / `window.confirm`;
- запрет `.getState()` в UI/feature слоях;
- запрет `debugger`, `console.log`, `@ts-ignore` в production source;
- лимит размера UI-модулей;
- минимальное количество test modules.

### Format hygiene

`npm run format:check` проверяет LF, trailing whitespace и финальный newline. `npm run format` исправляет эти проблемы автоматически. `.editorconfig` и `.prettierrc.json` задают одинаковые правила для редакторов/Prettier.

### Unit/regression

`npm test` запускает Vitest. Критичные pure domain transitions тестируются без Effector/React там, где это возможно.

### Critical coverage contract

`npm run coverage:critical` не подменяет line coverage. Это отдельный CI-контракт, который гарантирует наличие regression tests у критичных модулей и не позволяет незаметно удалить существенную часть тестового набора.

Он контролирует как минимум storage queue/policy, audio validation, backup/package parsing, game transitions, media identity, audio player и vocal-removal pipeline.

### Browser E2E

`npm run e2e` делает production build и запускает Chrome/Chromium через Chrome DevTools Protocol без дополнительной npm-библиотеки.

Smoke-сценарий проверяет реальный браузерный IndexedDB:

```text
чистая база
→ создать игру
→ дождаться autosave
→ reload
→ убедиться, что игра восстановилась
→ искусственно увеличить storage revision
→ изменить приложение
→ убедиться, что stale-вкладка перешла в read-only
```

Для E2E нужен Node.js 22+ и Chrome/Chromium. Путь можно передать через `CHROME_PATH`.

## CI

`.github/workflows/ci.yml` на push и pull request выполняет:

1. `npm ci`;
2. `npm run check`;
3. установку Chrome;
4. `npm run e2e`.

## Что запускать перед merge

```bash
npm run check
npm run e2e
```
