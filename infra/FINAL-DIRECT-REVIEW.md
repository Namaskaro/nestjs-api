> HISTORICAL SNAPSHOT — preserved research/results, not current deployment instructions. Final pre-commit cleanup (2026-10-23) supersedes runtime/status claims below; see [current implementation](PRODUCTION-AI-REVIEW.md).

# Direct: review перед коммитом — 18 октября 2026

**Direct прошёл свои регрессии; готовность всего приложения к production пока не подтверждена.**
Application-код и существующие тесты не изменены. Commit/push не выполнялись.
Проверен `Namaskaro/nestjs-api`, `refactor/ai-provider-abstraction`, HEAD
`aff28c0ee5912047f524b16db9fd8a262606ecf2`.

## Structured output: все 9 вызовов

В проверенных конфигурациях GPT-6/Yandex URI отсутствие `method` означает
`jsonSchema`, а не function calling. Версии: `@langchain/openai` 1.5.6,
`@langchain/core` 1.2.8, OpenAI SDK 6.46.0, LangGraph 1.4.9.

| Место | Метод | Фактическая проверка перед использованием |
| --- | --- | --- |
| `src/support-agent/graph/nodes/request-router.node.ts:127` | default → jsonSchema, includeRaw | `RequestRouterModelSchema.parse` на строке 183, затем `RequestRouterSchema.parse`; невалидный ответ не определяет маршрутизацию |
| `src/support-agent/agents/handoff-agent/nodes/prepare-handoff.node.ts:18` | default → jsonSchema | Сам узел не проверяет результат. **LangGraph HandoffState проверяет update** до checkpoint/следующего узла; дополнительно `createHandoffNode` использует `HandoffSchema.parse` |
| `src/ai/ai.service.ts:373` | default → jsonSchema | **Нет локального parse перед возвратом**; поздняя проверка ProductQdrantPayload недостаточна, см. ниже |
| `src/product-consultation/application/consultation-agent/comparison-synthesis.ts:20` | default → jsonSchema, includeRaw | `ComparisonSynthesisOutputSchema.safeParse`, затем проверка позиции товара; иначе null |
| `src/product-consultation/application/agent/nodes/plan-product.node.ts:31` | default → jsonSchema, includeRaw | `ProductPlannerResultSchema.safeParse`, иначе существующий путь `applyProductPlan(..., null, ...)`; legacy-функция не подключена: найдено только её объявление |
| `consultation.agent.ts:184` | functionCalling | Zod parser SDK, затем `ProductConsultantDecisionSchema.parse` |
| `consultation.agent.ts:193` | functionCalling, includeRaw | Извлечение parsed/raw args; нормализатор проверяет `ProductWorkspaceModelPlanSchema`, затем `ProductWorkspacePlanSchema`. Raw fallback не обходит валидацию |
| `consultation.agent.ts:203` | functionCalling, includeRaw | `finalizeConsultation` выполняет `ConsultationCompletionOutputSchema.parse`, проверки ссылок/ревизий/доказательств; иначе безопасный fallback |
| `src/product-consultation/application/recommendation/product-recommendation-synthesizer.ts:176` | jsonMode | Zod content parser SDK, затем явный `ProductRecommendationSynthesisSchema.parse` |

Три сокращённых пути `consultation.agent.ts` находятся в
`src/product-consultation/application/consultation-agent/`.

### Почему одного withStructuredOutput недостаточно

Для Responses `jsonSchema` LangChain создаёт `text.format` заново и теряет
неперечисляемый `$parseRaw` Zod parser (`chat_models/responses.cjs:58`).
OpenAI `ResponsesParser.js:94` тогда выполняет только `JSON.parse`.
LangChain переносит результат в `additional_kwargs.parsed`, а
`chat_models/base.cjs:581` возвращает его, минуя запасной Zod content parser.
`includeRaw` это не исправляет. Это подтверждённое поведение установленных пакетов,
а не предположение по TypeScript-типу.

`jsonMode` и `functionCalling` используют локальные Zod parsers. Yandex Chat
Completions сохраняет parser response format. Дополнительные application parse
полезны как явная граница и уже стоят почти во всех перечисленных местах.
Проверка структуры не доказывает фактическую истинность текста модели.

### Обязательное минимальное исправление перед production indexing

В `AiService.createProductSemanticRepresentation` вместо прямого возврата invoke:

```ts
const result = await structuredModel.invoke(prompt);
return ProductSemanticRepresentationSchema.parse(result);
```

Offline probe настоящего AiService/SDK при `STANDARD=OpenAI` (Responses) вернул
`summary: 42` как успешный результат;
`buildProductSearchText` использовал его как `Семантическое описание: 42`.
В `ProductsService.syncProductSearchIndex` порядок: получение результата (750),
построение текста (753), embeddings (758), запись PostgreSQL (762), и только затем
`ProductQdrantPayloadSchema.parse` (772). При таком ответе возможна запись вектора
до отказа публикации Qdrant payload. Реальные embeddings/БД в probe не вызывались:
использование невалидного результата подтверждено динамически, порядок побочных
действий — исходным кодом. Переписывать indexing или выбирать другой embedding
provider для исправления не требуется.

Для handoff такой утечки нет: probe с `issue: 42` подтвердил отказ StateSchema,
`preparedContext`/`preparationStatus` остались null в MemorySaver, create-узел не
выполнился. Явный `HandoffContextSchema.parse(await chain.invoke(...))` полезен
для локальной ошибки на месте, но **не является обнаруженным production blocker**.
Не нужен общий validation wrapper, новый SDK-слой или смена всех методов.

## Шесть известных Workspace failures

Одна точная причина: общий `product-workspace.test-fixtures.ts:276–313` отдаёт
`ProductWorkspacePlan` с `decision.proposal.action` вместо модельного
`ProductWorkspaceModelPlan` с `decision.action`. `decideWorkspace` получает
ошибки `decision.action: invalid_value` и `decision.proposal: unrecognized_keys`,
повторяет тот же mock второй раз и выбрасывает общий `ProductWorkspacePlanner` error.

| Падающий сценарий | Где останавливается |
| --- | --- |
| preIntent → delivery detour | Первый SEARCH кроссовок, до detour |
| zero results + пропущенный delivery intent | Начальный SEARCH зелёных Nike, до проверки recovery |
| comparison → delivery → follow-up | Начальный SEARCH, до сравнения/checkpoint assertions |
| три task lanes + CustomerHelp | Первый план SEARCH кроссовок/платья/шорт |
| обувь для работы в доставке | Начальный SEARCH, до проверки отсутствия CustomerHelp |
| ordered presentations в product-agent worker | Первый `h.run()`, до COMPARE/DETAILS |

Минимальный test-only fix: на выходе mock переводить fixture в плоский модельный
DTO и возвращать `{ parsed: modelPlan }`, проверив `ProductWorkspaceModelPlanSchema`.
Не добавлять поддержку внутреннего `proposal` в production-нормализатор.
В `.tmp/final-direct-fixture-control.cjs` это проверено через отдельный Jest mapper:
**те же исходные assertions и production-код, 9/9 passed вместо 3 passed / 6 failed**.
Исправление в исходный fixture не применялось.

### Почему это ещё не означает зелёный общий CI

Fixture импортируют 9 suites. Расширение проверки обосновано общей зависимостью:
в текущем checkout **5 passed / 42 failed**, все 42 — тот же DTO mismatch.
После только контрольной коррекции mock — **42 passed / 5 failed**:

- Один тест считает `DETAILS positions(1,2)` невалидным. Нынешний нормализатор
  намеренно разворачивает его в два валидных DETAILS (`product-workspace-model-plan.ts:796`).
  Для сохранения проверки «ни одна lane не исполняется при невалидном плане» нужно
  заменить вход на действительно невалидный DETAILS, например без selection,
  оставив проверки state/search/tools без ослабления; многопозиционный DETAILS
  проверять как поддерживаемый позитивный сценарий.
- Четыре настоящих случая обработки ошибок: DETAILS без selection; DETAILS с
  searchPatch; COMPARE с одной позицией; REFINE со сменой SHOES → CLOTHES.
  `preflightLane`/Core выбрасывают ZodError/ошибку доменного правила,
  а `execute-product-workspace.node.ts:227` обрабатывает только
  `ProductWorkspaceClarification`, поэтому вместо уточнения завершается с ошибкой.
  Минимальное предложение: переводить **ошибки валидности действий на границе
  чистого preflight** в существующий `ProductWorkspaceClarification`, сохраняя
  предварительную проверку всех lanes. Не подавлять сетевые/инфраструктурные ошибки
  и не повторять уже выполненные действия. Изменение требует согласования и не внесено.

Эти случаи не являются регрессиями Direct: application/test-файлы совпадают с HEAD,
а тесты используют mock модели. Они были скрыты ранней ошибкой DTO.

## Готовность и проверки

- **Direct infrastructure готова к рассмотрению для коммита:** публичный
  `getChatModel(FAST|STANDARD)` сохранён; новые runtime-слои не добавлены.
  Все 23 файла `src/ai` сохранены побайтно относительно проверенной Direct-копии.
- Повторно прошли **173 AI Jest**, **11 native HTTP**, TypeScript
  `tsc -p tsconfig.build.json --noEmit --incremental false`.
  В AI suites проверены четыре комбинации FAST/STANDARD, отдельный выбор embeddings,
  tool/result history и encrypted reasoning при продолжении на том же провайдере.
  Полный `npm test` не запускался; результаты относятся к указанным наборам.
- **Production release пока не одобрен:** нужен ранний semantic parse, корректная
  обработка четырёх preflight ошибок и соответствующие регрессии. Для зелёного CI
  нужны также исправления test fixture и устаревшего отрицательного входа.
  Явный handoff parse — небольшое необязательное улучшение.
- Live conformance и прежние замечания о nested cancellation / application retries
  остаются ограничениями; это review не объявляет их исправленными и не начинает Phase 5.
  Оплачиваемых LLM/embedding запросов, DB/Qdrant операций не было.

## LiteLLM и сохранность

Стенд `infra/litellm/compose.conformance.yaml`, `tests/stock*` и отчёт
`MINIMAL-GATEWAY.md` сохранены как эксперимент. В этом review стенд не запускался.
Обычный Jest (`rootDir: src`, `*.spec.ts`), npm scripts, root Compose и Nest assets
его не подключают. `jest --listTests` и `tsc --listFilesOnly` дали **0 LiteLLM файлов**.
В checkout нет `.github/workflows`; внешние организационные CI-настройки не проверялись.
Ни hooks, ни LiteLLM DB, ни gateway runtime не восстановлены.

Архивы Direct `../direct-backup-20261017-061945` и Phase 4
`../phase4-backup-20261015-121826` сохранены. Контрольные probes/логи лежат только в
игнорируемом `.tmp/final-direct-*`; обычные тесты и исходники ими не заменены.
Добавлен только этот отчёт; все перечисленные исправления остаются предложениями.
