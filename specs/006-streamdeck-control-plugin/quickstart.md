# Quickstart and Validation: MeRGBW Stream Deck Plugin

Это руководство проверки реализованного плагина. Выполненные проверки и оставшиеся наблюдения перечислены в [validation.md](validation.md); сборка и ответы имитатора не доказывают физический эффект лампы.

Детали: [HTTP contract](contracts/http-api.md), [plugin contract](contracts/plugin.md), [settings model](data-model.md), [workflows](contracts/workflows.md).

## Prerequisites

- Из корня репозитория: Go по root go.mod для контроллера; make tools использует отдельную версию tools/task/go.mod. Установленный repository Task.
- Node 24 и npm. npm tools устанавливаются локально, глобальный @elgato/cli не требуется.
- Для ручной проверки: macOS >=13.5, Stream Deck >=7.1 и кнопочное устройство либо Stream Deck Mobile.
- Для реальной лампы отдельно: подготовленная LT-06, существующая конфигурация и Bluetooth permissions у запускающего sunset терминала. Этот этап не нужен для автоматических проверок или UI с имитатором.

## 0. Internal two-action MVP (T027)

Это исторический срез T001–T026, когда реализованы только On/Off. Текущий пакет содержит пять действий: для оставшейся приёмки T027/T069 используйте разделы 1–3 и проверяйте питание в этом пакете, без возврата к двухдействийному manifest. Следующие команды и наблюдения описывают ранний MVP до появления workflows T055.

```sh
npm --prefix streamdeck ci
npm --prefix streamdeck run lint
npm --prefix streamdeck run format:check
npm --prefix streamdeck run typecheck
npm --prefix streamdeck test
npm --prefix streamdeck run build
npm --prefix streamdeck run validate
npm --prefix streamdeck run package
```

Остановиться при первой ошибке. Build/validate/package не вызывают поздний check:package и не требуют трёх будущих действий. Установить внутренний installer `dist/com.obalunenko.mergbw.streamDeckPlugin` открытием файла в Stream Deck; не совмещать его с linked copy того же UUID. Полный package-content gate остаётся T053–T058.

В отдельном терминале из корня:

```sh
node streamdeck/scripts/mock-bridge.mjs --catalog baseline
```

1. Убедиться, что категория MeRGBW содержит только On/Off; добавить по одной кнопке.
2. В PI импортировать публичную ссылку `http://127.0.0.1:18766/mock_access_token_1234567890123456/on`. Поле очищается; импорт и Save не увеличивают счётчик запросов команд.
3. Нажать Check: service available, auth verified, Bluetooth disconnected; счётчик команд прежний.
4. Нажать и отпустить On, затем Off: ровно один соответствующий POST на каждую активацию, attention перед sent feedback; браузер не открывается.
5. Перезапустить Stream Deck: подключение и назначения сохранены, импорт токена не требуется, новых команд нет. Повторить по одному нажатию и проверить прирост счётчика на два.
6. Записать версии, счётчики и pass/fail/pending в validation.md. При недоступном Stream Deck host-проверка остаётся pending.

Color/Brightness/Preset и варианты каталога проверяются в разделе 2 после US2; copy/profile/custom/export — после US3; failure modes — после US4. Раздел 1 использует готовые workflows после T055. Проверка пяти UUID, пользовательские измерения и LT-06 остаются последующими gates и не считаются пройденными этим MVP.

## 1. Automatic checks, no equipment

Из корня проекта:

```sh
make tools
task plugin:deps
task plugin:check
task workflows:test
task test:core
task test:race
task vet
task build
task plugin:package
```

Ожидается: lint/format-check, backend/UI typecheck, behavioral tests, build, manifest validation и package-content check проходят. Package task повторяет check как обязательный барьер перед упаковкой. В dist появляется com.obalunenko.mergbw.streamDeckPlugin.

Эти команды не запускают sunset, не устанавливают плагин и не инициализируют Bluetooth. Linux дополнительно использует task check; на macOS применяется core/race. Отдельно сверить изменения Go с gofmt. Не добавлять hardware tag в обычные команды.

Автоматические сценарии включают 100 отдельных команд, overlapping busy на одной кнопке, независимые контексты, смену настроек при ожидающем запросе, проверку exact action в response, отсутствие replay, total deadline с управляемым временем, legacy catalog 400, request-ID validation и redaction при echo/rotation. Timeout-тесты не ждут настоящие 45 секунд.

## 2. Install package and use a simulator

Для ранней приёмки T037 после T036, до workflows T055, повторить локальные npm проверки/build/validate/package из раздела 0 уже с пятью действиями и установить обновлённый внутренний installer. Не выполнять task plugin:* из раздела 1 до T055; для fixture использовать direct node команду, указанную ниже в Catalog variants. Это не закрывает поздний package-content gate T053–T058.

Установить созданный .streamDeckPlugin обычным открытием файла в Stream Deck. Режим разработчика вместо установки пакета допускает task plugin:link и task plugin:watch, но только явно и локально; обычные проверки этого не делают. Не устанавливать одновременно конфликтующие package и linked copy одного UUID.

Для linked-разработки сначала явно включить developer mode через `streamdeck/node_modules/.bin/streamdeck dev`. CLI может успешно отправить restart URI, который хост отклонит при выключенном developer mode; проверять загрузку по пяти действиям и `plugin.ready`, а не только exit code. Для перехода к обычному установщику убрать только ссылку командой `streamdeck/node_modules/.bin/streamdeck unlink com.obalunenko.mergbw` без `--delete`, затем открыть пакет. Файлы проекта сохраняются; обычная установка не требует включения developer mode.

В отдельном терминале из корня:

```sh
task plugin:mock
```

Использовать только публичную синтетическую ссылку:

```text
http://127.0.0.1:18766/mock_access_token_1234567890123456/on
```

1. Добавить MeRGBW → On на кнопку. Выбрать RU или EN в PI; вставить ссылку в import field и сохранить. Поле очищается; сохранённый токен не отображается.
2. Нажать Check connection: service available, auth verified, Bluetooth disconnected. Это ожидаемый имитируемый статус и не блокирует тест команд.
3. Добавить Off, Color, Brightness, Preset. Выбрать цвет FF5000, яркость 0/100 для границ и один пресет из списка.
4. Нажать и отпустить каждую кнопку один раз: имитатор фиксирует одну соответствующую команду, кнопка показывает attention/processing, затем success только после sent response. В браузере ничего не открывается.
5. Сменить язык: основные поля/ошибки и default runtime labels меняются; назначения сохраняются. Список действий хоста может оставаться английским.
6. Изменить одну копию Color: исходная кнопка не меняется. Переключить профиль, перезапустить Stream Deck три раза: проверить сохранение 10 назначений всех пяти видов.
7. Задать custom title и icon; убедиться, что оформление сохраняется и краткий attention-overlay при начале заметен. В PI «Выполняется» отличает обработку от ошибки. Если overlay не виден или семантика непонятна, ручная приёмка FR-010/014 ещё не пройдена; runtime setImage не считается достаточной заменой.
8. Экспортировать профиль. Проверить отсутствие fixture token/полной ссылки и наличие только назначений; импортировать в текущую установку и проверить назначения/оформление. По решению владельца от 2026-10-21 ручной импорт в другую установку без global connection исключён из обязательной приёмки личного проекта. Поведение без подключения сохраняет автоматическое покрытие: команды заблокированы до настройки. Чистый ручной импорт не считать выполненным.

Пресет выбирается по id; подписи могут повторяться. При переименовании существующего id после refresh выбор сохраняется. Удалённый id не заменяется первым элементом.

### Catalog variants for T037

Варианты --catalog из T025 доступны до failure modes T050. Между вариантами сохранять общее подключение и текущий presetId, кроме явного выбора в шагах baseline/duplicate-labels. Перед каждым запуском остановить fixture через Ctrl+C; после запуска нажать Refresh в PI. Счётчики обнуляются при перезапуске, поэтому сравнивать значения внутри каждого запуска.

| Запуск из корня | Проверка после Refresh |
| --- | --- |
| `task plugin:mock -- --catalog baseline` | night («Ночь»), sunset («Закат»). Выбрать sunset и выполнить один POST preset/sunset. |
| `task plugin:mock -- --catalog renamed` | sunset теперь «Вечер»; id и выбор сохранены. Refresh не отправляет команду; нажатие по-прежнему отправляет preset/sunset. |
| `task plugin:mock -- --catalog deleted` | Только night. Сохранённый sunset недоступен, подмены нет; нажатие блокируется с предложением выбора, счётчик команд остаётся нулём. |
| `task plugin:mock -- --catalog duplicate-labels` | Оба id имеют название «Одинаковый» и показаны как label (id). Выбрать night, затем sunset и проверить по одному соответствующему POST. |
| `task plugin:mock -- --catalog empty` | Пустой каталог, сохранённый sunset не заменяется; новый пресет выбрать нельзя, команда не отправляется. |
| `task plugin:mock -- --catalog baseline` | Исходный каталог восстановлен; Refresh и сохранённый sunset снова работают без повторного ввода подключения. |

Это отдельные запуски. При T037 до T055 вместо `task plugin:mock --` использовать `node streamdeck/scripts/mock-bridge.mjs` с тем же --catalog. Зафиксировать id/labels, назначение и счётчики до/после Refresh и нажатий в validation.md; непроверенные host-сценарии оставить pending.

## 3. Failure and recovery with simulator

Остановить fixture через Ctrl+C перед каждым запуском нового режима:

```sh
task plugin:mock -- --mode legacy
task plugin:mock -- --mode auth-denied
task plugin:mock -- --mode backend-error
task plugin:mock -- --mode timeout
task plugin:mock -- --mode malformed
task plugin:mock -- --mode echo-secret
```

Команды показаны как отдельные альтернативные запуски, не как одна последовательность в том же терминале.

| Scenario | Expected |
| --- | --- |
| Simulator stopped | Service unavailable; retained settings and explicit recovery step |
| legacy | Health works; catalog update-required on 400; on/off/color/brightness remain usable |
| auth-denied | Auth denied, not lamp off; no automatic retry |
| backend-error | Backend/Bluetooth category + unknown/possibly partial outcome |
| timeout | Busy guard suppresses second press; observation ends <=45s; possible late effect explained |
| malformed | No success on 200 with wrong schema |
| echo-secret | No fixture token/full URL in PI errors or plugin logs |

Пока ожидается timeout, изменить параметры или профиль: старый результат не должен становиться успехом нового назначения. После завершения ожидания новое осознанное нажатие разрешено; это не означает отмены предыдущей нативной операции.

Возвратить обычный mock после ошибки: кнопки работают без переустановки и повторного ввода секрета. Вставка удалённой URL, encoded path, query или неверного порта отклоняется без сетевого обращения. Каталог и Check connection не увеличивают счётчик lamp commands.

Журнал: streamdeck/com.obalunenko.mergbw.sdPlugin/logs/ при linked development либо logs/ внутри установленного plugin directory. Проверить action kind/category/duration/request ID и отсутствие secret/URL. Не включать SDK TRACE и не публиковать реальные журналы или profiles без проверки содержимого.

## 4. Real local controller, explicit equipment step

Остановить mock. На подготовленном Mac отключить конкурирующее соединение с лампой в телефонном приложении/BLE scanner. Для существующей конфигурации в отдельном терминале:

```sh
task run
```

Для первой подготовки использовать текущую инструкцию README/README_RU и собственную manufacturer-data identity; не копировать чужие идентификаторы. Не запускать init/serve на случайных параметрах ради проверки плагина.

В PI вставить одну собственную ссылку из streamdeck-buttons.txt, не публикуя её. Проверить connection/service/auth/Bluetooth раздельно. Обновить пресеты после изменения конфигурации и перезапуска контроллера. Ручная проверка старых Website-кнопок исключена владельцем 2026-10-22 как ненужная; не считать её выполненной. GET/POST-совместимость и сохранение конфигурации остаются под автоматической регрессией.

Явно выполнить через Stream Deck on, off, RGB, brightness 25 и 75, preset sunset. Для каждого записать ожидаемый и фактический наблюдаемый эффект. Любой неподтверждённый эффект оставить pending; ответ sent:true и Bluetooth connected не закрывают проверку. Тайм-аут может закончиться поздним физическим эффектом.

Существующий task test:hardware допускается отдельным локальным запуском, никогда в CI/default; он не заменяет наблюдение сценария из Stream Deck. Реальные identity/token и полные URL остаются только локально.

## 5. Acceptance record

- SC-001/002: владелец проверяет подключение и пять видов кнопок через интерфейс; настройка не отправляет команды, нажатия передают выбранные параметры. Исследование с пятью участниками и замерами времени настройки исключено владельцем 2026-10-21.
- SC-003: сохранить автоматическую серию из 100 отдельных команд, exact parameters, busy и no replay; не подменять её ручными замерами задержки.
- SC-005: владелец наблюдает начальную индикацию, выполнение и результат, включая custom icon; сохраняются автоматические deadline/recovery checks и общий срок наблюдения 45 секунд. Сто ручных замеров видимой задержки и пороги 95%/300 мс/1 секунда исключены владельцем; численные результаты не заявляются.
- SC-004: 10 назначений пяти видов, copy/edit isolation, profile switch и три рестарта.
- SC-006/007: все failure modes, custom-appearance check, export и безопасные журналы без секрета.
- SC-008: GET/POST-контракт и конфигурация сохранены, автоматическая регрессия выполнена; отдельная таблица реальных эффектов плагина. Ручная проверка старых Website-кнопок исключена владельцем, не выполнена и не считается прошедшей.

Фиксировать versions macOS/Stream Deck/plugin, pass/fail/pending и обнаруженные дефекты. Результаты автоматизации, host UI, пользовательских измерений и наблюдений LT-06 не смешиваются.
