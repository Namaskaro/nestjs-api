# Product multi-intent: результат аудита и реализации

Работа выполнена в отдельном checkout `E:\Codex\2026-09-11\ecommerce-backend\product-multi-intent` на ветке `refactor/product-consultation-v3-multi-intent`. Исходный `refactor-guest` с незакоммиченными изменениями сохранён. Commit, push и merge не выполнялись.

## Результат

После refactor были потеряны decomposition внутри Product domain, несколько независимых состояний, параллельные поиски, несколько групп ответа и адресация продолжений между подборками. Остаточные `activeNeedIds/searchNeedIds` в StateGraph этого не обеспечивали.

Реализован небольшой ProductWorkspace. В каждой задаче остаётся ровно один существующий ConsultationApplicationRecord. Один ProductAgent получает изолированный workerQuery и одним вызовом модели формирует пакет адресованных решений. Затем весь пакет проходит проверку до исполнения, независимые задачи исполняются параллельно, результаты собираются в порядке запроса. У каждого результата есть taskId, query, status и при необходимости task-local presentation.

Сохранены SearchSpec, WriteOwner, revision/generation, ResultsState, ProductFacts, Semantic Enrichment и серверное владение идентификаторами. SEARCH/REFINE/DETAILS/COMPARE обходятся без второго LLM response call. RECOMMEND использует существующий synthesis. PostgreSQL/Qdrant boundaries и retrieval-only searchTags не менялись.

Восстановлены создание, добавление, уточнение, показ, удаление и завершение задач; details/compare/recommend/feedback адресуются одной задаче. Неоднозначные ссылки уточняются. После сравнения хранится порядок обсуждавшихся позиций; явное «из найденных» использует полную выдачу. Ответ на уточнение сохраняет исходное действие; старый вопрос не перехватывает продолжение другой задачи. Успешная группа сохраняется при ошибке соседнего поиска или synthesis. Лимит пять задач остаётся явным: старые подборки больше не вытесняются автоматически.

Небольшое необходимое уточнение контракта Core: SEARCH + continue разрешён до первого поиска в той же задаче, чтобы не терять Memory после CLARIFY. Проверка перенесена в state-aware boundary; после состоявшегося поиска этот вариант запрещён. Новый независимый поиск по-прежнему начинает пустую задачу с start_new.

ProductNeed/NeedIndex не возвращены в рабочий граф. Исторические helpers и их state вынесены из его контракта; они остаются для старых tests/debug. Текущий Evaluation target переведён на Workspace/SearchSpec; frozen target использует существующий SearchSpec adapter над captured fixture и не обращается к live semantic reader.

## Проверки

- Добавлены 23 проверки Product workspace и 2 проверки Product worker. Они покрывают MI-01…MI-08, порядок ссылок, завершение/удаление, частичные ошибки, clarification ownership, лимит задач и Evaluation Harness.
- `npx jest src/product-consultation src/support-agent --runInBand`: **61 suite, 403 tests — PASS**.
- `npm run build`: **PASS**.
- `git diff --check`: **PASS**.
- Дополнительный `tsc --noEmit --incremental false`: остаются **8 исходных TS2345 в Order tests**. Те же восемь подтверждены на чистом snapshot `5fa90ca`; Order implementation не изменён. В изменённых Product/Support файлах ошибок типов нет.
- На чистом `5fa90ca` отдельно воспроизведены 20 исходных падений Product tests и 13 падений старого Support routing fixture. Исправлены state-aware pre-search invariant, отсутствующие поля fixtures (`factAttributeIds`, `semanticEvidence`), устаревшие ожидания для уже существующего usage profile v3 и fixture маршрутизации. Production Semantic Enrichment/profile ради тестов не откатывались.
- LLM boundary замокан. Платные/live Yandex вызовы, реальные поиски, DB/Qdrant/Redis mutations не выполнялись. Качество языковой decomposition реальной модели и браузерный frontend этим прогоном не измерены.

## Предложения для обсуждения

1. **Переключатели подборок в UI.** «Nike», «Платья», «Костюм» с taskId в структурированных действиях. Это уменьшит неоднозначность коротких ответов и позволит направлять их детерминированно. Backend уже возвращает taskId; UI и входной контракт здесь не изменялись.
2. **Повтор только неудачной группы.** Отдельное действие retry с новым серверным requestId, сохранением Memory и прежних успешных групп. Это полезное небольшое продолжение; отдельная retry-семантика пока не реализована.
3. **Один контекст сравнения для одной задачи.** Уже реализовано. Межзадачное сравнение стоит добавлять только отдельной явной capability, если оно действительно нужно продукту; сейчас запрос на него уточняется.
4. **Подбор комплекта — отдельный будущий сценарий.** «Сначала обувь, затем костюм к выбранной обуви» содержит зависимость. Если появится такой requirement, достаточно двух явных этапов; универсальный граф зависимостей сейчас не нужен.
5. **Несколько серверных реплик.** Потребуется общий lock/lease или CAS разговора на границе сохранения checkpoint. Сейчас защита SupportAgent от одновременных запусков одного thread действует внутри процесса. Параллельные дочерние задачи в одном запуске уже изолированы.

Выбор простых domain workflows и параллельного выполнения независимых частей согласуется с принципами [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents). Это обоснование направления, а не доказательство качества конкретной модели; последнее требует отдельного согласованного live evaluation.

## Оставшиеся границы

- Handoff по-прежнему теряет исходную причину: worker задаёт CUSTOMER_REQUEST + EXPLICIT_USER_REQUEST. Большой Handoff refactor оставлен отдельной задачей.
- Распознавание явно названной подборки использует консервативную проверку цитаты/лексического совпадения. Неподдержанный синоним или несколько подходящих подборок приведут к уточнению.
- Лимит replay ledger — 128 request IDs, как у текущего ConsultationApplicationRecord. Долговременный журнал запросов не добавлен.
- Завершённые/удалённые задачи убираются из workspace; undo/archive не добавлены. COMPLETE presentation старого session engine не восстанавливалась.
- Checkpoint сохраняется после workspace node. Перезапуск процесса до этого checkpoint может повторить read-only search; exactly-once внешних действий или распределённая транзакция не заявляются.
- В Order worker test fixture добавлено только пустое поле productWorkspace для общего SupportAgentState; Order runtime не изменён.

## Исходная migration map

Source: `5fa90cab06cad9529697765f947b6f24dcb3022c`, branch `refactor/product-consultation-v3-multi-intent`.
Historical reference: `aee506eda25c4ef74bffff879d8ff8c2e32e8021`.

## Capability migration map (before implementation)

| Historical capability | v3 baseline | Decision / owner |
|---|---|---|
| Decompose query; normalize each product intent | Single decision / proposal | Replace with one Product-domain batch decision; each entry keeps the existing proposal |
| Multiple searches, independent constraints and preferences | Single record | One existing ConsultationApplicationRecord per workspace task |
| Parallel search | Lost in active graph | Independent task execution with Promise.all; reject duplicate task writes before execution |
| Create / refine / reuse | Core supports one task | Workspace chooses owner; SearchSpec and WriteOwner retain execution semantics |
| Remove task | Legacy planner only | Explicit removal from workspace, clear its reference context |
| Add task without losing old ones | start_new replaces the only task | Append independent record; never silently evict tasks |
| Result groups / order | Worker emits at most one group | Ordered task outcomes; per-group task identity and status |
| Display / reference / comparison order | Core resolves positions within one result | Workspace stores task/result/position references, never duplicate products; current focus differs from full results |
| Ordinals, details, compare, recommend, feedback | Single-task capabilities work | Resolve task first, then delegate selection to existing Core; ambiguous groups clarify |
| Clarification ownership / switching | One implicit owner | Explicit task target or unique current context; keep task-local questions |
| Partial result semantics | WriteOwner marks one failed search | Successful groups survive a sibling search failure; never substitute old results as new |
| Completion | Core COMPLETE has no workspace membership | Close the explicitly addressed task; unaddressed whole-session completion must be explicit |
| Handoff | Worker hardcodes CUSTOMER_REQUEST / EXPLICIT_USER_REQUEST | Keep existing behavior for this vertical; separate known regression |
| Idempotency | Record ledger; runtime node cannot present duplicate execution | Workspace request ledger also protects task creation/removal; skip repeated batch before model call |
| Concurrency | WriteOwner revision / generation CAS; SupportAgent per-thread in-process lock | Retain existing task CAS; one parent writer joins independent children; no shared record writes |
| SupportAgent integration | One product worker; isolated workerQuery already fixed | Preserve one worker; persist workspace; router sees bounded task summaries |
| Legacy ProductNeed / NeedIndex | Old nodes/types still present but not connected | Remove from active graph state; retain historical utilities only where still used by existing debug/tests |
| Evaluation | Current target still sends legacy context and instruments searchProducts | Update current target to workspace + SearchSpec + search; offline Core targets remain unchanged |

## Target

One domain decision call returns bounded, addressed task operations. A small workspace owns task identities, ordering, current references and request replay protection. Each task owns exactly one existing authoritative record. No new Core, SearchSpec, Memory, ResultsState or recommendation engine.

Validate the complete batch before execution. New tasks start with empty records. Existing tasks use continue, never start_new; replacing a task means explicitly removing it and creating another. Independent searches run concurrently, outputs keep input order. Relative references only resolve within a unique current context; explicit task references require a quotation from the user message. Product IDs and task IDs are backend-owned.

The existing SupportAgent service serializes runs per thread within one process. This change does not claim distributed concurrency safety across replicas: that would require a shared conversation lease / durable CAS at the checkpoint boundary and is a separate deployment concern.

## Deliberate scope

Do not revive global flat numbering across unrelated groups, silent eviction, old preference/filter models, or the old tool-loop planner. Preserve ProductFacts, PostgreSQL eligibility, Semantic Enrichment, retrieval-only searchTags, and deterministic SEARCH/REFINE/DETAILS/COMPARE. RECOMMEND alone may synthesize a response.

Potential follow-ups: frontend task chips with explicit task IDs; retry only failed groups under a new server request ID; explicit cross-task comparison as a separate capability only if product requirements demand it. No generic workflow framework is needed.

## Изменённые файлы

Основная реализация — workspace, два graph nodes, task executor, Product worker и routing context. Изменения импортов legacy state механические; отдельная группа изменений обновляет тестовые fixtures.

- `PRODUCT_MULTI_INTENT.md`
- `src/product-consultation/adapters/llm/tests/langchain-product-consultant-model.adapter.spec.ts`
- `src/product-consultation/application/agent/agreagte-answer.schema.ts`
- `src/product-consultation/application/agent/legacy-product-agent.state.ts`
- `src/product-consultation/application/agent/nodes/consult-products.node.ts`
- `src/product-consultation/application/agent/nodes/decide-product.node.ts`
- `src/product-consultation/application/agent/nodes/execute-product-decision.node.ts`
- `src/product-consultation/application/agent/nodes/execute-product-workspace.node.ts`
- `src/product-consultation/application/agent/nodes/plan-product.node.ts`
- `src/product-consultation/application/agent/nodes/search-products.node.ts`
- `src/product-consultation/application/agent/nodes/tests/execute-product-decision-semantic-enrichment.spec.ts`
- `src/product-consultation/application/agent/product-agent.state.ts`
- `src/product-consultation/application/agent/product.agent.ts`
- `src/product-consultation/application/consultant/tests/product-consultant-decision.spec.ts`
- `src/product-consultation/application/consultant/tests/product-consultant-loop.spec.ts`
- `src/product-consultation/application/consultation-agent/consultation.agent.ts`
- `src/product-consultation/application/consultation-agent/prompts/product-consultant.prompt.ts`
- `src/product-consultation/application/planner/product-plan.ts`
- `src/product-consultation/application/turns/compare.turn.ts`
- `src/product-consultation/application/turns/complete-consultation.turn.ts`
- `src/product-consultation/application/turns/consultation-runtime.ts`
- `src/product-consultation/application/turns/consultation.turn.ts`
- `src/product-consultation/application/turns/details.turn.ts`
- `src/product-consultation/application/turns/feedback.turn.ts`
- `src/product-consultation/application/turns/handoff.turn.ts`
- `src/product-consultation/application/turns/product-turn.context.ts`
- `src/product-consultation/application/turns/product-turn.ts`
- `src/product-consultation/application/turns/search-show.turn.ts`
- `src/product-consultation/application/workspace/product-workspace-plan.ts`
- `src/product-consultation/application/workspace/product-workspace.prompt.ts`
- `src/product-consultation/application/workspace/product-workspace.spec.ts`
- `src/product-consultation/application/workspace/product-workspace.ts`
- `src/product-consultation/core/profiles/usage-scenarios/tests/usage-scenarios.spec.ts`
- `src/product-consultation/core/turn/consultation-turn-boundary.ts`
- `src/product-consultation/core/turn/consultation-turn-proposal.schema.ts`
- `src/product-consultation/evaluation/targets/current-product-consultation.target.ts`
- `src/product-consultation/evaluation/targets/frozen-current-product-consultation.target.ts`
- `src/product-consultation/evaluation/targets/tests/offline-product-consultant-loop-regression.target.spec.ts`
- `src/product-consultation/evaluation/targets/tests/offline-product-consultant-loop.target.spec.ts`
- `src/support-agent/graph/nodes/aggregate-final-answer.node.ts`
- `src/support-agent/graph/nodes/request-router.node.ts`
- `src/support-agent/graph/routers/after-pre-intent.route.spec.ts`
- `src/support-agent/graph/routers/after-pre-intent.route.ts`
- `src/support-agent/graph/routers/tests/dispatch-workers.spec.ts`
- `src/support-agent/graph/support-agent.state.ts`
- `src/support-agent/graph/workers/product-agent.worker.ts`
- `src/support-agent/graph/workers/tests/order-agent.worker.spec.ts`
- `src/support-agent/graph/workers/tests/product-agent.worker.spec.ts`
