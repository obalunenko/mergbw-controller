# HTTP Contract: catalog and existing actions

**Feature**: [spec.md](../spec.md)

Все реальные запросы плагина идут на http://127.0.0.1:<port>. <token> обозначает пользовательский секрет; примеры не содержат действующих credentials.

## New: GET /<token>/presets

Purpose: авторизованно получить только идентификаторы и отображаемые названия пресетов из startup snapshot. Запрос не читает состояние лампы и не вызывает Controller.Execute или Controller.Connected.

### Request validation order

1. Существующая проверка Host: 127.0.0.1:<configured-port> либо localhost:<configured-port>.
2. Существующие URL guards: никаких query, включая пустой ?, fragment, encoded RawPath.
3. Строгое распознавание пути из двух сегментов <token>/presets.
4. Только GET. Любой иной метод — 405 и Allow: GET; HEAD без response body. Это специальный маршрут; старые method rules других маршрутов не меняются.
5. GET с Content-Length !=0 или Transfer-Encoding отклоняется 400.
6. Токен сравнивается существующим constant-time способом; неверный/пустой токен не даёт данных.
7. Сформировать response через существующий respond helper; никаких BLE вызовов.

Токен всегда в пути согласно существующему контракту; новый authentication mechanism не добавляется. Путь без token-сегмента не является каталогом и остаётся legacy unknown route.

### Success

Status 200, Content-Type application/json; charset=utf-8; Cache-Control no-store; X-Content-Type-Options nosniff; X-Request-ID и Content-Length по действующему helper.

```json
{
  "presets": [
    {"id": "night", "label": "Ночь"},
    {"id": "sunset", "label": "Закат"}
  ],
  "physical_state_verified": false
}
```

id соответствует /^[a-z0-9_-]{1,40}$/ и уникален; ascending lexical order. label — существующее непустое однострочное название. Одинаковые labels допустимы. Пустая map в тесте выдаёт presets:[], не null. В ответе нет rgb, brightness, token, device identity, settings или generated URLs. Заключительный newline соответствует respond.

### Errors

| Case | Status / headers | Effect |
| --- | --- | --- |
| Foreign Host | 403 | no data, no BLE |
| Query / escaped path / invalid GET body | 400 | no data, no BLE |
| Wrong token on otherwise valid GET | 403 | no data, no BLE |
| HEAD/POST/PUT/DELETE exact catalog path after shared guards | 405, Allow: GET | no data, no BLE; HEAD body empty |
| Serialization/write error | existing respond behavior | safe diagnostic, no BLE |

Ошибки сохраняют текущую форму {error:string, physical_state_verified:false}, заголовки защиты и request ID. Не логировать raw path/query/body/token/labels; успех каталога не является command.sent.

## Existing interfaces — preserved

| Route | Plugin method | Existing semantics |
| --- | --- | --- |
| /health | GET | Unauthenticated ok/version/bluetooth_connected/physical_state_verified:false |
| /<token>/on | POST, no body | Power on |
| /<token>/off | POST, no body | Power off |
| /<token>/color/<RRGGBB> | POST, no body | Power on then RGB |
| /<token>/brightness/<0–100> | POST, no body | Power on then brightness |
| /<token>/preset/<id> | POST, no body | Power on, RGB and brightness |

Existing command GET remains supported. Existing command HEAD rejects without execution. /health keeps its current accepted GET/POST/HEAD behavior. Никаких изменений его доступности или fields ради плагина.

Командный 200 должен содержать sent:true, action в canonical форме и physical_state_verified:false. Новые error-code поля в старые ответы не добавляются. Существующий сервер задаёт 35-second request context, но native operations могут продолжиться; plugin 45-second deadline не меняет серверную гарантию.

## Plugin interpretation

| Response / observation | Interpretation |
| --- | --- |
| Command 200, valid body, exact action | sent, success feedback |
| Command 400 | rejected parameter/preset; offer correction/refresh |
| Command 403 | access denied; check shared secret |
| Command 404/405 | incompatible route/method; no success |
| Command 503 | backend/Bluetooth failure; unknown or partial outcome |
| Command 504 | deadline/cancellation; unknown outcome |
| Command 3xx, 5xx other than above, malformed/truncated/oversized body or mismatched action | unknown; do not follow/retry |
| Connection refusal before command dispatch | service unavailable |
| Transport lost after possible dispatch, client deadline | unknown; possible late effect |
| Catalog 400/404/405 from legacy service | unsupported catalog/update required; other compatible actions still usable |
| Catalog 403 | authorization denied |
| Catalog success with invalid schema | incompatible catalog; no partial cache |
| Health success | service/Bluetooth only; never token validity or physical state |

Raw error messages не определяют категорию и не показываются. Для каталога ошибки не означают неизвестную команду лампы: запрос read-only. Command retry всегда только новое явное нажатие пользователя; никаких автоматических повторов.

## Acceptance at boundary

Strict generated MockController имеет ноль Execute/Connected ожиданий во всех catalog cases. Проверяются sorting, custom and duplicate labels, rename by stable id, empty array, auth before data, Host/URL/body/method rejection, HEAD body, cache/security/request headers и отсутствие private fields. Legacy commands и health сохраняют исходные acceptance tests.
