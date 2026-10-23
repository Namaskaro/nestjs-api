> HISTORICAL SNAPSHOT — preserved research/results, not current deployment instructions. Final pre-commit cleanup (2026-10-23) supersedes runtime/status claims below; see [current implementation](../PRODUCTION-AI-REVIEW.md).

# Minimal LiteLLM: результат проверки, 17 октября 2026

**Gateway не допущен к подключению в приложение. Direct сохранён без изменений.**
Проверены настоящие контейнеры без hooks. Обе версии теряют признак
незавершённого/неподтверждённого Chat Completions-ответа; это нарушает существующий
контракт перед обработкой structured output и tool calls. Собственный обход не добавлен.

Репозиторий `Namaskaro/nestjs-api`, ветка `refactor/ai-provider-abstraction`, HEAD
`aff28c0ee5912047f524b16db9fd8a262606ecf2`. Commit/push и Phase 5 не выполнялись.

## Версии и точный блокер

| Контейнер | Закреплённый digest | Результат |
| --- | --- | --- |
| 1.100.3 | `sha256:a68b34df312f1e72914f0886384517fa4fdb09013480460b80a4e3a40104376b` | Блокер нормализации; дополнительно 400 на Luna `reasoning.effort=none`, `temperature=0`, до upstream |
| 1.105.1 | `sha256:b7b9e2c306343721802253d0dd9436b9634a2eb4e14da7c7cf06c5c7b7530802` | Luna/Sol работают без регистрации моделей в Python; блокер нормализации остался |

1.105.1 выбрана как стабильный кандидат для тестов, не как утверждённый production
image. В её каталоге присутствуют обе модели и их reasoning capabilities.
См. [релиз 1.105.1](https://docs.litellm.ai/release_notes/v1.105.1/v1-105-1) и
[поддержку GPT-6.1 Sol в 1.105.0](https://docs.litellm.ai/release_notes/v1.105.0/v1-105-0).

**Wire repro на обеих версиях:** mock возвращает HTTP 200, корректный `tool_calls`
с полными JSON-аргументами, но без подтверждения завершения:

| Upstream `choices[0].finish_reason` | Gateway `finish_reason` | Результат |
| --- | --- | --- |
| `null` | `tool_calls` | HTTP 200, tool call сохранён |
| Поле отсутствует | `tool_calls` | HTTP 200, tool call сохранён |
| `unknown` | `stop` | HTTP 200, tool call сохранён |

LangChain получает готовый tool call. Инструмент в тесте не исполняется.
Direct с тем же HTTP-ответом отклоняет вызов. После такой нормализации
`chat-http.ts` не может восстановить исходное значение. В 1.105.1 для неизвестного
значения есть `provider_specific_fields.native_finish_reason`, но для null/отсутствия
это не решает потерю информации. Изменить одну проверку после proxy недостаточно.
В установленном коде нормализация присутствует в `litellm.types.utils.Choices`
и `litellm.litellm_core_utils.core_helpers.map_finish_reason`.

Условие повторного рассмотрения: штатный LiteLLM должен отклонять такой ответ либо
сохранять исходный признак, позволяющий приложению его отклонить. Тогда потребуется
обновить закреплённый image и повторить acceptance-набор. Срок upstream-исправления
неизвестен. Python hooks, собственный fork/HTTP guard и ослабление Direct-контракта
не реализованы и не рекомендуются как минимальная интеграция.

## Что подтверждено без hooks

В 1.105.1 прошли все четыре назначения FAST/STANDARD: Yandex/OpenAI,
OpenAI/Yandex, OpenAI/OpenAI, Yandex/Yandex, включая независимую отмену конкурентных
вызовов. Каждая конфигурация использует один stock CLI process, два alias и один YAML.
OpenAI идёт через `/responses`, Yandex через `/chat/completions` с OpenAI-compatible
адаптером. Responses→Chat translation для этого не нужна.

Подтверждены на mock upstream:

- Корректные structured responses, function calling, `includeRaw`, JSON mode,
  отправка JSON Schema; Zod-отклонение некорректного JSON mode.
- Tool-result history; reasoning `none`/`medium`, `store:false`, encrypted reasoning
  в следующем запросе **к тому же провайдеру**. Это не сертификация смены провайдера
  внутри существующей беседы. Параметры согласуются с
  [официальной документацией OpenAI](https://developers.openai.com/api/docs/guides/reasoning).
- Refusal не становится structured success; malformed tool JSON не становится
  валидным tool call. Для Yandex текст refusal по-прежнему теряется в установленном
  LangChain Chat Completions converter — прежнее ограничение Direct.
- Responses `status=incomplete`, Chat Completions `length`/`content_filter`
  отклоняются; утрата null/отсутствующего/неизвестного finish reason остаётся блокером.
- Pre-abort: 0 upstream sends. Abort, клиентский и proxy timeout закрывают upstream
  socket. Успешный вызов и HTTP 401/429/503: 1 send; tool loop: 2 отдельных sends.
  Разрыв сокета после приёма запроса не вызвал скрытого resend на этих нативных маршрутах.
  Это не гарантия для остальных адаптеров LiteLLM или остановки биллинга провайдера.

**Отдельное ограничение SDK:** OpenAI Responses `method: jsonSchema` может вернуть
completed JSON с нарушением Zod-схемы без локальной ошибки. Повторено через неизменённый
`AiService` напрямую: 4 одинаковых отрицательных теста падают с proxy и без него.
Отправка strict schema подтверждена, но её серверное соблюдение mock не доказывает.
Это не новая gateway-регрессия; код SDK и бизнес-код не менялись.

## Проверки

| Набор | Прошло / упало |
| --- | --- |
| Stock 1.100.3, 140 acceptance cases | 96 / 44 |
| Stock 1.105.1, те же 140 cases | 124 / 16 |
| Direct-контроль спорных `jsonSchema`/`finish_reason`, 24 cases | 20 / 4 |
| Существующие AI Jest, 8 suites | 173 / 0 |
| Расширенные Jest, 23 suites | 244 / 6, ровно прежние Product Workspace failures |
| Direct native HTTP | 11 / 0 |
| TypeScript build `--noEmit --incremental false` | Успешно |
| Docker Compose config, `git diff --check` | Успешно |

В 1.105.1 из 16 failures: 12 проверок нормализации gateway и 4 SDK baseline,
описанных выше. В 1.100.3: 30 сценариев блокируются проверкой Luna, 12 — нормализацией,
2 достижимых Sol-сценария — SDK baseline. Ошибки не скрыты через skip/expected-failure.
Числа Docker относятся к отдельным cases; Node дополнительно отмечает родительский
test как failed. Локальные JSON/log evidence: `.tmp/stock-1.100.3.*`,
`.tmp/stock-1.105.1.*`, `.tmp/stock-direct-control.*`, `.tmp/stock-wire-*.json`,
`.tmp/stock-direct-ai.*`, `.tmp/stock-regression.*`, `.tmp/stock-direct-http.log`.

Live остаются: доступность моделей аккаунту, реальные Yandex URI и supported schema
subset, соблюдение strict schema/refusal, валидность encrypted reasoning, usage,
лимиты и фактическое прекращение вычислений/списаний после disconnect. Платных
вызовов не было. Streaming по-прежнему выключен.

## Файлы, переключение и будущий fallback

Добавлены только стенд и отчёт:
`compose.conformance.yaml`, `tests/stock.config.yaml`, `tests/stock_runtime.py`,
`tests/stock.integration.cjs`, этот файл. В `README.md` и `RELIABILITY.md` добавлены
ссылки; исторические материалы сохранены. `stock_runtime.py` — тестовый mock server
и launcher CLI, не middleware/callback; он не импортирует и не патчит LiteLLM.
В стенде тестовый ключ использует штатную master-key проверку, без virtual keys/БД.

Все 23 файла `src/ai` побайтно совпадают с Direct-backup. Production-сложность
относительно Direct-only не выросла: 0 новых runtime файлов/сервисов/зависимостей.
Изменений Orders, Commerce, Product Consultation, embeddings, схем БД нет.
Production Compose, budget Compose, `gateway_policy.py`, `upstream_http.py`,
`budget_admission.py` и прежние hooks не возвращались.

Сейчас переключение остаётся таким:

```dotenv
CHAT_MODE=direct
CHAT_FAST_PROVIDER=yandex
CHAT_FAST_MODEL=gpt://<folder-id>/yandexgpt-lite/latest
CHAT_STANDARD_PROVIDER=openai
CHAT_STANDARD_MODEL=gpt-6.1-sol
```

Ключи — существующие `YANDEX_API_KEY`/`OPENAI_API_KEY`, URL — `YANDEX_API_URL`.
Поменять назначения можно независимо и перезапустить NestJS. Embeddings задаются
отдельно. **`CHAT_MODE=gateway` не реализован/не включён после этого аудита**:
сохраняется прежняя явная ошибка конфигурации вместо подключения несовместимого proxy.

В тестовом YAML `support-fast`/`support-standard` имеют независимые `*_MODEL`,
`*_API_BASE`, `*_API_KEY`; fixture задаёт только fake values и loopback URLs.
Timeout 3 s и отключение cooldowns относятся только к fault-injection тестам,
не являются предложением новых production-лимитов.

Fallback выключен: `num_retries: 0`, deployment `max_retries: 0`, `max_fallbacks: 0`,
все fallback lists пусты. Позже штатный путь — добавить резервный model group,
`router_settings.fallbacks` и ограниченный `max_fallbacks`, сохранив нулевые retries.
Это [стандартная конфигурация LiteLLM](https://docs.litellm.ai/docs/proxy/reliability),
не новый менеджер. Её нужно отдельно проверить на реальных ошибках и истории:
cross-provider fallback может удалять несовместимое encrypted reasoning; JSON schema,
tool history и категории ошибок нельзя считать автоматически совместимыми.
Сейчас резервные модели и fallback не включены.

## Воспроизведение и восстановление

Из корня checkout, PowerShell, после установки существующих зависимостей:

```powershell
docker compose -f infra/litellm/compose.conformance.yaml up -d
node --test infra/litellm/tests/stock.integration.cjs
# Ожидается ненулевой exit: acceptance blocker оставлен видимым.
docker compose -f infra/litellm/compose.conformance.yaml down
```

Для 1.100.3 перед `up` установить
`$env:LITELLM_TEST_IMAGE='ghcr.io/berriai/litellm:v1.100.3@sha256:a68b34df312f1e72914f0886384517fa4fdb09013480460b80a4e3a40104376b'`.
Запуски последовательные: fixture queue общая. Compose не подключает реальные
`.env`, provider URLs или БД; порты опубликованы только на host loopback.
Docker Desktop bridge нужен для публикации портов; это не network sandbox.

Для отдельного Direct-контроля при работающем стенде:

```powershell
$env:STOCK_DIRECT_CONTROL='1'
$env:STOCK_CASE_FILTER='jsonSchema|finish_reason'
node --test infra/litellm/tests/stock.integration.cjs
Remove-Item Env:STOCK_DIRECT_CONTROL, Env:STOCK_CASE_FILTER
```

Direct backup: `../direct-backup-20261017-061945` — 25 файлов, 12 удалённых путей,
binary diff, manifest, recovery-check; hashes и восстановление проверены.
Архив `../phase4-backup-20261015-121826` сохранён; проверены SHA-256 всех 112 файлов.
Ничего не коммитилось и не публиковалось.
