# Phase 3 — LiteLLM chat gateway

Результат проверки: 13 октября 2026. База — опубликованный Phase 2 commit
`fd1337d3c952c6c8ff299998d8d4a453304058d7`, ветка
`refactor/ai-provider-abstraction`. Phase 3 одобрена для публикации как offline-tested
infrastructure stage, без утверждения production cross-provider fallback.

`AiService.getChatModel('FAST' | 'STANDARD')` сохранён. Добавлен переключатель
`CHAT_MODE=direct|gateway`; отсутствие переключателя сохраняет direct mode.
В gateway mode NestJS передаёт только логические aliases и использует Responses
API. Конкретный провайдер, reasoning, sampling и транспорт upstream принадлежат
конфигурации LiteLLM. STRONG зарезервирован, вызов запрещён.

**Cross-provider fallback выключен.** Проверенный транспорт позволяет направить
один и тот же Responses-запрос к Yandex Chat Completions или OpenAI Responses.
Это ещё не подтверждает одинаковую обработку всех схем и истории у реальных
провайдеров. Автоматическое переключение сейчас включать рано.

## Топология и границы

```text
Support Agent / Product Consultation — существующие вызовы FAST / STANDARD
                         |
                     AiService
              direct     |     gateway
           провайдер     | POST /v1/responses, support-fast / support-standard
                         v
           один LiteLLM container, один worker, private Docker bridge
           host publish: 127.0.0.1:4000; Admin UI disabled
                  /                         \
     выбранный Yandex profile       выбранный OpenAI profile
     Responses → Chat Completions   native Responses
                  |
          опционально: отдельная PostgreSQL LiteLLM
          свой user/password/volume; DB-порт не публикуется

Embeddings → прежний независимый провайдер → прежний индекс Qdrant
```

Одновременно выбирается один YAML profile, по одному deployment на alias.
Между провайдерами нет случайной балансировки. Redis не нужен для этой локальной
одноэкземплярной конфигурации. Вынесение Support в отдельный сервис не требует
переносить provider routing в бизнес-код: меняется адрес gateway в окружении.
Новый порт/фреймворк агентов для этого не введён.

PostgreSQL здесь принадлежит LiteLLM; её собственные таблицы создаёт LiteLLM.
Commerce DB, её миграции, embeddings, Qdrant, BM25, графы, Orders, Product Core,
Workspace и frontend не менялись. Существующий application repair после ошибки
разбора остаётся отдельным вызовом модели; gateway его не инициирует.

## Версия и доказательства совместимости

Закреплён образ:

```text
ghcr.io/berriai/litellm:v1.100.3@sha256:a68b34df312f1e72914f0886384517fa4fdb09013480460b80a4e3a40104376b
```

Проверены source tag `v1.100.3`, commit
`385266c14d6a4cb069751fd3525692e0a760ec57`, digest образа и версия запущенного
пакета `1.100.3`. Это проверенная конкретная версия, не заявление о самой новой
или о результатах security-аудита образа. SDK: `@langchain/openai` 1.5.6,
`@langchain/core` 1.2.8, `openai` 6.46.0.

| Маршрут | Upstream API | Параметры | Статус проверки |
| --- | --- | --- | --- |
| direct Yandex FAST / STANDARD | Chat Completions | temperature 0, без reasoning | Реальные SDK + mock HTTP |
| direct OpenAI Luna / Sol | Responses | none + temperature 0 / medium без temperature | Реальные SDK + mock HTTP |
| gateway → Yandex FAST / STANDARD | Responses → Chat Completions, `use_chat_completions_api: true` | temperature 0, без reasoning | Реальный LiteLLM + mock upstream |
| gateway → OpenAI Luna / Sol | Responses → Responses | none + temperature 0 / medium без temperature | Реальный LiteLLM + mock upstream |
| gateway `/v1/chat/completions` → Yandex | Chat Completions | deployment settings | Реальный LiteLLM + mock upstream |
| gateway `/v1/chat/completions` → OpenAI profiles | Обратный bridge | Не разрешён policy | Проверен отказ HTTP 400 до upstream |
| Yandex ↔ OpenAI автоматический fallback | Потенциально общий Responses-вход | Выключен | Нет live conformance; история с encrypted reasoning непереносима без отдельной проверки |
| GigaChat / Qwen / неизвестный profile | Не реализовано | Запрещено | Неизвестный deployment отклоняется |

В реальном gateway проверены function calling, `strict: false`, default structured
output с вложенной Router schema и `strict: true`, JSON mode, Zod validation,
`includeRaw`, malformed raw tool arguments, tool-result history, refusal,
valid JSON с incomplete-статусом, incomplete tool calls, ошибки и телеметрия.
Mock upstream не валидирует schema как сервер Yandex/OpenAI: принятие схем
провайдером и качество ответа остаются live-проверками.

В bundled capability map LiteLLM 1.100.3 нет целевых GPT-6. Его Responses validator
ищет bare model name даже при Router entry с `openai/` prefix. Поэтому
`gateway_policy.py` явно регистрирует поддержку `none` для Luna и отсутствие
поддержки `none` для Sol. Это декларация возможностей двух известных моделей,
без тарифов, prefix guessing или загрузки изменяемой удалённой cost map.
При обновлении LiteLLM эту совместимость нужно перепроверить.

Yandex profile требует `gpt://` model URI и явно использует OpenAI-compatible
endpoint из `YANDEX_API_URL`. Это не неподтверждённый native Yandex adapter.
OpenAI gateway profile разрешает только точные IDs `gpt-6-luna` и `gpt-6.1-sol`
(также с `openai/` prefix); arbitrary aliases/snapshots требуют отдельного
проверенного infrastructure profile. В direct mode настройки custom deployment
profiles Phase 2 сохранены.

## Переменные и запуск

Команды ниже выполняются из корня репозитория. Копировать пример только если
собственного `infra/litellm/.env` ещё нет:

```powershell
Copy-Item infra/litellm/.env.example infra/litellm/.env
```

Заполнить этот отдельный ignored-файл; рабочие ключи не входят в репозиторий.

| Где | Переменные |
| --- | --- |
| NestJS, direct | `CHAT_MODE=direct`, `CHAT_PROVIDER`, прежние chat provider settings |
| NestJS, gateway | `CHAT_MODE=gateway`, `LITELLM_BASE_URL=http://127.0.0.1:4000/v1`, `LITELLM_API_KEY` |
| NestJS, оба режима | `EMBEDDING_PROVIDER` и прежние embedding settings; не менять вслед за chat |
| LiteLLM, всегда | `LITELLM_MASTER_KEY`, `LITELLM_CONFIG_FILE=config.yandex.yaml` или `config.openai.yaml` |
| LiteLLM, Yandex | `YANDEX_API_KEY`, `YANDEX_API_URL` с `/v1`, `YANDEX_LITE_MODEL`, `YANDEX_MODEL` |
| LiteLLM, OpenAI | `OPENAI_API_KEY`, `OPENAI_FAST_MODEL=gpt-6-luna`, `OPENAI_STANDARD_MODEL=gpt-6.1-sol` |
| LiteLLM, budgets overlay | `LITELLM_POSTGRES_PASSWORD` (URL-safe), постоянный `LITELLM_SALT_KEY` |

Gateway mode не читает `CHAT_PROVIDER`, upstream chat keys или model IDs в NestJS.
Embedding client по-прежнему может требовать свой provider key в NestJS.
Base URL gateway обязан быть HTTP(S), оканчиваться `/v1` и не содержать credentials,
query или fragment. Инициализация chat lazy, модели кешируются по роли; после
смены окружения требуется перезапуск приложения.

Базовый запуск без DB/virtual keys/budgets:

```powershell
docker compose --env-file infra/litellm/.env -f infra/litellm/compose.yaml up -d --wait
docker compose --env-file infra/litellm/.env -f infra/litellm/compose.yaml down
```

В этом локальном режиме master key можно использовать для smoke-проверки.
Для приложения с бюджетами выдаётся отдельный scoped virtual key. Upstream API
keys передаются только gateway. Перезапуск с другим `LITELLM_CONFIG_FILE` меняет
провайдера для обоих aliases, не меняя application/domain code.

Бюджетный запуск после настройки проверенных тарифов, описанной ниже:

```powershell
docker compose --env-file infra/litellm/.env -f infra/litellm/compose.yaml -f infra/litellm/compose.budgets.yaml up -d --wait
docker compose --env-file infra/litellm/.env -f infra/litellm/compose.yaml -f infra/litellm/compose.budgets.yaml down
```

`down` сохраняет volume LiteLLM DB. Не направлять `DATABASE_URL` на commerce DB.
Overlay формирует URL для собственного сервиса `litellm-db` с отдельным паролем.
Соль после появления зашифрованных данных должна сохраняться вместе с DB.

Для административного UI установлен `DISABLE_ADMIN_UI=true`; management API остаётся
доступен с admin key на private gateway. Этот флаг LiteLLM не удаляет статический
HTML `/ui/`: он управляет доступом к UI/login. Публикация всего gateway ограничена loopback.
Если NestJS запущен в контейнере, подключить его к общей private network и
использовать `http://litellm:4000/v1`: его `127.0.0.1` указывает на него самого.
Не публиковать этот Compose как публичный API. Для другого хоста нужны private
network/TLS и отдельная проверка deployment, что не реализуется этим локальным Compose.

## Retry, timeout и fallback

Client SDK `maxRetries: 0`, gateway deployment `max_retries: 0`, Router
`num_retries: 0`, `max_fallbacks: 0`, все fallback lists пустые. Gateway timeout
60 секунд, NestJS gateway timeout 70 секунд. Новый Runnable retry не добавлен.
Это граница отдельного LLM-вызова, не повтор графа, tool side effect или заказа.
Ошибки Zod/domain validation не вызывают gateway fallback.
Существующие graph/node deadlines не менялись: например, Support AI node timeout
30 секунд может завершить ожидание раньше transport timeout. Gateway timeout
не гарантирует продления deadline приложения или отмены биллинга уже начатого upstream вызова.

Policy запрещает клиентские overrides routing, retry header, credentials,
reasoning/sampling, неизвестные aliases, built-in tools, background, streaming и
server-stored conversation. Настройки deployment нельзя случайно заменить
вызовом приложения. Policy не является общей системой авторизации всех LiteLLM
API; доступ к management endpoints контролируют ключи и private deployment.

Транспортный кандидат для будущего fallback: общий `/v1/responses` на входе,
Yandex через явный CC bridge, OpenAI нативно через Responses. Для включения
одного fallback нужны conformance каждого используемого structured-output/tool
режима, история tool calls, provider-specific encrypted reasoning, отказ,
truncation, latency и точный учёт двух физических попыток. Encrypted reasoning
OpenAI нельзя считать переносимым в Yandex. Непрошедшие режимы не должны
автоматически переключаться. Phase 3 ничего из этого не включает.

## Завершённость ответа и raw data

`src/ai/chat-http.ts` проверяет HTTP envelope **до** обработки LangChain, parser
или tool executor. Он не переписывает ответ: после проверки SDK получает исходный
Response. Для Responses требуются `status=completed`, отсутствие `error`, массив
`output` и отсутствие незавершённых output items. Для direct Chat Completions
разрешены только `stop`, `tool_calls`, `function_call`.

`status=incomplete` отклоняется даже при синтаксически правильном JSON и правильных
tool arguments. `includeRaw` не превращает такой вызов в успех. OpenAI SDK
оборачивает ошибку fetch в connection error; `cause.name=ChatTransportError`
и `cause.chatTransport` сохраняют ID/status для диагностики. HTTP 4xx/5xx
передаются SDK с исходным статусом; abort signal и identity ошибки сохраняются.
Схемы и существующая Zod/domain validation остаются следующей отдельной проверкой.

Ограничения, которые нельзя скрывать нормализацией:

- LiteLLM превращает `length`/`content_filter`/`refusal` finish reason в Responses
  `incomplete`; это проверено. Неизвестный ненулевой reason нормализуется в `stop`,
  но сохраняется как `native_finish_reason`: policy проверяет его и возвращает 502.
- **Отсутствующий/null finish reason upstream Chat Completions LiteLLM 1.100.3
  заменяет `stop`, не сохраняя исходный статус.** После такого преобразования
  приложение не может доказать завершённость исходного ответа. Для этой формы
  malformed upstream ответа строгой гарантии нет. Direct guard её отклоняет.
  Не расширять список провайдеров, пока не проверен их реальный completion contract.
- Completed refusal не означает parsed success. OpenAI refusal сохраняется в raw;
  для Yandex bridge проверено отсутствие parsed result, но не гарантируется
  сохранение исходного refusal field. Существующий direct LangChain CC converter
  тоже теряет это поле. Нормализованный raw не является полным upstream packet.
- Потоковый ответ не позволяет этому non-streaming guard заранее проверить
  финальный status. `disableStreaming: true` в обоих режимах предотвращает также
  неявный HTTP streaming из `graph.streamEvents()`: одного `invoke()` недостаточно,
  поскольку LangChain учитывает streaming callbacks. Graph v3 events и tool loop
  проверены отдельно в direct/gateway mode; model output приходит после завершения,
  без постепенной выдачи provider token deltas. Графы и их cancellation не менялись.
  Попытка передать wire `stream: true` дополнительно отклоняется guard до HTTP.
- `store: false` и replay encrypted reasoning обеспечивают stateless protocol;
  SDK `zdrEnabled` не включает account-level Zero Data Retention.

## Телеметрия

| Event / usageScope | Что считает | Связь |
| --- | --- | --- |
| `llm_call` / `logical_call` в gateway mode | Вызов модели LangChain; один вызов графа может содержать несколько | `runId`, parent, role metadata; success `responseId`, error transport context |
| `llm_gateway_request` / `gateway_request` | Один HTTP-запрос NestJS → gateway | UUID `gatewayRequestId`, `responseId`, alias, headers с actual provider/model/deployment |
| `llm_gateway_deployment` / `deployment_attempt` | Физический provider deployment attempt | gateway ID + deployment ID, started и terminal event |
| `llm_call` / `provider_call` в direct mode | Прежний вызов direct модели | Прежние usage/tags/metadata плюс response ID |

Для подсчёта физических попыток считать **terminal** deployment events, не
складывать их со `started`, gateway или logical events. У Yandex bridge outer
Responses hook является обёрткой; логируется только leaf Chat Completions hook.
Проверены одна попытка на успех/503, две при существующем workspace repair и
раздельная корреляция двух параллельных вызовов одной cached model.

Gateway response body может содержать alias вместо настоящей модели: actual
model берётся из deployment event и `x-litellm-model-name`, provider — из
проверенного profile/header. Usage и latency есть на отдельных уровнях;
полученные на нескольких уровнях token counts нельзя суммировать. Logical
success — завершение model invocation, не успешная domain/Zod validation.

Неизвестная стоимость — `null`. Заголовки `cost-*` могут содержать ноль при
неизвестной цене; они не используются как доказательство стоимости. Cost
публикуется только для deployment с `pricing_verified: true` и доступным
значением LiteLLM. Это gateway estimate, не счёт провайдера. На ошибке usage/cost
могут быть неизвестны. Terminal event на падении процесса также может отсутствовать;
это структурированные операционные логи, не гарантированный billing ledger.

Fallback выключен: attempted fallback count равен 0 в проверенных ответах.
Failure event содержит `errorType` и доступный hook `fallbackDepth`; причина
перехода между провайдерами и корректность логов цепочки fallback не проверены.
Перед его включением нужны отдельные failure/retry/fallback тесты. Наши новые
deployment events не содержат prompts, raw arguments или secrets; стандартные
ошибки SDK/gateway всё равно требуют обычного контроля хранения логов.

## Virtual keys и бюджеты

В конфигурации без DB нет виртуальных ключей и budget accounting. Optional overlay
использует PostgreSQL 17.6 Alpine, собственные credentials и volume.
`fail_closed_budget_enforcement: true` установлен, однако поведение при потере DB,
рестарте, конкуренции и нескольких replicas в production здесь не проверено.

**В production YAML тарифы намеренно отсутствуют.** В budget mode policy требует
у каждого deployment в `model_info`:

```yaml
# Вставить проверенные ЧИСЛОВЫЕ USD/token значения вместо подсказок ниже.
pricing_verified: true
input_cost_per_token: <verified input USD per token>
output_cost_per_token: <verified output USD per token>
```

Подсказки не являются рабочим YAML. Цены нужно получить для фактического договора,
модели и единиц биллинга; для per-million разделить на 1 000 000. Если отличаются
cached input, reasoning, tiers или валюты, проверить их учёт в выбранной версии
LiteLLM и настроить соответствующие поля перед маркировкой `pricing_verified`.
Два base-rate поля сами по себе не доказывают корректность сложного биллинга.
В overlay `SUPPORT_REQUIRE_PRICING=true`: отсутствующие, неподтверждённые,
отрицательные или нечисловые цены блокируют вызов до provider. Нули допустимы
лишь при подтверждённом бесплатном тарифе. Фиктивных production цен не добавлено.

После настройки тарифов и запуска DB выдать приложению scoped key. В следующем
примере admin key и выбранный владельцем месячный бюджет уже установлены в
**окружении PowerShell** (Compose `.env` не импортирует их в текущую оболочку):

```powershell
if (!$env:LITELLM_MASTER_KEY -or !$env:SUPPORT_CHAT_BUDGET_USD) { throw 'Set admin key and your budget first' }
$budgetUsd = [double]::Parse($env:SUPPORT_CHAT_BUDGET_USD, [Globalization.CultureInfo]::InvariantCulture)
if ([double]::IsNaN($budgetUsd) -or [double]::IsInfinity($budgetUsd) -or $budgetUsd -le 0) { throw 'Budget must be positive and finite' }
$keyRequest = @{ models = @('support-fast', 'support-standard'); max_budget = $budgetUsd; budget_duration = '30d' } | ConvertTo-Json
$issuedKey = Invoke-RestMethod -Uri http://127.0.0.1:4000/key/generate -Method Post -ContentType application/json -Headers @{ Authorization = "Bearer $env:LITELLM_MASTER_KEY" } -Body $keyRequest
$env:LITELLM_API_KEY = $issuedKey.key
```

Сохранить выданный ключ в secret environment NestJS. Master key не использовать
как бюджетный ключ приложения. Management endpoint и scope проверены с real
gateway/DB: доступ к alias вне key scope дал 403 без upstream request.

Проверка бюджета использовала **исключительно тестовые** цены 0.001/0.002 USD за
token, usage 10 input + 5 output, budget 0.015 USD. Первый ответ учтён как 0.02,
значение прочитано через `/key/info`, следующий последовательный вызов получил
429 budget error без повторного upstream HTTP. Это намеренно показывает, что
лимит не является резервированием максимальной стоимости до первого вызова.
Уже начатый запрос может превысить остаток; асинхронные записи и параллельные
запросы требуют проверки. Production hard cap не заявляется. Test harness
устанавливает `proxy_batch_write_at=1` для быстрой проверки persistence, production
batching остаётся default. Production DB в этой работе не запускалась.

## Воспроизведение offline-проверок

Основной integration test проходит цепочку **AiService → установленный LangChain
и OpenAI SDK → настоящий закреплённый LiteLLM → локальный HTTP mock**. Harness
запускает два gateway процесса внутри одного test container; budget overlay
добавляет третий процесс и disposable PostgreSQL с tmpfs. Это тестовая оснастка,
не production топология с тремя gateways.

Все upstream URLs жёстко перенаправлены на loopback mock, ключи фиктивные,
реальный `.env` не загружается, LLM API не вызываются. Docker bridge позволяет
публикацию localhost ports и **не является сетевым запретом всего egress**.
Порты теста: 34180 control/mock, 34181 Yandex, 34182 OpenAI, 34183 budget.

```powershell
docker compose -f infra/litellm/compose.test.yaml -f infra/litellm/compose.test.budgets.yaml up -d --wait --wait-timeout 180
$env:RUN_LITELLM_INTEGRATION = '1'
$env:RUN_LITELLM_BUDGET_INTEGRATION = '1'
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/ai/gateway.integration.spec.ts
docker compose -f infra/litellm/compose.test.yaml exec -T -e PYTHONPATH=/gateway gateway-contract python /gateway/tests/test_policy.py
docker compose -f infra/litellm/compose.test.yaml -f infra/litellm/compose.test.budgets.yaml down
Remove-Item Env:RUN_LITELLM_INTEGRATION, Env:RUN_LITELLM_BUDGET_INTEGRATION
```

Без budget overlay можно опустить второй Compose-файл и budget env flag:
бюджетный case будет skipped. Без `RUN_LITELLM_INTEGRATION=1` весь integration
suite skipped. Harness хранит общую очередь fixtures: запускать этот suite
последовательно, не параллельно с другим процессом тестов этого harness.

Результаты на указанной базе:

| Проверка | Результат |
| --- | --- |
| 12 выбранных Jest suites: direct contracts, configuration, guard, usage, прежние consumer regressions | 157 passed |
| Реальный LiteLLM integration, включая budget DB, graph events и concurrent correlation | 38 passed |
| Python policy contracts в том же образе | 5 passed |

Набор 12 suites: `ai.service`, `chat-transport`, `chat-transport.contract`,
`chat-http`, `gateway-config`, `llm-usage`, `consultation-agent-workspace`,
`product-recommendation-synthesizer`, `request-router-cross-domain`,
`aggregate-final-answer.node`, `langchain-product-consultant-model.adapter`,
`execute-product-decision-semantic-enrichment`. Их исходники вне `src/ai` не менялись.

Jest использует isolated transpilation. Перед публикацией Phase 3 по отдельному
заданию выполнена компиляционная проверка
`node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.build.json`:
exit 0, без ошибок. Она исключает spec-файлы согласно build config. Полный repository
test suite, emitting Nest build и live paid calls не запускались. Эти проверки не
доказывают production SLA, billing correctness или model quality.

## Файлы Phase 3

| Файл | Назначение |
| --- | --- |
| `src/ai/ai.service.ts` | Режимы, aliases, lazy gateway client, HTTP guard; embedding методы сохранены |
| `src/ai/chat-http.ts` | Non-streaming completion guard и отдельный HTTP telemetry event |
| `src/ai/llm-usage.ts` | Сохранён callback; scope и correlation ID |
| `src/ai/ai.service.spec.ts` | Совместимость direct-конфигурации с guard и mode metadata |
| `src/ai/chat-transport.contract.spec.ts` | Новое требование rejection при truncation до parser |
| `src/ai/chat-http.spec.ts` | Завершённость, abort identity, route/stream guard, unknown cost |
| `src/ai/gateway-config.spec.ts` | Aliases, isolation, lazy configuration, STRONG, URL validation |
| `src/ai/gateway.integration.spec.ts` | Полная offline HTTP-цепочка, реальные схемы, telemetry и budget |
| `src/ai/README.md` | Настройка application AI modes и граница инфраструктуры |
| `infra/litellm/config.yandex.yaml` | Два Yandex deployments и explicit Responses bridge |
| `infra/litellm/config.openai.yaml` | Два native Responses deployments, reasoning/sampling |
| `infra/litellm/gateway_policy.py` | Разрешённые profiles, guards, physical attempt logs |
| `infra/litellm/compose.yaml` | Один приватный pinned gateway |
| `infra/litellm/compose.budgets.yaml` | Отдельная LiteLLM DB и pricing gate |
| `infra/litellm/.env.example` | Имена настроек без рабочих секретов |
| `infra/litellm/compose.test.yaml` | Изолированная тестовая оснастка с localhost ports |
| `infra/litellm/compose.test.budgets.yaml` | Disposable test DB и третий budget gateway process |
| `infra/litellm/tests/runtime.py` | Mock upstream и запуск реальных test gateway processes |
| `infra/litellm/tests/test_policy.py` | Offline guards для profiles и verified pricing |
| `infra/litellm/README.md` | Этот отчёт, эксплуатационные команды и ограничения |

## Что проверить перед реальным включением

1. Доступ конкретных аккаунтов к Yandex model URIs и OpenAI model IDs; точные URLs
   и auth. Проверить serialized Router, Workspace, Recommendation, Handoff,
   Enrichment схемы у каждого провайдера, включая unsupported schema keywords.
2. Один tool loop на каждом deployment с raw arguments, отказом и принудительной
   truncation. Подтвердить, что Yandex всегда возвращает корректный finish reason.
3. Реальные usage, cached/reasoning tokens, стоимость по договору и persistence
   virtual-key spend; ошибка DB, concurrency, рестарт и превышение лимита.
4. Timeouts/abort и provider errors на реальном gateway, retention/error logging,
   ресурсы pinned образа и требования deployment security.
5. Только после этого отдельно решать вопрос fallback по операциям. История с
   provider-specific state и encrypted reasoning — отдельный запрет до проверки.

Ни один из этих live-вызовов в Phase 3 не выполнен. Phase 4 автоматически не начата.

## Первичные источники

- [LiteLLM v1.100.3](https://github.com/BerriAI/litellm/releases/tag/v1.100.3) и
  [закреплённый source tree](https://github.com/BerriAI/litellm/tree/385266c14d6a4cb069751fd3525692e0a760ec57).
- [Responses API](https://docs.litellm.ai/docs/response_api),
  [OpenAI-compatible providers](https://docs.litellm.ai/docs/providers/openai_compatible):
  проверены с реализацией `responses/main.py` и
  `responses/litellm_completion_transformation/transformation.py` выбранного tag.
- [Logging](https://docs.litellm.ai/docs/proxy/logging),
  [Routing](https://docs.litellm.ai/docs/routing),
  [Virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys),
  [Cost tracking](https://docs.litellm.ai/docs/proxy/cost_tracking).
- [Deployment](https://docs.litellm.ai/docs/proxy/deploy),
  [Proxy architecture](https://docs.litellm.ai/docs/proxy/architecture).
- [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
  [OpenAI Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

Онлайн-документация изменяется; спорные детали выше подтверждались исходниками
закреплённой версии и локальным выполнением, а не только текущим текстом docs.
