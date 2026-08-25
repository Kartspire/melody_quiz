# Архитектура приложения

## Слои

Приложение разделено на несколько уровней ответственности:

```text
React UI / features
        ↓ events / stores
Effector orchestration
        ↓ commands
Pure domain logic
        ↓ entities
Persistence / audio / package infrastructure
```

### UI

`src/components`, `src/features` и `src/interRounds` отвечают за представление и пользовательские сценарии. UI не должен напрямую читать Effector stores через `.getState()` и не должен использовать `window.alert` / `window.confirm`.

### Effector orchestration

`src/model` связывает события, stores и эффекты. Большие бизнес-правила не должны реализовываться цепочками `sample`; они выносятся в pure-функции.

### Game domain

`src/model/games/domain` содержит редактирование `GameConfig`, переходы `GameSession`, историю Back и переходы межраундов. Эти функции можно тестировать без React и Effector.

### Media domain

`src/model/media/domain` определяет идентичность аудиотреков и песен, usage rules и контракт `AudioAsset`.

## Главные сущности

### GameConfig

Конфигурация игры: раунды, категории, вопросы, команды, межраунды и порядок stages.

### GameSession

Изменяемый прогресс конкретной партии: текущий stage, завершённые вопросы, очки, ограничения команд и history checkpoints.

### Song / MediaTrack / AudioAsset

```text
Song                    музыкальная сущность
MediaTrack              логический трек в медиатеке
AudioAsset              физический Blob, адресуемый SHA-256
```

Такое разделение позволяет одному физическому файлу использоваться несколькими логическими треками без дублирования Blob в IndexedDB.

## Правила зависимостей

- UI может импортировать публичные model API и domain types.
- Pure domain не должен зависеть от React.
- Game domain не должен зависеть от UI.
- Feature-код не должен напрямую управлять IndexedDB.
- Аудио-проигрывание проходит через общий `useAudioPlayer`.
- Изменения структуры игры должны явно указывать, требуют ли они `reconcileSession`.

`scripts/quality-gates.mjs` проверяет циклические относительные импорты и часть этих инвариантов автоматически.
