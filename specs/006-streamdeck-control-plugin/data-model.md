# Data Model: MeRGBW Stream Deck Plugin

**Feature**: [spec.md](spec.md) | **Design**: [plan.md](plan.md)

## 1. GlobalSettings — единственный источник подключения

Хранится через SDK global settings; не в action settings, профиле или файлах проекта.

| Field | Type / validation | Semantics |
| --- | --- | --- |
| schemaVersion | integer, exactly 1 | Empty storage initializes v1; unknown version is not overwritten automatically |
| connection | null or Connection | null = ещё не настроено |
| language | en or ru | Default en; явный переключатель PI |

Connection содержит только port (integer 1024–65535, default 18765) и accessToken (строка /^[A-Za-z0-9_-]{24,128}$/). Host не сохраняется: запросы всегда в 127.0.0.1. Конфигурация соответствует internal/config/config.go.

Пустое поле замены токена означает «оставить текущий», а не стереть. Новая установка без токена остаётся unconfigured. Импорт ссылки заменяет connection целиком после локальной валидации. Language-only save не меняет connection. Saves сериализуются backend, чтобы одновременная смена языка/порта не потеряла токен. Ошибка сохранения не подтверждается как успех и не заменяет активный снимок.

Unknown version/corrupt existing storage показывается как ошибка настройки без автоматического reset. Явное сохранение корректного нового подключения является восстановлением; команды остаются заблокированы до валидной конфигурации. После успешного изменения connectionRevision увеличивается, результаты проверок и каталог инвалидируются; in-flight операции хранят прежний snapshot. Никакая операция сохранения не вызывает команды лампы.

## 2. ActionSettings — экспортируемое назначение

Тип действия определяется SDK action UUID; его не надо дублировать в settings.

| UUID suffix | Persistent fields | Initial empty action |
| --- | --- | --- |
| on | schemaVersion:1 | no parameter |
| off | schemaVersion:1 | no parameter |
| color | schemaVersion:1, rgb:string | FF5000 |
| brightness | schemaVersion:1, percent:integer | 50 |
| preset | schemaVersion:1, presetId?:string | unset, требуется выбор |

rgb хранится uppercase шестизначным hex без #. UI допускает один начальный # и нормализует перед сохранением. percent — число integer 0–100; строки, пустое значение, NaN, дроби не приводятся молча. presetId соответствует /^[a-z0-9_-]{1,40}$/.

Пустое новое назначение получает initial defaults; повреждённое или неизвестной версии не заменяется defaults и не отправляет команды. Настройки сериализуются allowlist, без connection/token/URL/labels/error/history. Копия получает те же значения, последующее изменение относится только к контексту копии. Пользовательские title/icon — собственность хоста, не поля ActionSettings.

Переименование пресета сохраняет presetId. Известное отсутствие id после успешной загрузки каталога блокирует нажатие с предложением выбора. Если каталог не удалось загрузить, существующий валидный presetId можно отправить без подмены; результат подтверждает сервер, UI показывает «список не проверен». Создать новое preset-назначение без доступного списка нельзя.

## 3. PresetCatalog — непостоянный снимок

| Field | Type | Rules |
| --- | --- | --- |
| connectionRevision | integer | Snapshot belongs to exact connection |
| status | idle/loading/available/unavailable/unauthorized | Не смешивается со status команды |
| entries | array of {id,label} | unique id; sorted by id; label nonblank single line |
| refreshedAt | monotonic timestamp | UI freshness only |
| requestGeneration | integer | Late response cannot replace newer refresh |

Источник — уже загруженная map контроллера. Дублирующиеся названия показываются как label (id); выбор всегда по id. После рестарта контроллера и Refresh загружается новый snapshot. Ошибка refresh не заменяет сохранённый id и не объявляет старый cache актуальным. Смена connection исключает применение старого cache.

Label — недоверенный текст: безопасное text rendering, без innerHTML; очистка секретов и управляющих символов в выводе. Идентификаторы не извлекаются из labels. Неверный/слишком большой ответ отклоняется целиком, без частичного списка.

## 4. ConnectionCheck — три независимых результата

Непостоянная модель с connectionRevision и requestGeneration:

- service: unknown/available/unavailable/incompatible;
- authorization: unknown/verified/denied;
- bluetooth: unknown/connected/disconnected;
- catalog: unknown/available/unsupported/error;
- checkedAt, safe message key, safe request ID при наличии.

GET health даёт service/Bluetooth и не устанавливает authorization. Только валидный авторизованный каталог устанавливает verified; 403 — denied. Legacy catalog 400/404/405 даёт unsupported и authorization unknown, даже если реальный токен верен. Успешная отдельная command-response может обновить сведения об авторизации, но не физическом состоянии. Ошибка health не мешает отдельно отобразить результат catalog; два read-only запроса могут выполняться параллельно, каждый со своим 5-секундным deadline.

Валидные сохранённые connection/action позволяют явное нажатие даже при недоступной проверке; ошибка не удаляет настройки. Никакая проверка не отправляет on/off для проверки токена.

## 5. OperationRecord — одна ожидающая команда на контекст

Runtime-only map keyed by SDK action context; context не используется как долговременный идентификатор между запусками.

| Field | Type / purpose |
| --- | --- |
| operationId | generated opaque local ID |
| context, actionKind | SDK target and one of five actions |
| settingsRevision, connectionRevision | Immutable dispatch versions |
| snapshot | canonical route plus connection; secret stays private in memory |
| startedAt, deadlineAt | monotonic; deadline = activation +45s |
| status | pending/sent/rejected/unknown |
| errorCategory | optional local validation/service/auth/parameter/preset/backend/protocol/timeout |
| requestId | optional decimal header, length <=32 |
| durationMs | nonnegative local measurement |

Busy is inserted synchronously before any await. Repeat on same context creates no new record/request. Different contexts can submit; Go controller owns packet serialization. No retry count because client retries do not exist.

OnKeyUp, inspector open, appear and settings notifications never execute. Disappear preserves pending record/guard; deleting a key prevents rendering to it but does not imply native cancellation. Reappear of the same living context restores busy. Completion checks operationId and revisions before painting result. If assignment/connection changed, completion is retained only as old operation diagnostics; new assignment view is restored after busy ends.

Request timeout destroys client request and finalizes record unknown once. Late network events cannot finalize twice, unlock a newer operation or render a stale success. A later conscious press creates a new operation without asserting previous native completion. Completed invisible records are cleaned up; process restart does not restore or replay operations.

## 6. PresentationState и исход

| State | Entry | Exit / feedback |
| --- | --- | --- |
| unconfigured | missing/invalid connection or assignment | save valid data → ready |
| ready | locally valid assignment | keyDown → pending |
| pending | guard held | sent/rejected/unknown, max client observation 45s |
| sent | exact validated command confirmation | showOk, then ready after temporary feedback |
| error | definite rejection or local validation | showAlert; persistent explanation in PI |
| unknown | response absent/invalid or potentially partial execution | showAlert; possible late effect + manual next step |

Последнее безопасное объяснение ошибки доступно при открытии PI до следующей операции/изменения настройки. Категория backend может иметь status unknown: 503 не доказывает отсутствие физического эффекта. Все состояния являются состояниями взаимодействия; physical_state_verified всегда false. В модели нет currentPower/currentColor/currentBrightness.

## 7. InspectorMessage

Versioned envelope v=1, sessionId, requestId, type и allowlisted payload. Context берётся из SDK event, не из доверенного PI payload. Ответ возвращается только соответствующей inspector session. Сохраняемые данные валидируются backend повторно. Контракты операций — [plugin.md](contracts/plugin.md).

Import URL/заменяющий токен живут только в памяти PI/backend до save; UI очищает password/import field и не получает секрет обратно. Сырые IPC/global-change payloads не журналируются и не отображаются. Typed replies не содержат secret, raw URL или server error text.

## 8. DiagnosticEvent

Allowlist fields: event, actionKind, outcome, errorCategory, durationMs, requestId, operationId. Request ID принимается только как короткая decimal строка. Нет raw response, route с токеном, connection object, action values или user labels. Текущий и in-flight прежний секреты редактируются как дополнительная защита до вывода любых безопасных строк. INFO устанавливается перед SDK connect, trace transport не включается.
