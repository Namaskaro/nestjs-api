> HISTORICAL SNAPSHOT — preserved research/results, not current deployment instructions. Final pre-commit cleanup (2026-10-23) supersedes runtime/status claims below; see [current implementation](PRODUCTION-AI-REVIEW.md).

# Direct Production Fixes — 18 октября 2026

Согласованные исправления выполнены. Commit/push не выполнялись, Phase 5 не начата.
Репозиторий: `Namaskaro/nestjs-api`, ветка `refactor/ai-provider-abstraction`.
HEAD остался `aff28c0ee5912047f524b16db9fd8a262606ecf2`.

Этот отчёт описывает состояние **после исправлений**. `FINAL-DIRECT-REVIEW.md`
сохранён как исторический результат предыдущего review, до этих изменений.

## Разделение diff

В `.tmp/direct-review/` подготовлены два последовательных patch-файла для review:

- `A-direct-provider-simplification.patch`: существовавший до этого задания diff
  относительно HEAD; включает сохранённые экспериментальные материалы LiteLLM.
- `B-application-test-fixes.patch`: только исправления этого задания и этот отчёт;
  применяется поверх A. В `ai.service.ts` группе B принадлежит только ранний parse.

Это файлы для просмотра/восстановления, не коммиты. В текущем checkout изменения
уже присутствуют; применять patches к нему повторно не нужно.

### A. Direct Provider Simplification — сохранённая реализация

В этой задаче код A не менялся. FAST/STANDARD независимо выбирают провайдера и
модель через существующую конфигурацию; `AiService.getChatModel(role)` сохранён.
OpenAI использует Responses, Yandex — Chat Completions. Embeddings выбираются
независимо. LiteLLM runtime, PostgreSQL budgets и custom Python hooks отсутствуют.

Изменённые относительно HEAD файлы A:

- `src/ai/ai.service.ts`
- `src/ai/ai.service.spec.ts`
- `src/ai/chat-http.ts`
- `src/ai/chat-http.spec.ts`
- `src/ai/chat-transport.ts`
- `src/ai/chat-transport.contract.spec.ts`
- `src/ai/llm-usage.ts`
- `src/ai/README.md`
- `infra/litellm/README.md`

Добавленные материалы A:

- `src/ai/chat-provider-config.spec.ts`
- `src/ai/chat-reliability.spec.ts`
- `src/ai/caller-reliability-boundary.spec.ts`
- `src/ai/testing/direct-http.integration.cjs`
- `src/ai/SIMPLIFICATION.md`
- `infra/FINAL-DIRECT-REVIEW.md`
- `infra/litellm/RELIABILITY.md`
- `infra/litellm/MINIMAL-GATEWAY.md`
- `infra/litellm/compose.conformance.yaml`
- `infra/litellm/tests/stock.config.yaml`
- `infra/litellm/tests/stock.integration.cjs`
- `infra/litellm/tests/stock_runtime.py`

Ранее удалённые из runtime/тестов файлы A, сохранённые в резервных копиях:

- `src/ai/gateway-config.spec.ts`
- `src/ai/gateway.integration.spec.ts`
- `infra/litellm/.env.example`
- `infra/litellm/compose.yaml`
- `infra/litellm/compose.budgets.yaml`
- `infra/litellm/compose.test.yaml`
- `infra/litellm/compose.test.budgets.yaml`
- `infra/litellm/config.openai.yaml`
- `infra/litellm/config.yandex.yaml`
- `infra/litellm/gateway_policy.py`
- `infra/litellm/tests/runtime.py`
- `infra/litellm/tests/test_policy.py`

Экспериментальный LiteLLM 1.105.1 не подключён к приложению или обычному Jest CI.
Acceptance-стенд, его результаты и ограничения сохранены без изменений. Docker
acceptance повторно не запускался: это задание не меняет gateway.

### B. Минимальные application/test fixes — это задание

| Файл | Изменение |
| --- | --- |
| `src/ai/ai.service.ts` | `await structuredModel.invoke(prompt)`, затем `ProductSemanticRepresentationSchema.parse(result)` перед возвратом |
| `src/ai/product-semantic-validation.spec.ts` | Новый regression через настоящий Responses SDK с mock HTTP; валидный JSON принимается, `summary: 42` отклоняется до сборки search text, embeddings, SQL index write и Qdrant save |
| `src/product-consultation/application/workspace/product-workspace.test-fixtures.ts` | Mock преобразует тестовый внутренний plan в плоский model DTO и проверяет `ProductWorkspaceModelPlanSchema`; возвращает `{ parsed }` для includeRaw |
| `src/product-consultation/application/workspace/product-workspace-plan.ts` | Четыре адресных preflight-проверки выбрасывают существующий `ProductWorkspaceClarification` |
| `src/product-consultation/application/workspace/product-multi-action.spec.ts` | Исправлен устаревший отрицательный input; добавлены положительный multi-position DETAILS/replay, конкретные вопросы, проверка соседней lane и сохранения технических ошибок |
| `infra/DIRECT-PRODUCTION-FIXES.md` | Этот отчёт |

Из production-кода изменены только `ai.service.ts` и `product-workspace-plan.ts`.
Транспорты, SDK, provider configuration, embedding selection, ProductsService,
индексация, Core/normalizer, Qdrant/Prisma schemas, Orders, Commerce, Handoff и
frontend в этом задании не менялись.

## Границы валидации и исполнения

**Semantic representation.** `withStructuredOutput` не заменяет проверку результата
в application boundary. Regression проходит через `ProductsService.reindexProducts`
с mock-зависимостями: допускается чтение исходного товара, но невалидный semantic
output не доходит до `buildProductSearchText`, `createProductEmbedding`,
`$executeRaw` или `savePoint`. Проверены сам `ZodError`, путь `summary`, тип ошибки и
ровно один model HTTP send. Архитектура индексации не изменена.

**Fixture.** У модели `decision.action`, у внутреннего плана —
`decision.proposal.action`. Mock теперь соблюдает первый контракт; backend по-прежнему
сам определяет `taskTransition`. Production-нормализатор не адаптирован под тесты.

**DETAILS.** Нормализатор уже разбивает `positions(1,2)` на два атомарных DETAILS.
Положительный тест проверяет их порядок, presentations и отсутствие повторного
выполнения при replay. Отрицательный тест теперь использует DETAILS без selection,
сохраняя запрет выполнения всех lanes и неизменность существующих tasks.

**Preflight clarification.** Входной DTO сначала проходит существующий schema parse.
Четыре проверки отражают действующие ограничения Core; сами ограничения не менялись.

| Невалидное действие | Вопрос пользователю |
| --- | --- |
| DETAILS без selection | «О каком товаре рассказать подробнее? Укажите номер в подборке.» |
| DETAILS с searchPatch | «Показать подробности выбранного товара или изменить условия подбора?» |
| COMPARE с одной позицией | «Для сравнения нужны хотя бы два товара. Какие номера сравнить?» |
| REFINE со сменой категории | «Начать новую подборку в другой категории или уточнить условия текущей?» |

Эти уточнения семантически уместны: нужно разрешить выбор товара, конфликт намерений,
недостаток объектов сравнения или выбор между новой и текущей подборкой. DETAILS с
patch не превращается автоматически в REFINE, а REFINE другой категории — в SEARCH.

Проверки выполняются до ветки, откладывающей зависимые действия до результатов
поиска. Для REFINE учитывается состояние, полученное симуляцией предшествующих
действий lane. Все lanes по-прежнему проходят preflight до первого действия.
Регрессии содержат корректную соседнюю lane перед невалидной и требуют ноль search/
details calls. Повторных tool execution или repair/retry механизмов не добавлено.

Нет общего catch для `ZodError`. Сохранён существующий catch только для
`ProductWorkspaceClarification`. Тесты проверяют проброс **того же объекта** Error,
TypeError и ZodError из search validation, неизменность входного workspace и отсутствие
tool calls. Отдельный нераспознанный Core-дефект (`DETAILS` с полным SearchSpec)
остаётся `ZodError` и не превращается в вопрос пользователю.

## Результаты проверок

| Проверка | Результат |
| --- | --- |
| Все 9 suites с общим fixture | **52/52 PASS** |
| Два исходных Support suites, содержавшие 6 падений | **9/9 PASS**, входят в строку выше |
| AI Jest | **9 suites, 175/175 PASS** |
| Direct native HTTP | **11/11 PASS** (10 проверок и родительский test) |
| `tsc -p tsconfig.build.json --noEmit --incremental false` | **PASS** |
| Полный обычный repository Jest | **94 suites: 91 PASS, 3 FAIL; 670 PASS, 26 FAIL** |
| Контроль трёх падающих suites на чистом HEAD | **Те же 26 FAIL**, 10 PASS; имена падений совпали полностью |
| `git diff --check` | **PASS** |

Все вызовы LLM offline: mock HTTP или локальный HTTP server. Живые провайдеры,
платные запросы и реальные операции PostgreSQL/Qdrant не использовались. Полный
набор здесь — `npm test`/обычная Jest-конфигурация; отдельный service-backed e2e не
запускался. Core/Workspace/search/presentation regressions включены в полный запуск.

AI-тесты подтверждают четыре комбинации FAST/STANDARD, независимость embeddings,
structured output, tool calls/result history, encrypted reasoning history, отказ
на incomplete/refusal, abort/timeout и существующие ограничения HTTP retries.
Live provider conformance, доступность deployment-моделей и качество реальных
ответов этим offline-запуском не подтверждаются.

### Оставшиеся baseline failures — не исправлялись

1. `src/product-consultation/application/workspace/product-workspace.spec.ts`:
   **24 failures**. У этого suite собственный harness (`decide` около строки 312),
   не общий fixture. Он также возвращает внутренний plan с `decision.proposal`
   вместо model DTO. Planner отвергает ответ до основных assertions. Нужен отдельный
   точечный перенос mock на модельный контракт; это не дефект Direct transport.
2. `src/product-consultation/application/workspace/product-workspace-model-plan-tolerance.spec.ts:428`:
   **1 failure**. Для «бег» тест ждёт `training`, но действующий профиль выделяет
   `running`, который и возвращает нормализатор. Доменные сценарии менять не нужно.
3. `src/product-consultation/application/context/tests/product-consultation-context-usage.spec.ts:235`:
   **1 failure**. Ожидаемый список scenarios не содержит существующий `running`.
   Его наличие отдельно подтверждает `core/profiles/usage-scenarios/tests/usage-scenarios.spec.ts`.

Все 26 независимо воспроизведены на исходниках из `git archive HEAD`, без отката
рабочего checkout. Полный тестовый gate пока красный; новые исправления его не
ухудшают. Эти оставшиеся тесты и доменные профили не менялись ради зелёного результата.

## Сохранность и воспроизведение

До редактирования проверены все SHA-256 в резервных копиях:

- `../direct-backup-20261017-061945`: **25/25 файлов**.
- `../phase4-backup-20261015-121826`: **112/112 файлов**.

Они сохранены. Дополнительно `.tmp/direct-production-before/` содержит SHA-256
manifest состояния перед этим заданием (542 файла) и оригиналы четырёх изменённых
существующих файлов. Сверка исключает изменения прочих исходников/материалов.

Локальные результаты: `.tmp/direct-fixes-shared-fixture.json`,
`.tmp/direct-fixes-ai.json`, `.tmp/direct-fixes-http.log`,
`.tmp/direct-fixes-tsc.log`, `.tmp/direct-fixes-full.json`,
`.tmp/direct-fixes-head-baseline.json`. Файлы `.tmp` игнорируются Git.

Команды из корня checkout:

```powershell
$paths = @(rg -l 'product-workspace.test-fixtures' src -g '*.spec.ts')
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath @paths
$ai = @(rg --files src/ai | Where-Object { $_ -match '\.spec\.ts$' })
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath @ai
node --test src/ai/testing/direct-http.integration.cjs
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false
node node_modules/jest/bin/jest.js --runInBand
```

Согласованные исправления готовы к review. Публикация остаётся за решением пользователя;
общую production-готовность нельзя приравнивать к успешным целевым offline-проверкам.
