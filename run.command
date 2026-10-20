#!/bin/bash

# Keep this Terminal window open while using the Stream Deck buttons.
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

[ "$(uname -s)" = Darwin ] || fail 'Этот запуск предназначен для macOS.'
[ -x ./sunset ] || fail 'Не найден собранный sunset. Сначала запусти setup.command на этом Mac.'

printf 'MeRGBW: управление со Stream Deck\n'
printf 'Оставь это окно открытым или сверни его. Для остановки нажми Ctrl+C.\n\n'

exec ./sunset serve
