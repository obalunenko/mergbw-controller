#!/bin/bash

# Build on the Mac that will control the lamp. Compatible with macOS Bash 3.2.
set -u

fail() {
    printf '\nОшибка: %s\n' "$1" >&2
    if [ -t 0 ]; then
        printf 'Нажми Enter, чтобы закрыть это окно…\n' >&2
        read -r _ || true
    fi
    exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
cd "$SCRIPT_DIR" || fail 'Не удалось открыть папку контроллера.'

printf 'Сборка MeRGBW для Stream Deck — Go / macOS\n'
printf 'Папка: %s\n\n' "$SCRIPT_DIR"

[ "$(uname -s)" = Darwin ] || fail 'Эту версию нужно собирать на macOS: Bluetooth-библиотека использует CoreBluetooth и Xcode tools.'
[ -f go.mod ] || fail 'Не найден go.mod. Скачай или клонируй репозиторий целиком.'
[ -d cmd/sunset ] || fail 'Не найдена папка cmd/sunset. Скачай или клонируй репозиторий целиком.'

if [ ! -f settings.json ] && [ "$#" -eq 0 ]; then
    if [ -t 0 ]; then
        printf 'Первая настройка: укажите identity своей LT-06.\n'
        printf 'Это первые шесть байтов manufacturer payload, без Company ID.\n'
        printf 'Формат AA:BB:CC:DD:EE:FF; пример нужно заменить identity устройства.\n'
        printf 'Identity: '
        read -r LAMP_IDENTITY || fail 'Identity не введена.'
        if [[ ! "$LAMP_IDENTITY" =~ ^([[:xdigit:]]{2}:){5}[[:xdigit:]]{2}$ ]]; then
            fail 'Нужны шесть HEX-байтов через двоеточие. Подробнее — в README_RU.md.'
        fi
        set -- --identity "$LAMP_IDENTITY"
    else
        fail 'Для первой настройки укажи identity: bash setup.command --identity AA:BB:CC:DD:EE:FF (замени пример значением своей лампы).'
    fi
fi

SELECTED_GO=''
SELECTED_GO_VERSION=''
for candidate in go /usr/local/go/bin/go /opt/homebrew/bin/go /usr/local/bin/go; do
    if ! command -v "$candidate" >/dev/null 2>&1; then
        continue
    fi
    CANDIDATE_VERSION="$(GOTOOLCHAIN=local "$candidate" env GOVERSION 2>/dev/null)" || continue
    if [[ "$CANDIDATE_VERSION" =~ ^go([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        if [ "${BASH_REMATCH[1]}" -gt 1 ] || \
            { [ "${BASH_REMATCH[1]}" -eq 1 ] && [ "${BASH_REMATCH[2]}" -ge 25 ]; }; then
            SELECTED_GO="$(command -v "$candidate")"
            SELECTED_GO_VERSION="$CANDIDATE_VERSION"
            break
        fi
    fi
done

if [ -z "$SELECTED_GO" ]; then
    fail 'Нужен стабильный Go 1.25.0 или новее. Установи Go для macOS с https://go.dev/dl/ и снова запусти setup.command. TinyGo compiler не требуется.'
fi

if ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
    fail 'Не найдены Xcode Command Line Tools. Установи их самостоятельно командой xcode-select --install, дождись завершения установки и снова запусти setup.command.'
fi

CLANG_PATH="$(/usr/bin/xcrun --find clang 2>/dev/null)" || \
    fail 'Xcode tools не предоставили clang. Проверь установку Xcode Command Line Tools.'
[ -x "$CLANG_PATH" ] || fail 'Не найден исполняемый clang в Xcode Command Line Tools.'
/usr/bin/xcrun --sdk macosx --show-sdk-path >/dev/null 2>&1 || \
    fail 'Не найден macOS SDK. Проверь установленную и выбранную версию Xcode Command Line Tools.'

GO_HOST_ARCH="$(GOTOOLCHAIN=local "$SELECTED_GO" env GOHOSTARCH)" || fail 'Не удалось определить архитектуру Go.'
printf 'Go: %s (%s)\n' "$SELECTED_GO_VERSION" "$SELECTED_GO"
printf 'Архитектура: %s\n' "$GO_HOST_ARCH"
printf 'Clang: %s\n' "$CLANG_PATH"

printf '\nЗагружаю зависимости Go. Для этого шага нужен интернет…\n'
GOTOOLCHAIN=local "$SELECTED_GO" mod download || \
    fail 'Не удалось загрузить зависимости Go. Проверь сообщение выше и подключение к интернету.'

printf '\nСобираю sunset с поддержкой CoreBluetooth…\n'
CGO_ENABLED=1 GOOS=darwin GOARCH="$GO_HOST_ARCH" GOTOOLCHAIN=local \
    "$SELECTED_GO" build -buildvcs=false -o sunset ./cmd/sunset || \
    fail 'Не удалось собрать sunset. Подробности компилятора указаны выше; проверь Go и Xcode Command Line Tools.'

printf '\nСоздаю настройки и ссылки для кнопок…\n'
./sunset "$@" init || fail 'Не удалось завершить инициализацию. Подробности указаны выше.'

printf '\nГотово. Запусти run.command и оставь его окно открытым или свёрнутым.\n'
printf 'Путь к streamdeck-buttons.txt указан в результате инициализации выше.\n'
printf 'Инструкция по Stream Deck — в README_RU.md.\n'
if [ -t 0 ]; then
    printf '\nНажми Enter, чтобы завершить настройку…\n'
    read -r _ || true
fi
