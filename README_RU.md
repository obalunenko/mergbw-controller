# MeRGBW Controller: LT-06 и Stream Deck

Локальный контроллер на Go для **MeRGBW LT-06**. Один процесс `sunset` принимает HTTP-команды от Stream Deck, последовательно отправляет их по BLE и сохраняет соединение с лампой. Адрес по умолчанию — `127.0.0.1:18765`.

[English documentation](README.md)

## Совместимость и статус проверки

- Целевое устройство — LT-06: advertising service `3519`, GATT service `FFF0`, запись в `FFF3`.
- **Пакеты ON/OFF проверены на одном экземпляре LT-06 через nRF Connect.** RGB и яркость реализованы по протокольному источнику и ещё требуют физической проверки.
- Новая реализация на Go также требует проверки на Mac с реальной лампой. Совместимость других устройств из приложения MeRGBW не подтверждена.
- Считывание реального состояния, музыка, фирменные анимации и плавные переходы не реализованы.

## 1. Сборка на macOS

Нужны **Go 1.25.0+** с [go.dev/dl](https://go.dev/dl/) и **Xcode Command Line Tools** с clang и macOS SDK. Если инструментов Apple нет, установите их и дождитесь завершения:

```bash
xcode-select --install
```

Используется обычный компилятор Go и библиотека `tinygo.org/x/bluetooth v0.16.0`. Компилятор TinyGo не требуется. Backend macOS использует CoreBluetooth через CGO, поэтому сборка выполняется на Mac — см. [официальные требования библиотеки](https://github.com/tinygo-org/bluetooth/blob/v0.16.0/README.md#macos).

```bash
git clone https://github.com/obalunenko/mergbw-controller.git
cd mergbw-controller
bash setup.command --identity AA:BB:CC:DD:EE:FF
bash run.command
```

Замените пример identity значением из рекламы своей лампы, как описано ниже. `setup.command` проверяет инструменты, загружает модули Go, собирает `sunset` и создаёт настройки. Go, Xcode и системные службы скрипт не устанавливает.

Можно запустить `setup.command` двойным щелчком: при первой настройке в интерактивном Terminal он попросит identity. Если `settings.json` уже существует, настройки сохранятся и повторный ввод не потребуется. Если двойной щелчок не работает, используйте команды выше из Terminal.

Ручная сборка:

```bash
go mod download
CGO_ENABLED=1 go build -buildvcs=false -o sunset ./cmd/sunset
./sunset --identity AA:BB:CC:DD:EE:FF init
./sunset serve
```

Интернет нужен для загрузки зависимостей. Собранный `sunset` работает локально; Python и запуск компилятора при каждом использовании не нужны.

### Где взять identity

В BLE-сканере откройте manufacturer advertisement лампы LT-06. Identity — **первые шесть байтов manufacturer payload без двухбайтового Company ID**, записанные через двоеточие: `AA:BB:CC:DD:EE:FF`. Некоторые сканеры показывают Company ID отдельно; в этом случае не отбрасывайте два байта повторно.

Контроллер ищет лампу по этим данным. Identity не является UUID CoreBluetooth на Mac. Адрес устройства, показанный Android, используйте только после проверки, что он совпадает с identity в рекламе. В публичном проекте нет заранее заданного адреса лампы.

### Доступ к Bluetooth

Разрешите Bluetooth для Terminal или используемого терминального приложения в **System Settings → Privacy & Security → Bluetooth**. Запрос может появиться уже при `init`, `--help`, `send` или `dry-run`: библиотека создаёт объекты CoreBluetooth при загрузке. Это само по себе не означает сканирования, соединения или отправки команд. При `abort: trap` в iTerm2 проверьте его разрешение или используйте штатный Terminal.

## 2. Подключение лампы и Stream Deck

1. Включите питание лампы и Bluetooth на Mac.
2. В nRF Connect нажмите **Disconnect** и закройте MeRGBW на телефоне.
3. Запустите `run.command` или `./sunset serve` на том же Mac, где работает Stream Deck.
4. Оставьте Terminal открытым или свёрнутым; Mac не должен уходить в сон.
5. Откройте созданный **streamdeck-buttons.txt**.
6. Добавьте кнопку **System → Website**, скопируйте целиком нужный URL и включите **GET request in background**.

Сначала проверьте ON/OFF, затем RGB и яркость. Для остановки сервера нажмите **Ctrl+C**. После перезагрузки Mac запускайте сервер вручную; автозапуск не создаётся.

URL содержат локальный токен. Файлы `settings.json` и `streamdeck-buttons.txt` исключены из Git; сохраняйте их приватными. При обычном перезапуске токен и URL не меняются.

## CLI

Общие флаги указываются **перед подкомандой**. По умолчанию данные хранятся рядом с исполняемым `sunset`.

```bash
./sunset --identity AA:BB:CC:DD:EE:FF init
./sunset serve
./sunset urls
./sunset send off
./sunset send on
./sunset send color FF5000
./sunset send brightness 40
./sunset send preset sunset
./sunset dry-run on
./sunset dry-run preset sunset
./sunset inspect
```

- `init` создаёт отсутствующие файлы, сохраняя существующие настройки и пресеты. Для новой конфигурации нужен `--identity`; `serve` тоже умеет инициализировать её с этим флагом. Другое значение флага не заменяет существующую identity: для смены лампы остановите сервер и явно измените `settings.json`.
- `send` обращается по HTTP к запущенному серверу. Выполняйте его во втором Terminal, оставив `run.command` работающим.
- `inspect` обнаруживает лампу и подключается для просмотра рекламы/GATT, но не записывает управляющие пакеты. Перед ним остановите `serve`.
- `dry-run` показывает пакеты без подключения к лампе и отправки команд.
- `urls` обновляет и выводит ссылки кнопок.

Отдельная папка данных:

```bash
./sunset --data-dir ./local-data --identity AA:BB:CC:DD:EE:FF init
./sunset --data-dir ./local-data serve
```

Указывайте ту же папку для остальных команд. Храните её вне репозитория или добавьте в локальные исключения Git.

## HTTP API

Сервер слушает только IPv4 loopback. Команды принимают **GET или POST без тела и query-параметров**. GET предусмотрен для фонового действия Website в Stream Deck.

| Маршрут | Действие |
|---|---|
| `/health` | Состояние сервиса и BLE-соединения, без токена |
| `/<token>/on` | Включить |
| `/<token>/off` | Выключить |
| `/<token>/color/FF5000` | Задать RGB шестью HEX-цифрами |
| `/<token>/brightness/40` | Яркость целым числом 0–100 |
| `/<token>/preset/sunset` | Применить пресет |

Используйте готовые URL из файла. Цвет, яркость и пресет сначала отправляют включение лампы. HEAD не выполняет команды управления.

`sent: true` означает завершённую BLE-запись, а `physical_state_verified` всегда остаётся `false`. Поле `bluetooth_connected` в `/health` описывает соединение, а не реальное включение или цвет лампы. Некоторые вызовы CoreBluetooth ожидают внутреннего тайм-аута: HTTP-тайм-аут не гарантирует мгновенную отмену уже начавшейся записи.

## Настройки и пресеты

В `settings.json` находятся `device_identity`, `port` и `access_token`. Меняйте настройки при остановленном сервере. В `presets.json` каждый стабильный ключ задаёт `label`, `rgb` — три числа 0–255, и `brightness` — число 0–100.

| Пресет | RGB | Яркость |
|---|---|---|
| `sunset` — Закат | 255, 80, 0 | 60% |
| `night` — Ночь | 40, 60, 255 | 25% |
| `alarm` — Тревога | 255, 0, 0 | 70% |
| `magic` — Магия | 160, 0, 255 | 45% |
| `forest` — Лес | 20, 180, 60 | 40% |
| `white` — Белый RGB | 255, 255, 255 | 50% |

`white` смешивает RGB-каналы; отдельный белый режим лампы не используется. Остановите сервер, измените JSON и перезапустите его. При неизменных ключах, порте и токене старые URL сохраняются. Ссылки новых пресетов появятся в `streamdeck-buttons.txt`.

### Переход с Python

Остановите Python-сервер, скопируйте его `settings.json` и `presets.json` рядом с Go-бинарником, выполните `./sunset init` и `./sunset serve`. Токен, маршруты и ключи пресетов сохраняются, поэтому прежние кнопки Stream Deck продолжат работать. На настроенном порту должен работать один сервер.

## Разработка и проверка

CLI находится в `cmd/sunset`, протокол — в `internal/protocol`, Bluetooth — в `internal/ble`, очередь команд — в `internal/controller`, HTTP — в `internal/bridge`, настройки — в `internal/config`.

```bash
go test ./internal/protocol ./internal/config ./internal/controller ./internal/bridge
go test -race ./internal/controller ./internal/bridge
```

[CI workflow](.github/workflows/ci.yml) выполняет тесты, проверки гонок основной логики, vet и сборку на Linux с Go 1.25.x и текущей стабильной версией Go. Отдельная задача macOS компилирует CoreBluetooth-backend с CGO; она не запускает контроллер или BLE-тесты. Ни эти проверки, ни успешная сборка на Mac не проверяют реальную лампу. Физическая проверка ограничена указанными выше пакетами ON/OFF.

Если Bluetooth-backend сообщает, что процесс требует перезапуска, остановите сервер и запустите его снова. Повторные HTTP-команды не восстанавливают адаптер, помеченный как непригодный после неопределённого результата операции.

## Протокольные источники

- [King1704G control.py, закреплённая версия](https://github.com/King1704G/custom_components-sunset_light_cheapass_amazon_light/blob/165539104949e8bc623b46040dee1ad33a3eb30c/custom_components/sunset_light/control.py): пакеты и контрольная сумма. Проверены OFF `55 01 FF 06 00 A3` и ON `55 01 FF 06 01 A2`.
- [rexxars config_flow.py, закреплённая версия](https://github.com/rexxars/ha-mergbw/blob/2771a214601d8c00ed21a4e05ca7616bd30fce0b/custom_components/mergbw/config_flow.py): логика обнаружения по рекламе; не источник проверенных команд для этой реализации.
- [Go Bluetooth v0.16.0](https://github.com/tinygo-org/bluetooth/tree/v0.16.0): интеграция с платформой; [go.mod](https://github.com/tinygo-org/bluetooth/blob/v0.16.0/go.mod) требует Go 1.25.0.
- [Elgato System Actions](https://help.elgato.com/hc/en-us/articles/360028234471-Elgato-Stream-Deck-System-Actions-Hotkey-Open-Website-Multimedia): Website и фоновый GET.

## Лицензия

[MIT](LICENSE).
