# Research: MeRGBW Stream Deck Plugin

**Date**: 2026-10-21
**Feature**: [spec.md](spec.md)
**Status**: Complete — design choices resolved; no user clarification required.

Результаты основаны на текущем коде и официальных источниках. Два исследовательских агента отдельно изучили SDK и существующие контракты; изменения кода, установка зависимостей и команды лампы не выполнялись.

## R1. Границы решения

**Decision**: Плагин TypeScript в `streamdeck/` использует один работающий Go-контроллер через HTTP. Пять классов действий и общие сервисы настроек, запросов, результатов и отображения. Добавление каталога полностью в `internal/bridge/`; интерфейсы `bridge.Controller`, `controller.Link` и композиция не меняются.

**Rationale**: `bridge.New` уже получает загруженные настройки и пресеты; `Handler` хранит их. Существующая сериализация, отмена и BLE остаются единственным исполнителем.

**Alternatives considered**: Прямой BLE из плагина нарушает владение соединением; запуск CLI на каждое нажатие усложняет жизненный цикл; Website-кнопки не дают панели выбора параметров. Источники: `internal/bridge/http.go`, `cmd/sunset/main.go`, `internal/ble/doc.go`.

## R2. SDK, среда и идентичность

**Decision**: `@elgato/streamdeck 3.0.3`, dev tool `@elgato/cli 1.10.3`; Node 24 для разработки и `Nodejs.Version: "24"` в манифесте. Stream Deck >=7.1; macOS >=13.5. `SDKVersion: 3` — отдельное поле манифеста. UUID `com.obalunenko.mergbw`; каталог `com.obalunenko.mergbw.sdPlugin`; действия с суффиксами `on`, `off`, `color`, `brightness`, `preset`.

**Rationale**: Текущие требования SDK и поддержка Node 24. Версии npm подтверждены публичными metadata; это зафиксированный baseline, а не обещание всегда последней версии. Примеры манифеста со старым Node 20 не заменяют текущие ограничения.

**Alternatives considered**: SDK 2/Node 20 ради более старого Stream Deck отвергнуты для нового плагина; Node 26 не нужен. Источники: [SDK requirements](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/), [manifest fields](https://docs.elgato.com/streamdeck/sdk/references/manifest/#manifest), [Node platform list](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list), [SDK metadata](https://registry.npmjs.org/@elgato%2fstreamdeck/3.0.3), [CLI metadata](https://registry.npmjs.org/@elgato%2fcli/1.10.3).

## R3. Сборка и интерфейс

**Decision**: TypeScript strict, Rollup по структуре официального scaffold; backend bundle `bin/plugin.js`, один адаптивный HTML Property Inspector. SDPI Components v4 включается локально с лицензией, исходным URL и SHA-256 в vendor README. Версия содержимого фиксируется самим закоммиченным файлом и checksum, без загрузки CDN во время работы. Backend и UI имеют отдельные TypeScript-конфигурации.

**Rationale**: Для пяти форм не нужен frontend framework. Компоненты дают привычный интерфейс; локальная копия позволяет работать без Интернета.

**Alternatives considered**: CDN и большой UI framework не нужны. Остальные build/lint зависимости берутся совместимыми с выбранным scaffold и Node 24, сохраняются точными версиями при создании package.json и package-lock.json; `npm ci` далее обязателен. Это работа реализации, не нерешённый архитектурный выбор. Источники: [scaffold](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/#file-structure), [local UI components](https://docs.elgato.com/streamdeck/sdk/guides/ui/#ui-library).

## R4. Настройки и обмен с панелью

**Decision**: Секрет и порт — только global settings, язык — там же; настройки действий содержат только schema version и параметр. PI передаёт импорт/замену секрета временным типизированным сообщением backend. Ответ содержит `hasToken`, порт, язык и статусы без сохранённого токена. Не связывать секретные поля с SDPI `setting`, не вызывать из PI getGlobalSettings. Backend валидирует все входы и сериализует изменения общих настроек.

**Rationale**: Настройки действий экспортируются с профилями. Local global settings не защищают секрет от владельца компьютера; обещается исключение из профилей и диагностики, а не защита от локального администратора. Подписки SDK на глобальные изменения не должны передавать данные в DOM или журналы.

**Alternatives considered**: Токен/URL в каждой кнопке, автоматический поиск файлов контроллера и отдельная база исключены. Источники: [settings security](https://docs.elgato.com/streamdeck/sdk/guides/settings/), [PI messaging](https://sdpi-components.dev/docs/helpers/stream-deck-client).

## R5. Каталог и совместимость старого контроллера

**Decision**: `GET /<token>/presets` выдаёт отсортированный по id список `{id,label}` и `physical_state_verified:false`. Только GET; HEAD/POST получают 405, `Allow: GET`. Никаких вызовов Execute или Connected. Использовать существующие проверки Host/URL/body/token и helper respond.

**Rationale**: Текущая map пресетов — снимок при запуске; обновление списка после перезапуска контроллера отражает текущую конфигурацию без нового механизма хранения. `/health` сохраняется и отдельно показывает Bluetooth; каталог проверяет авторизацию.

**Alternatives considered**: Публичный каталог, чтение файлов из плагина и полноценный CRUD пресетов не нужны. Старый контроллер с правильным токеном возвращает 400 на неизвестное действие presets, поэтому 400/404/405 только на запросе каталога означают отсутствие поддержки, не отключение остальных действий. 403 означает отказ доступа; успешная health-проверка не подтверждает токен. Источники: `internal/bridge/http.go`, `internal/config/config.go`, `internal/protocol/protocol.go`.

## R6. Локальный HTTP-клиент и неопределённость

**Decision**: Backend использует `node:http` с фиксированным hostname `127.0.0.1` и family 4, без DNS, proxy и follow-redirect. GET для health/catalog, POST без тела для команд. Параметры импортируются только из строго проверенной существующей HTTP-ссылки; hostname localhost нормализуется к IPv4 loopback.

**Rationale**: Клиент не требует CORS, не открывает браузер и не передаёт секрет внешнему origin. Низкоуровневый клиент не следует redirect и не повторяет запросы.

**Decision**: Общий deadline команды 45 секунд от нажатия, включая чтение ответа; health/catalog — 5 секунд каждый. Отмена клиентского ожидания уничтожает запрос, но не доказывает остановку записи BLE. Только 200 с валидными `sent:true`, ожидаемым `action` и `physical_state_verified:false` считается переданной командой.

**Alternatives considered**: Fetch допустим с особыми настройками, но не даёт преимуществ здесь; Axios и retry middleware не нужны. Тайм-аут socket.setTimeout сам по себе недостаточен: нужен общий таймер с destroy/abort и очисткой ресурсов. Источники: [Node HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html), `internal/ble/doc.go`, `internal/bridge/http.go`.

## R7. Ошибки и журналирование

**Decision**: Категория ошибки отделена от исхода команды. 503 обозначается как сбой контроллера/Bluetooth с неизвестным или частичным эффектом: сервер не различает машинным кодом определённый отказ и ErrWriteUncertain. 504, потеря соединения после отправки, malformed success и deadline также дают неизвестный исход. Никаких автоматических повторов.

**Decision**: `streamDeck.logger.setLevel("info")` устанавливается до connect во всех режимах. Записывается allowlist: action kind, outcome/error category, duration, безопасный request ID. Не передавать logger сырые ошибки, URL, settings и сообщения PI. Серверный текст ошибки не выводится; вместо него локализованная категория и следующий шаг. Токены текущих и незавершённых старых подключений очищаются как дополнительная защита.

**Rationale**: Go logs редактируются, однако HTTP error JSON может содержать исходный текст исключения. В SDK TRACE может включать IPC и сетевые значения.

**Alternatives considered**: Парсинг русских строк ошибок и изменение всех старых ответов Go ради новых кодов не нужны. Источники: `internal/bridge/http.go`, `internal/logging/redact.go`, [SDK logging](https://docs.elgato.com/streamdeck/sdk/guides/logging/#log-level).

## R8. События и обратная связь

**Decision**: Только Keypad, одно состояние, без toggle и Multi Action. Команды только на onKeyDown, onKeyUp не отправляет. Busy guard живёт в map контекстов backend и ставится синхронно до первого await. Исчезновение кнопки не снимает busy; результат относится к operationId и ревизии назначения/подключения.

**Decision**: Назначение/обычная busy-графика через setTitle/setImage; пользовательские overrides сохраняют приоритет. Для гарантированного заметного старта при пользовательском оформлении — краткий showAlert как сигнал внимания/занятости, с явно описанной семантикой и текстом «Выполняется» в PI. ShowOk только после подтверждения передачи, showAlert также при отказе или повторном нажатии занятой кнопки.

**Rationale**: Отдельного документированного showBusy нет. Attention overlay не обозначает успех; смысл и различение ошибок поясняет PI. Фактическая видимость и понятность при пользовательских значках — обязательная ручная проверка до приёмки; не предполагается возможность произвольного overlay поверх пользовательского значка.

**Alternatives considered**: Перезаписывать пользовательское оформление или показывать success на старте нельзя. Источники: [keys precedence and feedback](https://docs.elgato.com/streamdeck/sdk/guides/keys/).

## R9. Русский и английский

**Decision**: Явный выбор RU/EN в PI, сохраняемый глобально; fallback English. Общие словари используются PI и runtime. Список действий хоста имеет стабильные английские имена и двуязычные подсказки; не полагаться на автоматическую загрузку ru.json.

**Rationale**: Русский отсутствует в опубликованном списке native localization languages; поля, инструкции и сообщения плагина при этом доступны на русском.

**Alternatives considered**: Автовыбор ru по языку приложения не является подтверждённой возможностью. Источники: [localization languages](https://docs.elgato.com/streamdeck/sdk/guides/i18n/), [registration language enum](https://docs.elgato.com/streamdeck/sdk/references/websocket/plugin/#registrationinfo).

## R10. Проверки, инструменты и поставка

**Decision**: Node built-in test runner и node:assert/strict для чистых модулей, HTTP-клиента, SDK-adapter и PI сообщений; тесты компилируются tsc перед запуском. Go использует существующие Testify/GoMock; строгие mocks доказывают отсутствие Execute/Connected в каталоге. Отдельные plugin:* задачи и отдельный Node CI workflow без оборудования; существующий task check не меняется.

**Decision**: Elgato ESLint recommended + Prettier config, отдельный typecheck. Validate/pack используют pinned CLI и --no-update-check; link/watch/restart только явно локально. Все npm tools локальны streamdeck/node_modules, Go tools остаются в tools/*/go.mod. Пакет содержит только runtime файлы.

**Rationale**: Поведенческие проверки независимы от Stream Deck и BLE. Установка пакета, экспорт профиля и физические эффекты проверяются отдельно.

**Alternatives considered**: Запуск реального SDK или Bluetooth в обычных тестах, включение hardware в CI и глобальная npm-установка инструментов не нужны. Источники: [Node test runner](https://nodejs.org/docs/latest-v24.x/api/test.html), [lint guide](https://docs.elgato.com/streamdeck/sdk/style-guide/linting/), [validate](https://docs.elgato.com/streamdeck/cli/commands/validate/), [pack](https://docs.elgato.com/streamdeck/cli/commands/pack/), [link](https://docs.elgato.com/streamdeck/cli/commands/link/), `Taskfile.yml`, `go.mod`.

## Research closure

Неопределённости SDK/версий, транспорта, каталога, хранения секретов, локализации, feedback и workflow разрешены выше. Remaining verification is implementation evidence, not a missing design decision: schema validation/package installation, custom-appearance feedback, export exclusion and LT-06 observations are pending until implementation.
