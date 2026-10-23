> HISTORICAL SNAPSHOT — preserved research/results, not current deployment instructions. Final pre-commit cleanup (2026-10-23) supersedes runtime/status claims below; see [current implementation](../PRODUCTION-AI-REVIEW.md).

# Subsequent stock gateway evaluation — 2026-10-17

See [MINIMAL-GATEWAY.md](MINIMAL-GATEWAY.md). Stock 1.100.3 and 1.105.1 were
tested with native Responses/Chat Completions endpoints and no Python hooks.
Those results do not reinstate the Phase 4 runtime or its guarantees below.
Direct remains the working application mode; Phase 5 has not started.

# Historical Phase 4 snapshot — not the current runtime

The following report preserves the original findings and test results. The later
approved direct-provider simplification removed the gateway and unused execution
context. It did not implement Phase 5 or fix the documented application gaps.
See [current behavior](../../src/ai/README.md) and
[recovery/inventory](../../src/ai/SIMPLIFICATION.md). Historical commands and
admission guarantees below apply to the backed-up Phase 4 implementation only.

# LLM Reliability Hardening - Phase 4

Архитектурный аудит и результаты реализации. 14 октября 2026.

## Исходный блокер финальной проверки Phase 4 — 14 октября 2026

После описанного ниже отказа пользователь разрешил свежую проверку БД на каждый
вызов. Исправление реализовано и проверено только локально в Phase 4;
актуальная схема и результаты вынесены в раздел 14. Commit/push и Phase 5 запрещены.

Повторная независимая проверка перед commit: 176/176 обычных Jest-тестов,
111/112 Docker integration, 14/14 Python; TypeScript, Compose configuration
и `git diff --check` прошли. Не прошёл тест `DB unavailability blocks warm
and cold keys within a caller-bounded observation window` в
`src/ai/gateway-budget-reliability.integration.spec.ts:276`.

Отдельное воспроизведение подтвердило: при `pause budget-db` тёплый virtual key
получает HTTP 200, mock upstream видит один законченный вызов; холодный key
завершается клиентским TimeoutError через 5 секунд. После восстановления появился
ещё один deployment `started`, но дополнительный upstream HTTP в наблюдении
не зарегистрирован. Нельзя считать `started` доказательством физической отправки.

В закреплённом `budget_reservation.py` флаг `fail_closed_budget_enforcement`
обрабатывает `_CounterReservationUnavailable`; reservation использует spend counter
cache. Этот флаг сам по себе не гарантирует отказ при недоступности PostgreSQL,
если авторизация и счётчик доступны из cache. Предыдущий успешный DB experiment
ниже не является воспроизводимой гарантией. Политика admission при DB outage
требует отдельного исправления и проверки warm/cold/recovery сценариев.

На момент обнаружения по условию задания commit/push Phase 4 и переход к Phase 5
были остановлены, runtime-код и тесты тогда не менялись. Диагностика сохранена локально
в `.tmp/phase4-final-gateway.json`, `.tmp/phase4-final-gateway.log`,
`.tmp/phase4-db-outage-repro.cjs` и `.tmp/phase4-db-outage-observation.jsonl`.
Эти ignored-файлы не входят в commit. Production сервисы и реальные LLM не запускались.

## 1. Результат и границы

Phase 3 опубликована в `refactor/ai-provider-abstraction`: коммит
`aff28c0ee5912047f524b16db9fd8a262606ecf2`, родитель
`fd1337d3c952c6c8ff299998d8d4a453304058d7`. Phase 4 оставлена локально для review.
Никакие другие ветки не объединялись. Production fallback по-прежнему выключен.

Архитектура сохранена: приложение выбирает FAST/STANDARD через AiService,
транспорт и provider profiles остаются в AI-инфраструктуре. Добавлены защита
исходного upstream JSON до преобразований LiteLLM, отмена при disconnect gateway,
явный абсолютный deadline и небольшой необязательный контекст исполнения chat.
Ни один application caller не переключён на новый контекст автоматически.

Главные ограничения до production: отсутствует отмена от клиентского соединения
на входе Nest; обнаружена потеря сигнала node timeout во вложенном LangGraph;
Workspace повторяет ошибки транспорта как repair; Handoff имеет самостоятельный
retry; финансовый лимит не является строгим hard cap. Эти ограничения нельзя
устранить только настройкой gateway. Минимальные предложения вынесены в раздел 8.

Без изменений: Product Core/Workspace, Support orchestration, Orders, Commerce,
Prisma, Qdrant, BM25, embeddings и frontend. Реальные LLM API не вызывались.
Тестовая PostgreSQL отдельная, disposable; commerce DB не использовалась.

## 2. Зафиксированная среда и доказательства

LiteLLM: `v1.100.3`, image digest
`sha256:a68b34df312f1e72914f0886384517fa4fdb09013480460b80a4e3a40104376b`.
Исходники: `385266c14d6a4cb069751fd3525692e0a760ec57`.
Установлены LangGraph 1.4.9, LangChain 1.5.9, core 1.2.8, OpenAI integration 1.5.6,
OpenAI JS SDK 6.46.0, TypeScript 5.9.3. Dependencies не обновлялись.

Проверка проходит AiService -> настоящий LangChain/OpenAI SDK -> настоящий
закреплённый LiteLLM -> локальный HTTP mock. Отдельно проверены публичные
методы существующих callers с подставленными сервисами. Это не полный запуск
Nest с production auth, реальным браузером, checkpointer и commerce services.

| Проверка | Результат |
| --- | --- |
| 12 прежних Jest suites + context/caller suites, всего 14 | 176 passed |
| Phase 3 gateway regression | 38 passed |
| Phase 4 gateway failure injection | 66 passed |
| Phase 4 disposable DB | После admission fix: 8 passed; вместе с двумя suites выше 112 passed. До fix воспроизводился DB outage failure |
| Дополнительные budget admission HTTP contracts | 5 passed |
| Python policy + upstream HTTP guard + admission | 30 passed |
| `tsc --noEmit --incremental false -p tsconfig.build.json` | exit 0; baseline Phase 3 также exit 0 |

Jest выполняет isolated transpilation; build config исключает spec-файлы.
Полный repository suite и emitting Nest build не запускались. Результаты mock
проверяют протокол и исполнение, а не качество ответов моделей или реальные счета.

## 3. Слои повторов и тайм-аутов

Под attempts ниже понимается число возможных выполнений на данном слое.
Tool round и повтор после неверной структуры - новые model calls, а не SDK retry.

| Слой и активность | Attempts / timeout | Какие ошибки повторяются | Отмена / риск повторных tools |
| --- | --- | --- | --- |
| OpenAI JS / LangChain model, active | 1; SDK retries 0; gateway 70 s, direct SDK default 600 s | Никакие на транспортном слое | Переданный signal доходит до HTTP; tools не исполняет |
| LiteLLM Router + deployments, active | 1; retries 0, fallback 0, timeout 60 s | Никакие в production | `cancel_on_disconnect: true`; tools не исполняет |
| LiteLLM upstream HTTP, active | 1 send; timeout сокращается остатком deadline | Скрытый retry ConnectError/RemoteProtocolError устранён | Guard читает тело внутри абсолютного deadline; сокет mock закрывается |
| Support router и Customer Help nodes, active | maxAttempts 1; 30 s на узел | Автоматических повторов нет | Nested tool loop теряет node signal без нового context; уже выполненные tools не откатываются |
| Product worker, active | maxAttempts 1; 60 s на составной узел | Автоматических повторов узла нет | Nested graph имеет тот же риск; 60 s включают планирование, поиск и несколько задач |
| Workspace planner, active | До 2 model calls; собственной общей границы нет | Сейчас catch-all: parsing, normalization, auth, timeout, abort | Ambient signal работает для прямого model call; generic ошибка в конце теряет исходную причину; tools внутри repair не выполняются |
| Handoff prepare, active | До 2 попыток по 30 s; backoff 1 s + jitter до 1 s | LangGraph default: большинство ошибок, включая 429/5xx/parse; исключения см. ниже | Подготовка может повторяться; `createHandoffNode` находится после неё и не входит в retry |
| Recommendation / semantic enrichment, active | По 1 вызову, собственных retry нет | Нет | Зависит от переданного/ambient signal и внешнего Product node; transport не повторяет backend actions |
| `consultation.agent.ts:decide().withRetry` | До 2; собственного timeout нет | Runnable retry вокруг structured output | Метод создаётся, но из текущего production графа не вызывается; не умножать им active Workspace attempts |
| Legacy comparison synthesis | 1; отдельный signal на 12 s | Нет; catch возвращает null | Отдельный signal не доказывает наследование родительского abort; legacy `consult-products.node` не подключён к текущему Product graph |
| ProductConsultantLoop, debug/eval | model timeout 15 s default, live debug задаёт 30 s; до 2 смысловых раундов | Собственная обработка результата, не graph retry | Собственный AbortController объединён с входным; текущий live Product graph использует Workspace, не этот loop |
| Client `chat:retry_assistant`, ручной | Новый запуск по команде пользователя | UI считает retryable timeout/429/5xx/connection | Это повтор операции приложения, а не transport retry; идемпотентность бизнес-действий должна проверяться отдельно |

LangGraph 1.4.9 по умолчанию не повторяет статусы
400/401/402/403/404/405/406/407/409, AbortError, GraphValueError,
ECONNABORTED, insufficient_quota и некоторые сообщения cancellation. Прочие
ошибки могут быть повторены, если maxAttempts > 1. NodeTimeoutError сам по себе
не исключён. В Handoff новая попытка получает новый node timeout; общего deadline
для суммы двух попыток и ожидания сейчас нет. Существующий retry не изменён.

В LiteLLM дополнительно работает cooldown deployment: после injected ошибки
следующий запрос может получить 429 без upstream HTTP. Наблюдаемая задержка -
5 s. Это не повтор запроса. Production-profile тесты ждут окончания cooldown;
изолированные candidate profiles отключают его только для независимых инъекций.

## 4. Deadline и cancellation

Иерархия вложенных бюджетов времени: operation deadline ограничивает общий
бюджет model attempts, внутри которого ограничивается каждый upstream вызов.
Это не рекомендация последовательно сложить тайм-ауты 30/60/70 секунд.

Обозначим D абсолютный deadline операции, N deadline текущего узла, R время
после ответа на обработку и сохранение, t текущее время. Доступный бюджет
модели: `B = max(0, min(D, N) - t - R)`. Сумма attempts и backoff должна
помещаться в B. При B <= 0 новый запрос запрещён. Следующий repair/tool round
использует тот же D, а не новый полный интервал.

Сегодня D отсутствует на входе приложения. Числа 30 s для router/help и 60 s
для Product - реальные локальные ограничения; 60 s gateway и 70 s клиента
являются независимыми защитами. Для router/help gateway timeout уже длиннее
бюджета узла. Даже для Product нельзя выделить все 60 s одному model call,
поскольку в этот узел входят retrieval, работа состояния и другие действия.

Phase 4 не выдумывает новый SLA. Существующие пределы сохранены. Предлагается
выбрать D и R после измерения p95/p99 routing, retrieval, model rounds и сохранения
результата; до этого ограничивать model calls остатком уже заданного node budget.
Нужны запасы на IPC/HTTP и clock skew Nest/gateway. Absolute Unix ms требует
синхронизированных часов; локальные таймеры всё равно ограничивают выполнение.

Добавлен `AiService.withChatExecution({signal, deadlineUnixMs}, operation)`.
Это AsyncLocalStorage-контекст в одной Node process, без новой state machine.
Вложенный контекст берёт минимальный deadline и объединяет сигналы; параллельные
запросы изолированы. Он ограничивает только chat transport и не отменяет произвольные
действия callback/БД. Его нужно явно подключить на нужной application boundary.

Chat HTTP объединяет SDK signal с execution signal, ставит таймер абсолютного D,
отклоняет просроченный вызов до отправки и отбрасывает поздний ответ. В gateway
идёт `x-support-deadline-unix-ms`. Guard LiteLLM проверяет остаток до каждого
deployment и не начинает fallback после D. HTTPX guard ограничивает весь send/read
через asyncio timeout; это дополняет per-I/O timeouts HTTPX. В direct mode заголовок
удаляется, но локальная отмена действует. Upstream gateway transport тоже удаляет
его до отправки провайдеру. Клиентские override retry/timeout в JSON запрещены.

| Проверенная ситуация | Наблюдение |
| --- | --- |
| Прямой model.invoke с AbortSignal, оба upstream | Nest HTTP отменён, mock upstream видит disconnect, нового вызова нет |
| Уже отменённый signal / expired deadline | Upstream запрос не отправлен |
| Explicit deadline через SDK options | Сокет upstream закрывается; gateway не начинает fallback после D |
| Workspace repair под node timeout | Второй model call прерывается, результат не возвращается вызывающему коду |
| Nested Customer Help tool loop без нового context | NodeTimeoutError получен, но второй physical call заканчивается позже; передача config сама по себе недостаточна |
| Тот же loop с context, подключённым только в тесте | Node timeout закрывает upstream; search tool вызван один раз, двух physical calls достаточно |
| Узел игнорирует сигнал и возвращает позднюю запись | MemorySaver хранит исходное значение, поздняя запись отброшена |
| Nest ChatGateway sendMessage + socket disconnect | Публичный handler не регистрирует отмену; незавершённый service.run продолжает ожидание |

Причина nested gap подтверждена исходником `pregel/runner.cjs`:
`previousSignals.externalAbortSignal ?? signal` предпочитает сохранённый сигнал
новому сигналу node timeout. Тесты используют установленные версии и реальный
createCustomerHelpAgent. Dependency не патчилась; approval на application wiring
не подменяется изменением node_modules. Операции, игнорирующие abort, и уже
совершённые побочные эффекты не откатываются. Disconnect mock не доказывает
остановку вычислений или биллинга реального провайдера.

## 5. Классификация ошибок

Текущая transport policy для всех категорий: SDK retries 0, same-deployment retry 0,
production fallback 0. Таблица ниже определяет допустимость будущего поведения,
а не включает его. Решение должно учитывать оставшийся D и требования операции.

| Категория | Сейчас | Возможная будущая дополнительная model attempt |
| --- | --- | --- |
| Transient connection failure | Ошибка, один send | Только bounded retry/fallback; неизвестно, принял ли провайдер запрос и начислил стоимость |
| HTTP 429 | Ошибка | Только rate limit с допустимым Retry-After внутри D; budget/quota exceeded не обходить fallback |
| HTTP 502/503/504 | Ошибка | Для подтверждённого transient upstream failure; одного HTTP status недостаточно |
| Request timeout | Ошибка / abort | Только если операция ещё актуальна и D не исчерпан; первая попытка могла быть оплачена |
| Auth/configuration | Немедленная ошибка | Не повторять и не скрывать другой моделью; исправить deployment |
| Invalid structured output | Parsing/validation failure | Один отдельный repair с тем же D может быть допустим; не повторять tools/graph |
| Refusal | Не считать parsed success | Не обходить отказ автоматической заменой модели; вернуть корректный отказ/обработать policy |
| Incomplete response | Guard отклоняет ответ до tools/parser | Не принимать частичный результат; автоматический fallback не утверждён |
| Cancelled / stale operation | Отмена, поздний результат отбрасывается | Никаких новых attempts или repair |

Workspace сейчас нарушает разделение repair/transport: тест на настоящей factory
с ошибкой Auth/Abort/Timeout фиксирует по два invoke. При реальном уже отменённом
signal второй physical HTTP блокируется, но catch-all всё равно делает лишнюю
попытку и заменяет исходную ошибку generic planner error. Исправление относится
к caller и намеренно не применено. Handoff retry тоже нужно сузить отдельно.

## 6. Offline fallback и Yandex completion

Production YAML не содержит маршрутов fallback. Test overlay создаёт отдельные
процессы на 34184/34185, max_fallbacks 1, retries 0, individual timeout 0.5 s.
Эти 0.5 s - ускорение failure injection, не предложение production SLA.

| Условие | Yandex -> OpenAI, FAST / STANDARD | OpenAI -> Yandex, FAST / STANDARD |
| --- | --- | --- |
| 429, 503, upstream timeout; structured tool output | Offline contract пройден: ровно 2 physical calls | Offline contract пройден: ровно 2 physical calls |
| Те же ошибки; JSON mode + schema parse | Offline contract пройден | Offline contract пройден |
| Function/tool-result history без provider state | Tool output дошёл до Responses | Tool output дошёл до Chat Completions |
| OpenAI encrypted reasoning в истории | Вызов OpenAI может вернуть такой state; последующий перенос требует проверки | Заблокировано до Yandex HTTP; state не удаляется молча |
| Malformed upstream JSON | Generic 502 вызывает fallback; для production не утверждено | То же; transport success не доказывает безопасную классификацию |
| Schema-invalid completed response | Один вызов, parsed null, fallback не начинается | То же |
| Incomplete primary / incomplete fallback | Не принимается; нет дополнительных попыток после результата fallback | То же |
| Abort во второй попытке | Upstream отключён, третьей попытки нет | То же |

В тестах проверяются порядок провайдеров, реальные upstream model IDs, общий
gatewayRequestId, разные deployment IDs и отдельные terminal events. Это
совместимость проверенных fixtures, а не доказательство одинаковой семантики,
качества, контекстного окна или поддержки каждой domain schema реальными моделями.

Yandex limitation устранена на доступной исходной границе: custom HTTPX transport
читает upstream bytes раньше Python SDK/LiteLLM Choices. Missing/null/unknown
finish_reason отклоняются с 502. Валидный JSON не переписывается. Статусы
length/content_filter/refusal сохраняются для дальнейшего определения incomplete.
Это публичный HTTPX transport и client injection через deployment hook, без fork
LiteLLM и изменения бизнес-кода. Отдельно устранён скрытый connection resend
в стандартном AsyncHTTPHandler.post, независимый от Router retry=0.

Предел гарантии: non-streaming endpoints и два утверждённых профиля. SSE не
разрешён. Нельзя обнаружить провайдера, который ошибочно сообщил stop/completed;
для этого нужен live conformance. Yandex refusal field может теряться в bridge,
поэтому raw после gateway не равен исходному пакету. Guard не решает эту отдельную
семантическую потерю. Environment proxy mounts отключены (`trust_env: false`),
чтобы они не обходили guard; redirects отключены. Custom proxy/CA transport требует
отдельной настройки и conformance, не включается неявно из окружения.

## 7. Бюджет, persistence и telemetry

В тестовой DB цены 0.001/0.002 USD/token синтетические. Usage 10 input + 5 output
даёт 0.02. Production тарифы не добавлены. Production budget mode блокирует
неподтверждённую цену до upstream через SUPPORT_REQUIRE_PRICING.

| Эксперимент с реальным gateway/PG | Результат / предел вывода |
| --- | --- |
| Два одновременных запроса при max_budget 0.015 | Один 200, второй 429; один physical request, итоговый spend 0.02 |
| Два реально перекрывающихся запроса при достаточном резерве | Два 200, два physical requests, spend 0.04 |
| Restart gateway после подтверждённого spend | Spend 0.02 сохранился в DB; следующий запрос отклонён 429 |
| DB pause, предварительно использованный и холодный keys | До fix: warm HTTP 200 и physical HTTP 1. После admission fix: warm/cold HTTP 503, upstream 0 и после recovery late upstream 0; исходный тест не изменён |
| Provider usage отсутствует, OpenAI response | Ответ 200, usage/cost null, persisted spend 0; это неизвестная стоимость, не бесплатное выполнение |
| Provider attempt 503 | Physical error event, cost/tokens null, spend 0; реальный bill неизвестен |
| Изолированный fallback с DB | OpenAI error + Yandex success, две physical attempts; успешные 10+5 tokens учтены один раз: spend 0.02; cost failed attempt неизвестен |
| Неподтверждённая цена, virtual key с DB | 503 до upstream, physical HTTP 0, spend 0 |
| Kill gateway во время provider request | Один started, terminal отсутствует; после restart spend 0; никакой гарантии нулевого bill |

Уточнение Phase 3: LiteLLM 1.100.3 действительно имеет budget reservation.
`reserve_budget_for_request` оценивает максимальную стоимость; при частично
доступном бюджете `_apply_over_budget_reservation_policy` уменьшает reservation
до остатка и допускает первый запрос. Поэтому concurrency protection существует,
но фактический расход разрешённого запроса может превысить бюджет. Без проверенной
цены reservation может не вычисляться; наш pricing gate запрещает такой вызов
в budget mode. Несколько replicas и общие counters этим single-process тестом
не сертифицированы. Наличие PostgreSQL само по себе этого не доказывает.

DB experiment проверяет отсутствие upstream в ограниченном окне, а не быстрое
HTTP 503: auth/spend lookup ожидал недоступную БД, клиент остановил ожидание.
Долгие outages, recovery races, batching и сбои при записи после успеха требуют
отдельных deployment tests. Здесь `proxy_batch_write_at=1` только для test harness.

Есть четыре разных понятия: gateway cost estimate; подтверждённая запись spend
в DB; счёт провайдера; максимальная допускаемая сумма. Они не эквивалентны.
Restart подтверждает persistence уже записанных данных, не отсутствие потерь при
kill до записи. Missing terminal events надо учитывать как незавершённые attempts
с неизвестным исходом, а не исключать из статистики как «0 запросов».

Usage scopes: logical_call, gateway_request, deployment_attempt. Для physical
attempts сопоставлять started/terminal по gatewayRequestId + deploymentId; для
стоимости брать доступный usage на одном выбранном уровне. Не складывать одни и
те же 10+5 tokens из трёх событий. Failed attempt с null usage не равен нулю.
`usageSource` различает upstream-reported, gateway-estimated-or-missing, unverified;
тело ответа и callback contract не переписываются. Logical callbacks по-прежнему
отражают нормализованный ответ и не являются источником provider billing.

## 8. Минимальные предложения для callers - НЕ ПРИМЕНЕНЫ

Для этих изменений требуется отдельное одобрение согласно scope задания.

1. `src/modules/chat/chat.gateway.ts`: в sendMessage/retryAssistant/resumeClarification
создать execution context на run; выбрать семантику disconnect vs продолжение
чата на сервере. В текущем Socket.IO flow нельзя автоматически приравнять закрытие
одного socket к отмене общей консультации с несколькими клиентами. Для режима
«отмена сессии запроса» зарегистрировать disconnect/explicit cancel и снять listener
в finally. HTTP endpoint, если появится, должен связать req.aborted/res.close с тем
же context, а не создавать новый LLM timeout на каждый шаг.

2. `src/support-agent/support-agent.service.ts`: добавить последний optional
execution argument `{signal, deadlineUnixMs}` к run/resume и соответствующим
stream methods. `src/support-agent/graph/support-agent.graph.ts`: передать signal
в invoke/streamEvents config и обернуть вызов через AiService.withChatExecution.
Передавать context явно через process/RPC boundaries: AsyncLocalStorage их не
пересекает. Не помещать AbortSignal в persisted domain state/checkpoint.

3. В `graph/workers/customer-help-agent.worker.ts` и `product-agent.worker.ts`
обернуть вызов дочернего graph в `aiService.withChatExecution({signal: config.signal},
() => child.invoke(input, config))`. Добавить AiService параметром factory, уже
доступным в SupportAgentGraph. Это сохраняет node-local signal несмотря на
выявленный nested graph дефект. Такой вариант уже проверен в изолированном тесте.
Передавать общий D и, когда определён, меньший node deadline. Не обращаться к
приватному configurable.__pregel_abort_signals приложениям.

4. `application/consultation-agent/consultation.agent.ts:decideWorkspace`:
отделить вызов модели от parsing/normalization. Auth/config/abort/deadline/transient
transport errors пропускать наружу без repair; только успешный completed ответ с
невалидной структурой допускает второй вызов. Сохранить исходную причину. Не менять
domain normalization или набор операций. Для Handoff в
`agents/handoff-agent/handoff-agent.graph.ts` убрать безусловную широкую повторяемость:
на первом этапе maxAttempts 1 либо явный allowlist transient с общим D. Не ретраить
createHandoffNode/полный Support graph. Legacy comparison/decide не трогать, пока
они не возвращаются в production путь.

Приёмочные проверки этих предложений: disconnect/cancel до HTTP и между rounds;
одновременные разные chats; context cleanup; 30 s/60 s node budgets с меньшим D;
auth=1 invoke, cancelled=0 новых HTTP, malformed structured=не более 1 repair;
timeout между tool execution и вторым ответом без повторного tool; Handoff не
повторяет side effect; отменённый ответ не попадает в сохранённую историю.

## 9. Универсальность и простота архитектуры

Application выбирает роль, не provider URL/model SDK. Новый context также не
содержит provider-specific полей. LiteLLM можно заменить direct режимом либо
совместимым gateway; изменяются AiService/transport/profile/telemetry integration,
а не Product Consultation. Но независимость не абсолютная: возвращаемый тип
ChatOpenAI, withStructuredOutput/bindTools, AIMessage и Responses history связывают
application с LangChain/OpenAI-compatible контрактом. Это явная текущая граница,
а не обещание совместимости любого API. Новый абстрактный agent framework не нужен.

Будущие GigaChat/Qwen: capability profile, transport adapter при необходимости,
schema/tool/history/refusal/usage conformance. Внешние компании и названия моделей
не доказывают совместимость. При несовместимом API достаточно узкого AI adapter;
domain и Commerce не должны узнавать о форме auth или Responses bridge. Реализация
этих провайдеров в этой фазе не начиналась.

Embedding selector независим от chat profile. В AiService добавлен только метод
chat execution; embedding clients, размеры, индексы, retrieval и BM25 не изменены.
Новый HTTP handler применяется только к утверждённым chat deployments gateway.

Docker gateway по-прежнему отдельный pinned service, optional DB имеет отдельные
credentials/volume/network. Это подходит как инфраструктурная часть standalone
AI Support deployment. Сам Nest repository пока содержит ecommerce modules,
Postgres checkpointer и store adapters: законченная физическая выноска сервиса
этим аудитом не подтверждается. Нельзя заявлять готовый независимый microservice
лишь на основании отдельного Docker gateway. Тестовый container с пятью процессами
не является предложенной production topology.

Практичный следующий шаг - единый execution context и repair classification,
затем измерения и live conformance. Распределённые планировщики, универсальный DSL,
второй orchestration framework и глобальный fallback сейчас не нужны.

## 10. Перед live conformance и production

Проверить с отдельным разрешением реальные model IDs/accounts, auth/TLS, serialized
схемы каждой операции, tool-result history, explicit refusal и forced truncation.
Особенно проверить Yandex finish_reason до bridge и OpenAI encrypted reasoning.
Нормальное HTTP 200 не означает успешно выполненную domain schema.

Подключить одобренную application отмену, исправить Workspace/Handoff retry,
измерить latency этапов и выбрать D/R без произвольного SLA. Проверить production
версии Node/Python, proxy/CA requirements, clock skew и отмену реального upstream.
Уточнить договорные правила billing после timeout/disconnect у каждого провайдера.

Для budget mode нужны проверенные тарифы, cached/reasoning/tier/currency правила,
max output constraints, сопоставление usage со счетами, durable log collection,
recovery при DB failure и multi-replica tests при масштабировании. Пока этого нет,
budget - операционная защита, не обещание строгого денежного потолка. Если нужен
строгий cap, отдельно проектировать admission по худшей стоимости и reconciliation;
не добавлять такую подсистему без подтверждённого требования.

Fallback обсуждать по операциям и классам ошибок: максимум одна дополнительная
model attempt в оставшемся D, совместимая история, без tools/graph replay и без
обхода budget/refusal/config errors. Текущие generic candidate routes не являются
готовой production policy. Включение fallback требует отдельного одобрения.

## 11. Точные файлы Phase 4

Все пути ниже относительны к корню checkout.

| Файл | Изменение |
| --- | --- |
| `src/ai/ai.service.ts` | Optional withChatExecution; прежние методы сохранены |
| `src/ai/chat-execution.ts` | Новый изолированный контекст signal/deadline |
| `src/ai/chat-http.ts` | Deadline, объединение сигналов, late-result guard, usageSource |
| `src/ai/chat-http.spec.ts` | Deadline, cleanup, late abort identity |
| `src/ai/chat-execution.spec.ts` | Изоляция, наследование, общий budget времени |
| `src/ai/caller-reliability-boundary.spec.ts` | Доказательства непоправленных caller gaps |
| `src/ai/testing/gateway-fixture.ts` | Общие offline fixtures/control helpers |
| `src/ai/gateway.integration.spec.ts` | Только извлечение общих fixtures; прежние проверки сохранены |
| `src/ai/gateway-reliability.integration.spec.ts` | Failures, deadlines, cancellation, fallback matrix |
| `src/ai/gateway-budget-reliability.integration.spec.ts` | Concurrent budget, restart, DB outage, unknown usage/pricing, kill, fallback spend |
| `src/ai/README.md` | Optional execution API и ограничения |
| `infra/litellm/upstream_http.py` | Raw upstream guard, single send, absolute deadline |
| `infra/litellm/budget_admission.py` | Budget-only bounded auth и свежий SQL перед отправкой |
| `infra/litellm/tests/test_budget_admission.py` | Изолированные auth/HTTP/cancellation contracts |
| `infra/litellm/tests/budget_admission.integration.cjs` | Concurrent outage, recovery, disconnect, deadlines, non-budget modes |
| `infra/litellm/gateway_policy.py` | Client injection, reasoning boundary, deadline, provenance |
| `infra/litellm/config.openai.yaml` | cancel_on_disconnect |
| `infra/litellm/config.yandex.yaml` | cancel_on_disconnect |
| `infra/litellm/compose.yaml` | Read-only mount нового transport |
| `infra/litellm/compose.budgets.yaml` | Конфигурируемый admission timeout только budget mode |
| `infra/litellm/compose.test.reliability.yaml` | Только candidate test processes/ports |
| `infra/litellm/tests/runtime.py` | Failure injection, socket observation, process control, test-only budget profiles |
| `infra/litellm/tests/test_policy.py` | Deadline/override/reasoning/pricing contracts |
| `infra/litellm/tests/test_upstream_http.py` | Исходные bytes, finish_reason, timeout тела |
| `infra/litellm/README.md` | Уточнения исторического Phase 3 отчёта |
| `infra/litellm/RELIABILITY.md` | Этот анализ |

## 12. Воспроизведение и источники

Из корня checkout; fixtures общие, только один Jest process с runInBand.
Upstream URLs закреплены на loopback mock, credentials фиктивные. Docker bridge
не является физическим запретом всего egress. Реальный .env не загружается.

```powershell
docker compose -f infra/litellm/compose.test.yaml -f infra/litellm/compose.test.budgets.yaml -f infra/litellm/compose.test.reliability.yaml up -d --wait --wait-timeout 180
$env:RUN_LITELLM_INTEGRATION='1'
$env:RUN_LITELLM_BUDGET_INTEGRATION='1'
$env:RUN_LITELLM_RELIABILITY='1'
$env:RUN_LITELLM_BUDGET_RELIABILITY='1'
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/ai/gateway.integration.spec.ts src/ai/gateway-reliability.integration.spec.ts src/ai/gateway-budget-reliability.integration.spec.ts
docker compose -f infra/litellm/compose.test.yaml exec -T -e PYTHONPATH=/gateway gateway-contract python -m unittest discover -s /gateway/tests -p 'test_*.py'
node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.build.json
docker compose -f infra/litellm/compose.test.yaml -f infra/litellm/compose.test.budgets.yaml -f infra/litellm/compose.test.reliability.yaml down
Remove-Item Env:RUN_LITELLM_INTEGRATION, Env:RUN_LITELLM_BUDGET_INTEGRATION, Env:RUN_LITELLM_RELIABILITY, Env:RUN_LITELLM_BUDGET_RELIABILITY
```

Budget suite сам временно pause/unpause только `budget-db` этого test project;
process control доступен только в loopback test harness, отсутствует в production
entrypoint. Если suite аварийно прерван, unpause тестовую DB перед повтором.
Порты: 34180 control, 34181/34182 upstream profiles, 34183 budget,
34184/34185 candidate fallback. Ни один production Compose service не запускался.

Первичные источники, сопоставленные с pinned кодом и выполненными тестами:

- [Закреплённый LiteLLM source tree](https://github.com/BerriAI/litellm/tree/385266c14d6a4cb069751fd3525692e0a760ec57): `proxy/common_request_processing.py`, `proxy/spend_tracking/budget_reservation.py`, `llms/custom_httpx/http_handler.py`, `router.py`.
- [HTTPX custom transports](https://www.python-httpx.org/advanced/transports/): публичная AsyncBaseTransport boundary для guard.
- [LiteLLM CustomLogger hooks](https://docs.litellm.ai/docs/observability/custom_callback), [routing](https://docs.litellm.ai/docs/routing), [timeout](https://docs.litellm.ai/docs/proxy/timeout).
- Установленные LangGraph `pregel/retry.cjs`, `pregel/timeout.cjs`, `pregel/runner.cjs`; LangChain `agents/nodes/AgentNode.cjs`; OpenAI JS `internal/constants`.

Rolling docs могут отличаться от pinned runtime. Таблицы выше основаны прежде
всего на коде указанной версии и наблюдении запросов, а рекомендации отмечены отдельно.

## 13. Admission при отказе PostgreSQL: варианты до реализации

Продолжение Phase 4, 14 октября 2026. Здесь сохранено сравнение до реализации;
пользователь затем одобрил вариант A. Актуальная реализация описана в разделе 14.
Условие заказчика: если решение требует проверки БД на каждый вызов либо
существенного усложнения, сначала представить альтернативы и стоимость.
Именно это условие срабатывает для строгого admission независимо от кеша.

Дополнительные факты из закреплённого контейнера:

- `litellm/proxy/proxy_server.py:2407`: `SPEND_DB_FLOOR_CACHE_TTL_SECONDS = 5`.
- `get_current_spend`, строки 2478–2508: strict mode обращается к
  `_authoritative_floor_spend`, однако это не обязательно реальный DB read.
- `_authoritative_floor_spend`, строки 2575–2578: возвращает кешированный
  `spend_db_floor` без SQL; строки 2603–2606 записывают его с TTL выше.
- `_ensure_spend_counter_initialized`, строки 3083–3096: тёплый счётчик
  не требует повторной инициализации из PostgreSQL.
- `litellm/proxy/auth/user_api_key_auth.py:2865–2896`: auth и budget checks
  выполняются до endpoint/pre-call hook. Поэтому только новый deployment hook
  не ограничит ожидание холодного ключа на этапе auth.

Кеш с положительным TTL или heartbeat не доказывает текущую доступность БД:
между последней успешной проверкой и следующим запросом БД может остановиться.
Уменьшение TTL лишь сокращает окно. Отключение кеша фактически возвращает
обращение к БД на каждый вызов и сохраняет необходимость ограничить ожидание.

### A. Свежая проверка перед каждой физической отправкой — рекомендуемый вариант

Первоначально предложено узкое изменение только в `infra/litellm`: budget-only ASGI wrapper
ограничивает фазу admission, включая существующую авторизацию; текущий
`async_pre_call_deployment_hook` перед leaf provider attempt выполняет свежий
read-only SQL через существующий Prisma client/pool. Стандартная авторизация,
расчёт бюджета, retries и provider routing остаются LiteLLM.

Кеш успешной DB-проверки не используется. Timeout/ошибка/missing DB client дают
503 до upstream. Истёкшее admission нельзя возобновить после recovery; требуется
проверка истечения и отмены непосредственно на границе отправки. Ожидание pool,
SQL и auth должно укладываться в общий конфигурируемый admission budget и
оставшийся operation deadline. Это отдельный лимит до model call, не новый
таймаут генерации. Число ожидающих admission должно быть ограничено, без очереди
неограниченного размера и без detached retry tasks.

Стоимость: один дополнительный короткий SQL на каждую физическую попытку;
при R попытках/сек добавочная нагрузка приблизительно R запросов/сек, сверх
существующих auth/accounting операций. Задержка — ожидание pool + один DB
round-trip + выполнение SQL. Production p50/p95, нагрузка и денежная стоимость
не измерены. Новый Redis, отдельный сервис и новая ledger-схема не нужны.
При реализации найден более узкий вариант: публичный FastAPI dependency override
вместо ASGI wrapper, а probe перенесён на HTTP transport boundary. CLI/lifespan
не меняются. Это уточнение варианта A без добавления нового сервиса.

Граница гарантии: DB должна ответить в текущем admission перед отправкой.
Даже свежий SELECT не делает атомарными DB check и внешнюю HTTP-отправку и
не гарантирует будущую запись spend: БД может упасть сразу после проверки.
Read-only probe также не доказывает возможность записи. Budget hard cap
и exactly-once billing этим изменением не обещаются.

### B. Фоновая проверка и короткий срок действия разрешения

Стоимость: примерно P / h DB-запросов/сек для P процессов и периода h секунд;
обычный запрос читает локальное состояние. После истечения срока действительности
или ошибки проверок admission закрывается. Recovery требует новой проверки.

Недостаток: до истечения последнего успешного разрешения новые запросы могут
уйти upstream при уже остановленной БД. Таймеры и event-loop lag тоже должны
учитываться. Вариант не соответствует исходному строгому требованию; допустим
только после явного согласования окна. Исходный падающий тест менять нельзя.

### C. Выключить budget traffic до готовности исправления

Отклонять все budget-mode model requests, оставив обычный gateway mode рабочим.
Нет DB probe на вызов, но доступность budget mode равна нулю. Это временная
операционная блокировка, не исправление функциональности. Не применено.

Для A обязательны тесты: warm/cold/mixed concurrent requests при pause/stop DB;
ограниченное серверное время до 503, а не только клиентский AbortSignal;
ноль upstream до и после recovery для отклонённых запросов; новые запросы после
recovery успешны; отказ между auth и provider boundary; насыщение DB pool;
отмена запроса, отсутствие поздней отправки и утечек admission slots;
обычный gateway без DB; все прежние Phase 4 regression suites без ослабления.

Текущая документация LiteLLM также описывает auth как cache-first и SQL при
cache miss: [Life of a Request](https://docs.litellm.ai/docs/proxy/architecture).
Вывод о пятисекундном окне выше основан на установленном pinned source, а не
на изменяемой документации. Его локальные выдержки сохранены в
`.tmp/phase4-admission-cache-and-extensions.txt` и
`.tmp/phase4-admission-pinned-excerpts.txt`.

## 14. Реализованный budget admission — продолжение Phase 4

Пользователь явно разрешил свежую SQL-проверку каждого вызова после сравнения
вариантов из раздела 13. Изменения только в `infra/litellm`; NestJS, domain,
embeddings и схемы БД в этом продолжении не менялись. Phase 5 не начата.

### Путь запроса и ошибки

1. `SupportGatewayPolicy.__init__` подключает admission только при
   `SUPPORT_REQUIRE_PRICING=true` — это существующий признак budget overlay.
2. `budget_admission.install_budget_admission` регистрирует публичный FastAPI
   `dependency_overrides` для штатного `user_api_key_auth`. Сохраняются его
   Security dependencies, key validation, budget checks и reservation. CLI,
   startup/lifespan и установленный пакет LiteLLM не патчатся. Конфликт с другим
   override отклоняется, а не заменяется молча. Management endpoints не оборачиваются
   в admission timeout. Отсутствующий DB client в budget mode даёт 503.
3. Начало auth фиксирует monotonic deadline: минимум технического admission
   timeout и оставшегося `x-support-deadline-unix-ms`, если он задан.
   Конфиг `SUPPORT_BUDGET_ADMISSION_TIMEOUT_SECONDS`, default 2 s,
   находится в `compose.budgets.yaml` и валидируется при старте.
   Это ограничение ожидания допуска, не выдуманное SLA всей консультации.
4. Auth ждёт БД только в пределах этого времени. После успешного auth таймер
   задачи endpoint снимается; абсолютный admission deadline сохраняется.
5. `CompletionGuardTransport.handle_async_request` вызывает `admit_upstream`
   непосредственно перед `inner.handle_async_request`. Свежий
   `SELECT 1 AS support_admission` использует существующий Prisma client/pool.
   Положительный результат не кешируется. Pool/query wait ограничены остатком
   того же admission deadline. Каждая дополнительная физическая попытка тоже
   делает probe, ограниченный admission timeout и общим operation deadline.
6. Ошибка/timeout DB или отсутствующий runtime context дают 503, истёкший
   operation deadline — 408. Проверяется disconnect до и после SQL; завершённый
   HTTP owner отзывает свой контекст. SQL, вернувший результат после истечения
   или отмены, не разрешает отправку. Внешний operation deadline не продлевается.
7. После допуска генерация использует прежние transport timeouts. Без budget
   mode auth override и SQL probe выключены. Нового retry или fallback нет.

Ошибка probe проходит обычный failure handler LiteLLM. Это существенно:
эксперимент с отменой всей endpoint-задачи по admission timeout оставлял
reservation в памяти и давал 429 после recovery. В итоговой реализации auth
таймер заканчивается до endpoint, а истечение SQL wait превращается в обычную
ошибку; штатный handler освобождает reservation. Конкурентный recovery проверяет
повторный успешный вызов тех же ключей, а не только выдачу нового ключа.
Собственный механизм возврата reservation/биллинга не добавлен.

ContextVar содержит только объект текущего HTTP admission; `finally` закрывает
его и восстанавливает прежний context. Это не кеш здоровья БД, не общий retry
manager и не persisted state. Новые SQL connections/pools на каждый запрос не
создаются. Единственное дополнительное DB действие — один read-only SQL перед
каждой фактической попыткой. Внутренняя очередь нового типа не добавлена;
ожидание уже существующего pool ограничено временем.

### Проверки продолжения

- Исходный `DB unavailability blocks warm and cold keys...` оставлен без
  изменений. После fix: warm/cold HTTP 503, upstream 0, late upstream 0.
- Новый `budget_admission.integration.cjs`: два outage/recovery цикла по восемь
  параллельных warm/cold запросов; HTTP 503 за максимум 2110 и 2092 ms в первом
  успешном полном прогоне (test bound 3500 ms, client safety timeout 6000 ms).
  Холодность ключей обеспечивается рестартом gateway после создания ключей;
  прогревается только выбранный warm key. После каждого recovery: 0 replay,
  новые запросы тех же ключей успешны. Остальные cases: disconnect в cold auth,
  operation deadline короче admission, model response с задержкой 2600 ms,
  оба обычных gateway profile при pause budget DB. Всего 5 passed.
- Python: 30 passed, включая 16 новых isolated contracts. Проверены bounded auth,
  shared deadline, зависший query/pool mock, SQL failure после успешного auth,
  следующий attempt после успешного probe, поздний результат игнорирующего
  cancellation mock, cleanup/isolation, invalid config, missing context/DB,
  сохранение auth 401 и отсутствие DB probe без budget mode.
- 14 обычных Jest suites: 176 passed; TypeScript compilation: exit 0;
  production budget и test Compose configuration: exit 0.
- Полная финальная gateway regression: 112 passed / 3 suites, включая исходный
  неизменённый DB-outage test, fallback accounting, concurrency, restart,
  transport и telemetry. Результат `.tmp/phase4-admission-final-gateway.json`.
  Прогон до исправления давал 111 passed / 1 failed; новая baseline failure
  не скрыта и тест не ослаблен. `git diff --check`: exit 0.

Новые tests и исходные Jest gateway tests используют один общий fixture server:
запускать последовательно, не параллельно. После обычного Phase 4 Jest запуска:

```powershell
$env:RUN_LITELLM_ADMISSION='1'
node --test infra/litellm/tests/budget_admission.integration.cjs
Remove-Item Env:RUN_LITELLM_ADMISSION
docker compose -f infra/litellm/compose.test.yaml exec -T -e PYTHONPATH=/gateway gateway-contract python -m unittest discover -s /gateway/tests -p 'test_*.py'
```

### Границы

- Проверен pinned image и его FastAPI 0.136.3; при обновлении LiteLLM повторить
  auth dependency и transport contracts. Обход wrapper не даёт разрешение:
  отсутствующий admission context блокируется в HTTP transport.
- Свежий read не гарантирует будущую write-доступность или атомарность между SQL
  и внешним HTTP. Уже отправленную генерацию падение БД само по себе не отменяет.
  Асинхронный spend, provider billing после abort и overspend принятого запроса
  остаются прежними ограничениями. Budget hard cap не заявляется.
- `started` deployment event возникает до transport admission: его наличие и
  последующий error event не доказывают отправку. Для outage assertions
  используется mock HTTP recorder.
- Реальные DB outage/recovery тесты используют pause/unpause отдельной PostgreSQL.
  Pool exhaustion и отказ после auth проверены isolated mocks, не production
  load test. Multi-replica, DB partitions и длительная потеря DB не проверены.
  Prisma query engine может завершить уже переданный SQL после восстановления;
  это не разрешает поздний upstream. Здесь не добавлялась новая подсистема SQL
  cancellation или отдельный admission connection pool.
- Технический default 2 s можно настроить для среды. Production percentiles,
  частота ложного отказа под нагрузкой и денежная стоимость дополнительного SQL
  не измерены. Нет утверждения о новом latency SLA.

Изменения этого продолжения: `budget_admission.py`, `upstream_http.py`,
`gateway_policy.py`, `compose.yaml`, `compose.budgets.yaml`, два новых admission
test files, `README.md`, `RELIABILITY.md`. Всего 9 файлов относительно состояния
начала продолжения; общий незакоммиченный набор Phase 4 вырос с 22 до 26 файлов.
