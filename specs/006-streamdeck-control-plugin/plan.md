# Implementation Plan: Плагин Stream Deck для управления MeRGBW

**Feature Directory**: `specs/006-streamdeck-control-plugin` | **Branch**: `develop`

**Date**: 2026-10-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-streamdeck-control-plugin/spec.md`.

Setup-plan возвращает логическое имя feature `006-streamdeck-control-plugin` в поле BRANCH, разрешённое из feature.json. Фактическая Git-ветка — `develop`; планирование её не меняет.

## Summary

Добавить устанавливаемый macOS-плагин с пятью действиями: питание ON/OFF, RGB, яркость и пресет. TypeScript backend на официальном SDK вызывает существующий локальный Go HTTP bridge; один Property Inspector задаёт общее подключение и отдельные назначения кнопок. Токен хранится только глобально, не в экспортируемых назначениях.

В Go добавляется только авторизованный GET-каталог идентификаторов и названий пресетов. BLE, протокол, сериализация и кооперативная отмена остаются существующими. Кнопки показывают результат передачи или неизвестный исход, не состояние лампы. Решения и источники — [research.md](research.md).

## Technical Context

**Language/Version**: Go 1.25.0 для контроллера; TypeScript strict для плагина и UI; Node 24.x, target ES2022. Go 1.27.0 остаётся отдельной версией tools/task; tools/mockgen остаётся Go 1.25.0. Python/Bash используются только для существующих dev workflows.

**Primary Dependencies**: Контроллер сохраняет stdlib, TinyGo Bluetooth v0.16.0, Testify v1.11.1 и GoMock v0.6.0 без новых Go-зависимостей. Плагин: @elgato/streamdeck 3.0.3; dev @elgato/cli 1.10.3, TypeScript, Rollup и его scaffold plugins, @types/node 24.x, Elgato ESLint/Prettier configurations и совместимые peer tools. Все npm зависимости локальны streamdeck/, точные версии и integrity фиксируются package-lock.json при реализации. SDPI Components v4 vendored с checksum и лицензией; runtime CDN нет.

**Storage**: Существующие JSON и generated URLs контроллера не меняются. Global settings schemaVersion=1: connection {port,accessToken} либо null, language en/ru. Action settings schemaVersion=1: только параметр соответствующего действия; runtime map хранит busy/result/catalog/revisions без долговременной истории. Базы данных нет.

**Testing**: Go testing/httptest + Testify и существующие mockgen-generated MockController, без handwritten Go doubles. Плагин: Node test runner/node:assert/strict, тесты TypeScript компилируются отдельно; injected HTTP/SDK adapters и управляемые часы. Настоящие HTTP boundary-тесты используют только локальный имитатор, не работающий sunset. UI и package install дополнительно проверяются в Stream Deck вручную.

**Target Platform**: Плагин macOS >=13.5, Stream Deck >=7.1, arm64/x64 с host Node 24. Контроллер сохраняет macOS/CoreBluetooth/CGO и вторичный Linux target. Автоматические plugin-тесты работают в Node 24 на Linux/macOS без Stream Deck.

**Project Type**: Go CLI/loopback HTTP service плюс отдельный Stream Deck host-managed Node plugin; это не второй контроллер BLE.

**Performance Goals**: SC-001/002: настройка питания за 5 минут и новой кнопки за 60 секунд для >=4/5 участников. Busy feedback <=300 мс, результат <=1 секунды после ответа в 95/100 измерений. Command deadline 45 секунд полностью от нажатия до чтения ответа; read-only requests по 5 секунд. Эти лимиты не гарантируют длительность нативной записи.

**Constraints**: Только canonical 127.0.0.1, family 4; импорт принимает literal localhost/127.0.0.1 с действующим портом и токеном. Redirect/retry отсутствуют. Одна команда на onKeyDown, busy guard по контексту, снимок назначения/подключения на начало. Никаких physical-state claims, token/URL logs, автоматического запуска/повтора или изменений конфигурации контроллера.

**Scale/Scope**: Один компьютер, один sunset, одна LT-06, пять Keypad-действий и одна общая панель. Нет toggle, Encoder, Multi Action, облака, Marketplace и управления пресетами.

## Constitution Check

*GATE before research: PASS. Post-design gate: PASS. Статусы относятся к согласованности проекта, не к исполненной реализации.*

- [x] **I — Responsibilities**: Новый npm package отделён от Go-модулей; каталог в bridge использует уже переданную map. Controller/Link/protocol/config/native API не меняются. Taskfile владеет workflow, Make остаётся установщиком Go tools.
- [x] **II — Local contract**: Старые GET/POST, HEAD, /health, Host/token/input guards и generated URLs сохраняются. Добавочный GET-каталог имеет явный контракт; стандартные порт/форматы совпадают с config.Validate.
- [x] **III — BLE effects/cancellation**: Плагин не меняет BLE/retry. Command timeout означает конец наблюдения; 503/504 и потеря ответа могут иметь неизвестный эффект. Отправленные команды не воспроизводятся автоматически.
- [x] **IV — Config/secrets**: Init/settings/presets не меняются. Секрет глобален, PI получает summary, профили — только назначения; allowlist logging, явный INFO до SDK connect и защита ошибок. Смена подключения не меняет уже отправленный запрос.
- [x] **V — Appropriate verification**: Изменённые Go-тесты используют Testify/strict generated GoMock; Node тестируется собственным runner. Нативный Bluetooth не импортируется обычными тестами. Числовой coverage threshold не вводится.
- [x] **VI — Hardware isolation**: Реальная лампа только в отдельной локальной приёмке; существующий task test:hardware сохраняется вне CI/default. Запись sent/build не считается наблюдением физического эффекта.
- [x] **Documentation/tooling**: Оба README обновляются согласованно; Spec Kit tooling не меняется и не добавляется в CI/task check.

**Post-design review**: Контракты [HTTP](contracts/http-api.md), [plugin](contracts/plugin.md), [workflows](contracts/workflows.md) и [data model](data-model.md) сохраняют все перечисленные границы. Отклонений, требующих изменения конституции, нет.

## Project Structure

### Documentation (this feature)

```text
specs/006-streamdeck-control-plugin/
├── spec.md
├── checklists/requirements.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── http-api.md
    ├── plugin.md
    └── workflows.md
```

tasks.md создаётся последующим $speckit-tasks, не этой командой.

### Source Code (repository root)

```text
internal/bridge/
├── http.go                       # add exact catalog dispatch; retain Controller declaration
├── presets.go                    # catalog response projection and sorting
├── http_test.go                  # current contracts retained
├── presets_test.go               # catalog security/no-effect cases
└── logging_test.go               # catalog diagnostic redaction cases
streamdeck/
├── package.json
├── package-lock.json
├── tsconfig.json                 # backend
├── tsconfig.ui.json
├── tsconfig.test.json
├── rollup.config.mjs             # backend and UI bundles
├── eslint.config.mjs
├── .editorconfig
├── src/
│   ├── plugin.ts                 # register five actions; INFO before connect
│   ├── actions/
│   │   ├── base-action.ts
│   │   ├── power-on.ts
│   │   ├── power-off.ts
│   │   ├── color.ts
│   │   ├── brightness.ts
│   │   └── preset.ts
│   ├── bridge-client.ts
│   ├── settings.ts
│   ├── validation.ts
│   ├── operation-store.ts
│   ├── inspector-messages.ts
│   ├── feedback.ts
│   ├── diagnostics.ts
│   ├── i18n.ts
│   └── ui/inspector.ts
├── scripts/
│   ├── check-package.mjs
│   └── mock-bridge.mjs            # explicitly invoked synthetic local fixture
├── tests/                        # behavioral tests, never real SDK startup
└── com.obalunenko.mergbw.sdPlugin/
    ├── manifest.json
    ├── .sdignore
    ├── bin/plugin.js             # generated, ignored
    ├── imgs/                    # static icons, appropriate sizes
    ├── ui/
    │   ├── index.html
    │   ├── inspector.css
    │   ├── inspector.js          # generated, ignored
    │   └── vendor/               # local SDPI, checksum/source/license
    └── logs/                    # generated, ignored
Taskfile.yml
scripts/test_task_workflows.py
.github/workflows/streamdeck.yml
.gitignore
README.md
README_RU.md
dist/                            # generated installer, ignored
```

**Structure Decision**: `streamdeck/` is a new external client boundary with its own runtime and dependency manifest, not a Go development-tool module. Shared plugin services centralize validation and lifecycle rather than repeating request code across five actions. No changes planned in cmd/sunset, internal/config, internal/protocol, internal/controller, internal/ble, root go.mod/go.sum, tools/* or existing CI controller jobs. Go tests remain colocated with underscore-separated filenames.

## Implementation by Affected Boundary

### 1. HTTP catalog

После общих Host/URL guards распознать строго двухсегментный путь /<token>/presets до legacy method/action dispatch. Только GET, без body/transfer encoding; constant-time token check до выдачи содержимого. Response строится из startup snapshot, sort по id, массив [] при отсутствии элементов, без RGB/brightness/identity/token. Использовать существующий respond, request ID и redacted request logger; success-event http.presets.completed не является command.received/command.sent.

Существующий legacy dispatch не переносится и не меняет статусы. Ни Execute, ни Connected не нужны каталогу. Сохраняется auth-before-content, а методы HEAD/POST/PUT получают 405 Allow: GET; legacy command HEAD остаётся 405 Allow: GET, POST. Контракт и матрица проверок — [http-api.md](contracts/http-api.md).

### 2. Plugin foundation, settings and transport

Создать локальный npm package и stable manifest. Backend получает global settings, валидирует schema и строит неизменяемый connection snapshot. Import link — локальный parser без запросов; Save и Check — отдельные явные операции. Candidate connection сохраняется после локальной валидации даже при offline; Check проверяет health и каталог без команд лампы.

Bridge client использует node:http без DNS/redirect/proxy/retry, POST с Content-Length:0 для actions. Сырые ответы/ошибки не доходят до logger/DOM. Общий таймер покрывает socket, headers и body; response caps 64 KiB для команд/health, 1 MiB для каталога. Payload types валидируются во время выполнения.

Статусы 400/403/404/405 — определённый отказ известных маршрутов; 503/504/неполный или испорченный ответ — консервативно unknown. У read-only запросов unknown относится только к проверке, не к состоянию лампы. Catalog-only legacy 400/404/405 показывает upgrade-required без блокировки on/off/color/brightness. Все детали — [model](data-model.md) и [plugin contract](contracts/plugin.md).

### 3. Actions, lifecycle and UI

Пять SingletonAction классов делегируют общей реализации, выбранной типом UUID. OnKeyDown синхронно фиксирует busy; onKeyUp/no-op. Валидация local settings предшествует запросу. Context + operationId + settingsRevision + connectionRevision защищают от устаревшего результата после редактирования. На исчезновение кнопки запрос не отсоединяется от записи busy, UI не обновляется до возврата того же действующего контекста. При истечении deadline busy освобождается без утверждения native completion.

PI использует локальный SDPI, цветовой picker/HEX, slider+number, select пресетов и общий блок подключения. Секретные поля не привязаны к action settings; import/replace идут временными сообщениями, после сохранения поля очищаются. Смена языка и подключения сериализуется backend; версия сообщения, контекст и request/session IDs проверяются. Проверки подключения показывают три независимых результата: service/auth/Bluetooth.

Обычное оформление показывает назначение; custom title/image имеют приоритет. Короткий attention overlay на старте, текст «Выполняется» в PI; showOk только после validated sent; отказ/unknown показывают attention и локализованный следующий шаг. Такой overlay не обещает успеха и описывается в обеих инструкциях. RU/EN переключаются явно. Пакеты и состояние лампы UI не моделирует.

### 4. Tooling and documentation

Taskfile добавляет plugin:* задачи с dir streamdeck и локальными npm scripts. plugin:check последовательно выполняет lint, typecheck, test, build, validate и проверку содержимого runtime directory; package предварительно проходит check. deps использует npm ci. make tools продолжает устанавливать только Go tools.

Отдельный streamdeck.yml job устанавливает Node 24 и repository Task, запускает plugin:deps и plugin:check без Stream Deck, Bluetooth или реальных настроек. Legacy task check остаётся Go suite. Явные link/watch/restart/mock-server не являются зависимостями check/package/CI. Workflow recorder проверяет новые команды, рабочую директорию, порядок и распространение ошибок.

Package check подтверждает все пять UUID, runtime files, vendor checksum/license, отсутствие logs/settings.json/presets.json/generated command URLs/test fixtures/source maps/dev files. Пакет собирается в root dist и проверяется по manifest assets; не публикуется.

До полного delivery gate T027 проверяет внутренний On/Off MVP по отдельному разделу 0 quickstart: локальные npm scripts build/validate/package уже существуют с T001, не зависят от plugin:* T055 или five-action checker T053. Остальные действия и полная приёмка остаются последующими gates.

Имитатор получает в T025 startup --catalog baseline/renamed/deleted/duplicate-labels/empty с фиксированными id/labels по workflows contract. Для смены snapshot требуется явный restart на прежнем port/token и Refresh в PI. T037 проверяет rename/delete/duplicates/empty и восстановление до failure modes T050; до T055 использует direct node invocation. Счётчик включает received/rejected command requests и обнуляется на restart; read-only запросы его не меняют. Варианты и сочетания с failure modes проверяются через injected fixture handler без запуска CLI в unit tests.

README/README_RU получают одинаковые шаги подготовки, установки, одноразового импорта, пяти действий, обновления пресетов после рестарта сервиса, RU/EN, busy overlay, ошибок, журналов и сохранения старых кнопок. Никаких реальных идентичностей/секретов в примерах.

## Validation Plan

- **Planning artifacts now**: проверить полноту, ссылки, трассировку FR/SC и согласованность контрактов. Код плагина и HTTP ещё не реализован; команды новых workflow в quickstart — контракт будущей реализации.
- **Go after implementation**: gofmt для internal/bridge/http.go, presets.go, presets_test.go и изменённых http_test.go/logging_test.go. task test:core, task test:race, task vet, task build; Linux task check. Перед Go-изменениями применить установленный modern-go-guidelines skill. task mocks:generate только если изменяются interface/generator inputs; необходимости новых интерфейсов нет.
- **Catalog boundary**: custom/sorted/renamed/duplicate labels, empty array, missing/wrong token, Host/query/ForceQuery/encoded path, content-length/chunked body, GET/POST/HEAD/PUT, empty HEAD response, request ID/cache/security headers; strict MockController доказывает отсутствие Execute/Connected; прежние маршруты и redaction не регрессируют.
- **Plugin automatic**: validation/import, exact POST route, response schema and action matching, 100 individual activations, busy overlap and per-context isolation, stale result after config/profile changes, offline/auth/catalog legacy/errors/503/504/malformed/oversized/truncated response, 45-second total deadline controlled clock, no automatic replay, token echo/old token redaction, export-safe settings and RU/EN dictionary parity.
- **Workflow/package**: task workflows:test; task plugin:check; task plugin:package; inspect runtime and installer content. SDK/module imports do not execute connect from unit tests. New Node CI is hardware-free.
- **Host manual**: installer, five drag/drop actions, copy/edit isolation, restart/profile retention, custom icons/titles plus visible attention feedback, exported profile without token, separate service/auth/Bluetooth and recovery. User timing sample 5 people; 100 response/feedback samples and 10 assignments over 3 restarts, per SC-001–SC-007.
- **Device manual**: подготовленная LT-06, явные on/off, RGB, brightness 25 и 75, preset sunset. Записать для каждого ожидаемый и наблюдённый эффект, platform, защищённую локальную ссылку на device context и pending/observed. Не добавлять hardware tag в обычные задачи. Existing task test:hardware остаётся отдельной опцией и не заменяет наблюдение из Stream Deck.
- **Spec Kit**: его исходники/скрипты не меняются; speckit:update:test и installer checks для этой функции не требуются и в CI не добавляются.

## Requirements and Evidence Mapping

| Requirements | Design | Planned verification |
| --- | --- | --- |
| FR-001–FR-002 | Manifest, five Keypad actions, one PI | Package/schema checks, install/drag/drop, SC-001 |
| FR-003–FR-005 | Global settings, strict link parser, separate health/catalog | Import/security/connection tests, SC-001/006/007 |
| FR-006 | Per-action schema and serialized global saves | Copy/export/profile/restart, SC-004 |
| FR-007–FR-009 | Validated color/percent, authenticated catalog | Boundary/custom/stale/legacy cases, SC-002 |
| FR-010–FR-012 | Busy map, total deadline, outcome taxonomy | Controlled interleavings, 100 presses, SC-003/005/006 |
| FR-013 | Secret-safe storage/messages/logging | Echo/rotation/export checks, SC-007 |
| FR-014 | Default feedback plus preserved custom appearance | Host custom-appearance gate, SC-004/005 |
| FR-015 | Existing controller contracts | Go regression + separate hardware observations, SC-008 |
| FR-016–FR-017 | Safe diagnostics, RU/EN and paired README | Dictionary/docs review and recovery scenarios, SC-001/006 |

## Complexity Tracking

Отклонений от конституции нет; таблица исключений не требуется. Принятые ограничения SDK по русскому языку и busy-индикации учтены в дизайне и ручной приёмке, а не скрыты неподдерживаемыми обещаниями.
