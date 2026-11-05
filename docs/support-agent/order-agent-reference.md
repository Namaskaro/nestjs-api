# Order Agent — технический справочник

Этот справочник дополняет [пошаговое руководство](order-agent-guide.md). Он описывает рабочее дерево ветки `refactor/product-consultation-v3-multi-intent` с HEAD `b66cf2d0f77263ed6f33c034e1674e65237b82c5`, включая локальные изменения. В этом срезе исполняемые узлы находятся в `order-agent.worker.ts`. Их подключение определяется конструктором `SupportAgentGraph`. [Подключение worker](../../src/support-agent/graph/support-agent.graph.ts#L129)

Учебные значения в разделах иллюстрируют отдельные ветки. Они не представляют записи реальных покупателей или результат запуска приложения. Примеры одного сквозного сценария собраны в руководстве.

- [Вход и маршрутизация](#вход-в-граф-и-подключение-order-agent). Кто запускает граф, какой запрос получает worker, что сохраняется в State.
- [Исполнение узлов](#исполнение-операций-в-order-agent). Как читается заказ, строятся варианты, обрабатывается подтверждение и формируется ответ.
- [Данные и операции магазина](#данные-заказа-и-операции-магазина). Как сервисы и адаптер читают запись, проверяют условия и сохраняют отмену, обращение или возврат.
- [Ошибки и границы](#ошибки-и-границы-реализации). Где запрос останавливается и какие исходы нельзя вывести из ответа чата.

## Вход в граф и подключение Order Agent

Текстовый запрос к заказам приходит в `ChatGateway.sendMessage` через Socket.IO. `SupportAgentController` зарегистрирован в Nest, но не объявляет HTTP-обработчиков. HTTP-контроллер заказов обслуживает отдельный API и не запускает этот граф. [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L265), [support-agent.controller.ts](../../src/support-agent/support-agent.controller.ts#L4), [orders.controller.ts](../../src/modules/orders/orders.controller.ts#L20)

| Звено | Что делает |
| --- | --- |
| `ChatModule` | Регистрирует `ChatGateway` и `ChatService`. Импортирует `SupportAgentModule` для вызова `SupportAgentService`. [chat.module.ts](../../src/modules/chat/chat.module.ts#L23) |
| `SupportAgentModule` | Регистрирует `SupportAgentGraph` и `SupportAgentService`. Импортирует `AiModule` для маршрутизатора, `OrdersModule` для работы с заказами, `PrismaModule` для проверки чата. Товарная консультация и база знаний подключены для соседних веток. [support-agent.module.ts](../../src/support-agent/support-agent.module.ts#L19) |
| `OrdersModule` | Экспортирует `OrdersService`, `OrderCancellationCaseService` и `RefundService`. `SupportAgentGraph` передаёт первый сервис фабрике `createOrderAgentWorker`, а все три фабрике `createConfirmOrderCancellationNode`. `orderAgent` и `confirmOrderCancellation` являются узлами общего графа. [orders.module.ts](../../src/modules/orders/orders.module.ts#L21), [support-agent.graph.ts](../../src/support-agent/graph/support-agent.graph.ts#L91) |

Условный пример отправки события `chat:send_message`:

```json
{
  "chatId": "ec414811-9680-463a-b88e-cd013ec96ab5",
  "content": "Какой статус заказа №10482?"
}
```

1. `WsJwtGuard` берёт `accessToken` из cookies рукопожатия, проверяет его и записывает `sub` в `socket.data.user.id`. `SendMessageDto` объявляет UUID для `chatId` и строку длиной от одного символа для `content`. `userId` для графа берётся из сокета и проверяется `SupportAgentContextSchema`. [ws-jwt.guard.ts](../../src/modules/auth/guards/ws-jwt.guard.ts#L15), [send-message.dto.ts](../../src/modules/chat/dto/send-message.dto.ts#L3), [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L962)
2. Gateway проверяет доступ к чату. `createParticipantMessage` блокирует строку `Chat` через `FOR UPDATE`, проверяет актуальный режим и участника, сохраняет сообщение и обновляет `Chat.lastMessageAt`. Роль `USER` или `OPERATOR` определяет сервер. Gateway публикует запись как `chat:new_message` и возвращает её в ACK. ACK подтверждает сохранение реплики, а ответ по заказу приходит отдельным событием. [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L276), [chat.service.ts](../../src/modules/chat/chat.service.ts#L257)
3. Граф запускается, если транзакция вернула `shouldRunAssistant: true`. Это означает, что отправитель владеет чатом и режим чата равен `BOT`. В граф передают сохранённые текст и ID сообщения, `chatId` как `threadId` и контекст `{ userId }`. Gateway отдельно держит полученный при записи `handoffVersion` до публикации ответа. [chat.service.ts](../../src/modules/chat/chat.service.ts#L352), [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L303)
4. `SupportAgentService.run` использует блокировку по `threadId` на время вызова. Перед графом сервис ещё раз проверяет владельца и режим существующего чата. Он сверяет последнее обращение вида `HANDOFF` с checkpoint. Обращения об отмене заказа в этой сверке не участвуют. Блокировки Gateway и сервиса основаны на `Set` в памяти текущего процесса. [support-agent.service.ts](../../src/support-agent/support-agent.service.ts#L98), [support-agent.service.ts](../../src/support-agent/support-agent.service.ts#L210), [support-agent.service.ts](../../src/support-agent/support-agent.service.ts#L313), [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L909)

### Выбор узла

`SupportAgentGraph` собирает `StateGraph(SupportAgentState, SupportAgentContextSchema)`. `compile` подключает `PostgresSaver` со схемой `langgraph`. `onModuleInit` вызывает `setup()`, `onModuleDestroy` закрывает saver. Отдельные настройки попыток и таймаута переданы узлу `requestRouterNode`: `maxAttempts: 1` и 30 секунд. У order-узлов эта политика явно не установлена. [support-agent.graph.ts](../../src/support-agent/graph/support-agent.graph.ts#L99), [support-agent.graph.ts](../../src/support-agent/graph/support-agent.graph.ts#L143), [support-agent-execution.config.ts](../../src/support-agent/config/support-agent-execution.config.ts#L1)

1. `START → preIntentNode`. Узел сообщает статус `THINKING`, сбрасывает результат прошлого запуска и использует нормализованный текст для первичной проверки. Приветствие или просьба о помощи может вести в меню тем, спам и некоторые запросы вне магазина — в отказ или уточнение. Остальной текст идёт к маршрутизатору, за исключением некоторых продолжений активной товарной консультации. Подсказки вроде «заказ», «возврат» и «обмен» исключают этот прямой переход к `productAgent`. [pre-intent.node.ts](../../src/support-agent/graph/nodes/pre-intent.node.ts#L57), [after-pre-intent.route.ts](../../src/support-agent/graph/routers/after-pre-intent.route.ts#L49)
2. `createRequestRouterNode(aiService)` сначала проверяет `inferExplicitOrderAssistance(state.query)`. Правило ищет явную просьбу оформить возврат товара, обмен или претензию. Например, «Хочу оформить возврат товара из заказа №10482» даёт `RETURN_REQUEST`, `orderId: null`, `orderNumber: "10482"`. Номер берётся регулярным выражением из текущего текста. Вопрос «Как вернуть товар?», прямая просьба подключить оператора и просьба вернуть только деньги не дают результата этого правила. При совпадении node записывает решение `execute` с одним `orderAgent` и не вызывает модель. **В текущем коде worker ещё не исполняет `RETURN_REQUEST`, `EXCHANGE_REQUEST`, `CLAIM_REQUEST`: эти ветки заканчиваются ошибкой `OrderAgentWorker: неподдерживаемое действие …`.** [request-router.node.ts](../../src/support-agent/graph/nodes/request-router.node.ts#L47), [request-router.node.ts](../../src/support-agent/graph/nodes/request-router.node.ts#L264), [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L451)
3. В остальных случаях узел вызывает модель `FAST` с `withStructuredOutput(RequestRouterModelSchema)`. На вход подаёт текущий `query`, предыдущие сообщения (`slice(0, -1)`, затем лимит около 1200 токенов) и краткий товарный контекст. Результат `response.parsed` проходит Zod-проверку. Дальше код восстанавливает запрос для `customerHelpAgent`, если находит в тексте тему и формулировку вопроса. При ненулевом `workerQueries.orderAgent` и пустом `orderRequest` ставит `{ action: 'RELEVANT', orderId: null, orderNumber: null }`. Если запроса для `orderAgent` нет, сбрасывает `orderRequest` в `null`. [request-router.node.ts](../../src/support-agent/graph/nodes/request-router.node.ts#L249), [request-router.node.ts](../../src/support-agent/graph/nodes/request-router.node.ts#L321), [history-context.ts](../../src/support-agent/context/history-context.ts#L43)
4. Ненулевые `workerQueries` задают список workers. `CANCEL` и три операции из серверного правила принудительно оставляют только `orderAgent`. Для чтения заказа возможен `multi`. При наличии workers маршрут равен `execute`, а поля уточнения и handoff очищаются. `afterRequestRoute` вызывает `dispatchWorkers`, который создаёт один `Send` на worker. Каждый получает копию state с собственным `query`. В order-ветке поле `messages` входного `Send` содержит только `new HumanMessage(query)`, а действие worker читает из `requestRouter.orderRequest`. История общего checkpoint при этом сохраняется. [request-router.node.ts](../../src/support-agent/graph/nodes/request-router.node.ts#L390), [after-request.route.ts](../../src/support-agent/graph/routers/after-request.route.ts#L4), [dispatch-workers.ts](../../src/support-agent/graph/routers/dispatch-workers.ts#L7), [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L331)

Есть второй путь в `orderAgent`. После выбора готового вопроса в теме `orders` `clarificationQuestionNode` создаёт `RequestRouterSchema` сам и возвращает `Command({ goto: 'orderAgent', update: … })` в режиме `single`. Пункты `order_status` и `order_cancel` передают `RELEVANT` и `CANCEL` соответственно. Пункт «Как отследить отправленный заказ?» читает статью базы знаний через `resolution.kind: 'knowledge'`. [clarification.config.ts](../../src/support-agent/config/clarification.config.ts#L129), [clarification-question.node.ts](../../src/support-agent/graph/nodes/clarification-question.node.ts#L133)

### Контракт маршрутизации

| Поле | Тип и назначение |
| --- | --- |
| `OrderRequest.action` | Обязательный enum. Реальные ветки worker: `LIST`, `GET`, `LATEST`, `RELEVANT`, `STATUS`, `TRACKING`, `CANCEL`. Схема также принимает `RETURN_REQUEST`, `EXCHANGE_REQUEST`, `CLAIM_REQUEST`. |
| `orderId` / `orderNumber` | Внутренний ID / публичный номер. При ненулевом значении это строки, которые после `trim()` должны быть непустыми. `orderId` обязателен, допускает `null`. `orderNumber` в доменной схеме необязателен и допускает `null`. В ненулевом `orderRequest` модели требуются **оба поля**, хотя оба могут быть `null`. |
| `workerQueries` | Объект с тремя обязательными ключами `productAgent`, `orderAgent`, `customerHelpAgent`. Значение каждого — строка длиной от 1 или `null`. |
| Выход модели | `workerQueries`, `orderRequest` или `null`, `fallbackRoute` (`unsupported`, `clarification`, `handoff` или `null`), `clarificationTopic` и `handoffRequest` (оба допускают `null`), строка `reason`. |
| Внутреннее решение | `RequestRouterSchema` заменяет `fallbackRoute` обязательным `route`, добавляет `workers` и хранит доменную форму `orderRequest`. `executionMode` записывается отдельно в state. |

Для запроса «Какой статус заказа №10482?» иллюстративная часть решения: `{ route: 'execute', workers: ['orderAgent'], orderRequest: { action: 'STATUS', orderId: null, orderNumber: '10482' } }`. Это пример результата классификации, фактическое решение для свободного текста зависит от модели. Идентификаторы от модели направляют поиск, доступ к заказу проверяет backend с `userId` из контекста. [order-request.schema.ts](../../src/support-agent/schemas/order-request.schema.ts#L3), [request-router.schema.ts](../../src/support-agent/schemas/request-router.schema.ts#L22), [request-router.schema.ts](../../src/support-agent/schemas/request-router.schema.ts#L82), [request-router.schema.ts](../../src/support-agent/schemas/request-router.schema.ts#L145), [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L171)

### State, checkpoint и способ завершения

State — рабочие данные графа. Checkpoint — сохранённый снимок state и точки исполнения. `SupportAgentGraph.invoke` передаёт `{ query, messages: [new HumanMessage({ content: query, id: messageId })] }` (поле `id` задаётся при наличии `messageId`) и `configurable.thread_id = chatId`. `context.userId` передаётся в config и читается worker через `SupportAgentContextSchema.parse(config.context)`. Записи LangGraph и клиентские `Message` в Prisma имеют разные обязанности. [support-agent.graph.ts](../../src/support-agent/graph/support-agent.graph.ts#L306), [support-agent-context.schema.ts](../../src/support-agent/context/support-agent-context.schema.ts#L3), [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L331)

| State | Начальное значение и обновление |
| --- | --- |
| `query` | `string`, без заданного default. Вход `invoke` или update ветки уточнения задаёт текст. В `Send` подставляется текст для конкретного worker. |
| `messages` | `MessagesValue`: история сообщений LangGraph, объединяется по ID. Новые ID добавляются, совпавший ID заменяет прежнее сообщение. `AIMessage` из worker или агрегатора записывается в историю графа. |
| `preIntentRoute`, `rejectCount`, `clarification` | Маршрут первого шага по умолчанию `null`, счётчик отказов `0`, тема уточнения `null`. Первичная проверка и узлы уточнения/отказа задают следующие значения. |
| `requestRouter`, `executionMode`, `activeAgent` | Изначально `null`. Router записывает решение и `single` или `multi`. При одиночном завершении worker записывает `activeAgent: 'orderAgent'`. Поля без reducer заменяются при явном update. |
| `workerResults` | По умолчанию `[]`. `ReducedValue` дописывает непустой список блоков к существующим, а вход `[]` **очищает** список. `preIntentNode` и `requestRouterNode` сбрасывают результаты, workers добавляют блоки, агрегатор читает их. |
| `pendingOrderAction` | По умолчанию `null`. При переходе к подтверждению отмены хранит `action: 'CANCEL'`, непустые `orderId`, `userId`, `confirmationId` и необязательный `orderNumber` (допускает `null`). `confirmOrderCancellation` читает это поле и при штатном завершении записывает `null`. |
| `answer`, `handoffRequest`, `handoff` | Nullable, default `null`. `preIntentNode` сбрасывает их. Order worker формирует `answer` в одиночной ветке. Данные handoff относятся к отдельному процессу передачи оператору. |

Обновление state задаёт значения, а `goto` в `Command` задаёт следующий узел. Пропущенные поля сохраняют свои значения. Например, в начале запроса `workerResults` очищается, но `pendingOrderAction` не входит в сброс `preIntentNode`. [support-agent.state.ts](../../src/support-agent/graph/support-agent.state.ts#L28), [pre-intent.node.ts](../../src/support-agent/graph/nodes/pre-intent.node.ts#L71), [support-agent.graph.ts](../../src/support-agent/graph/support-agent.graph.ts#L173)

- **Один worker.** Для условного оплаченного заказа №10482 `finishOrderAgent` записывает `answer: { type: 'order_agent', message: 'Заказ №10482 — оплачен.', blocks: [] }` и `AIMessage`, затем направляет выполнение в `END`. У `OrderAgentFinalAnswerSchema` массив блоков по умолчанию пуст и ограничен длиной 0. [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L133), [support-agent-answer.schema.ts](../../src/support-agent/schemas/support-agent-answer.schema.ts#L35)
- **Несколько workers.** Для иллюстративного запроса «Какой статус заказа №10482 и какие условия доставки?» order-узел возвращает `Command` к `aggregateAnswer` с `workerResults: [{ worker: 'order', data: { message: 'Заказ №10482 — оплачен.' } }]`. Reducer объединяет этот блок с результатом соседнего worker. Агрегатор требует минимум два блока, сортирует их в порядке `product_search → order → customer_help`, собирает текст секциями и пишет `{ type: 'aggregate', message, blocks }` и `AIMessage`. Сборка текста детерминирована. Фабрика принимает `AiService`, но не вызывает модель. Zod-схема агрегированного ответа допускает один блок, собственная проверка узла строже. [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L140), [aggregate-final-answer.node.ts](../../src/support-agent/graph/nodes/aggregate-final-answer.node.ts#L88), [support-agent-answer.schema.ts](../../src/support-agent/schemas/support-agent-answer.schema.ts#L62)

### Interrupt и resume на примере подтверждения

При выборе заказа из нескольких кандидатов и при подтверждении отмены order-узлы вызывают `interrupt(payload)`. `ClarificationNodeSchema` проверяет `kind`, строку `question`, nullable-тему `topic` и список `options` с непустыми `id` и `label`. Схема опции допускает `order` с карточкой, но текущий код выбора и подтверждения отдаёт `id` и `label`. [clarification-response.schema.ts](../../src/support-agent/schemas/clarification-response.schema.ts#L39), [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L251), [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L494)

| Шаг | State и наблюдаемый результат |
| --- | --- |
| До паузы | `orderAgent` пишет `pendingOrderAction` и направляет выполнение в `confirmOrderCancellation`. Узел сверяет `userId`, перечитывает заказ и строит варианты ответа. |
| Пауза | `interrupt` сохраняет ожидающую задачу в checkpoint того же `thread_id`. `SupportAgentService.toRunResult` берёт первый `INTERRUPT` и возвращает его `value`. Gateway после проверки `BOT` и `handoffVersion` отправляет этот payload как `chat:clarification`. Отдельная строка `ASSISTANT` для вопроса в этой ветке не создаётся. |
| Resume | Gateway принимает `chat:clarification_resume` с `{ chatId, value }`, проверяет общий `SupportAgentResumeSchema`, сохраняет реплику с `requireBot: true` и `payload.clarificationResume` и отправляет ACK. Затем сервис сверяет чат и проверяет `hasPendingInterrupt` по `snapshot.tasks[].interrupts`. При отсутствии паузы сервис выбрасывает конфликт уже после сохранения реплики. |
| Возврат в узел | `SupportAgentGraph.resume` вызывает тот же граф с `new Command({ resume: value })` и тем же `configurable.thread_id`. Узел начинает исполнение с начала, поэтому чтения до `interrupt` могут повториться. В соответствующей точке `interrupt` возвращает переданное `value`. Order-узел требует `kind: 'question_selected'` и проверяет `questionId` по текущим опциям. |

[order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L437), [support-agent.service.ts](../../src/support-agent/support-agent.service.ts#L128), [support-agent.service.ts](../../src/support-agent/support-agent.service.ts#L379), [support-agent.graph.ts](../../src/support-agent/graph/support-agent.graph.ts#L232), [support-agent.graph.ts](../../src/support-agent/graph/support-agent.graph.ts#L365), [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L532), [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L755), [clarification-resume.schema.ts](../../src/support-agent/schemas/clarification-resume.schema.ts#L15)

Условный `chat:clarification` для заказа №10482, когда вариант выбора другого заказа не добавлен:

```json
{
  "kind": "questions",
  "question": "Вы действительно хотите отменить Заказ №10482?",
  "topic": "orders",
  "options": [
    {
      "id": "order_cancel_confirm:81360142-3fb2-4cdc-904b-99ab565ab54d:592162a2-a031-4921-a13f-be45428644af",
      "label": "Да, отменить"
    },
    { "id": "order_cancel_decline", "label": "Нет" }
  ]
}
```

Ответ на кнопку «Да, отменить» передаёт `id` опции целиком. Значение сгенерировано сервером из `pendingOrderAction.confirmationId` и внутреннего ID текущего заказа. При неизвестном или устаревшем значении узел выбрасывает ошибку. [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L437), [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L494), [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L549)

```json
{
  "chatId": "ec414811-9680-463a-b88e-cd013ec96ab5",
  "value": {
    "kind": "question_selected",
    "questionId": "order_cancel_confirm:81360142-3fb2-4cdc-904b-99ab565ab54d:592162a2-a031-4921-a13f-be45428644af"
  }
}
```

Общий `SupportAgentResumeSchema` принимает четыре формы. Для `topic_selected` нужен `topic` из перечисления тем, для `custom_question` нужна непустая после `trim()` строка `text`, для `operator_offer` нужен `decision: 'accept' | 'decline'`. Для выбора заказа, навигации по страницам и подтверждения используется только `question_selected` с непустым `questionId`. Общая схема проверяет форму сообщения, а активный узел проверяет, подходит ли оно для текущей паузы. `resumeDisplayText()` сохраняет понятный текст для «Да, отменить» и «Нет». Полный ID остаётся в `Message.payload.clarificationResume`. Для кнопок списка, не найденных в конфигурации уточнений, текстом реплики становится `questionId`. [Общая схема](../../src/support-agent/schemas/support-agent-resume.schema.ts#L9), [схемы уточнений](../../src/support-agent/schemas/clarification-resume.schema.ts), [текст сохранённой реплики](../../src/modules/chat/chat.gateway.ts#L155)

### Публикация ответа

`SupportAgentService.toRunResult` возвращает `{ kind: 'answer', answer, handoff }`, если граф завершился с ответом. Для обычного order-ответа `ChatGateway.handleAgentResult` передаёт `answer.message` в `Message.content`, а `answer.blocks` — в `Message.payload.blocks`. Поле `answer.type` в этот payload не копируется. `createAssistantMessageIfCurrent` блокирует строку чата и проверяет владельца, режим `BOT`, отсутствие назначенного оператора и совпадение `handoffVersion` со значением, полученным при старте. После успешной записи `ASSISTANT` Gateway отправляет её в `chat:<chatId>` событием `chat:new_message`. [support-agent.service.ts](../../src/support-agent/support-agent.service.ts#L379), [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L809), [chat.service.ts](../../src/modules/chat/chat.service.ts#L365)

Во время запуска отдельно идут `chat:assistant_status` с `{ chatId, status }` и при агрегации `chat:assistant_delta` с `{ chatId, delta }`. Order worker отправляет `CHECKING_ORDER`. Агрегатор передаёт `GENERATING_ANSWER` и готовый текст одним delta. По выходе из запуска Gateway отправляет `IDLE`, в том числе при паузе. Для обработанных ошибок графа публикуется `chat:error` с `ASSISTANT_UNAVAILABLE` и `retryable`. Ответ, признанный устаревшим после смены режима чата, отбрасывается. [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts#L343), [aggregate-final-answer.node.ts](../../src/support-agent/graph/nodes/aggregate-final-answer.node.ts#L147), [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L690), [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L927)

`chat:retry_assistant` доступен владельцу в режиме `BOT`, если последняя запись его чата имеет роль `USER`. Gateway подтверждает запрос пустым ACK. Он повторно использует сохранённый текст и ID сообщения или ранее записанный `payload.clarificationResume`. Новой пользовательской записи в этой ветке нет. Для повторного resume по-прежнему нужен ожидающий interrupt. [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L325), [chat.gateway.ts](../../src/modules/chat/chat.gateway.ts#L141), [support-agent.service.ts](../../src/support-agent/support-agent.service.ts#L146)

## Исполнение операций в Order Agent

Файл [order-agent.worker.ts](../../src/support-agent/graph/workers/order-agent.worker.ts) содержит два узла. `orderAgent` читает заказы и подготавливает отмену. `confirmOrderCancellation` запрашивает согласие, повторно читает заказ и вызывает подходящую операцию. `SupportAgentGraph` создаёт первый узел через `createOrderAgentWorker(ordersService)`, второй через `createConfirmOrderCancellationNode(ordersService, refundService, cancellationCaseService)`. Узлы получают заказ через сервис и не формируют запросы Prisma. [Регистрация узлов](../../src/support-agent/graph/support-agent.graph.ts#L129), [зависимости](../../src/support-agent/graph/workers/order-agent.worker.ts#L16).

Примеры данных ниже иллюстративные. `1042` — номер, который видит покупатель. `ord-1042` — внутренний ID этого заказа. `user-7` — ID пользователя из контекста выполнения.

### Вход в `createOrderAgentWorker`

Фабрика принимает `OrdersService` и возвращает асинхронный узел `(state, config)`. Узел извлекает `userId` из `SupportAgentContextSchema.parse(config.context)` и читает `state.requestRouter?.orderRequest`. При отсутствии запроса выбрасывает `OrderAgentWorker: отсутствует orderRequest`. Перед обращением к сервису публикует событие `assistant_status` с телом `{ status: 'CHECKING_ORDER' }`. Этот статус сообщает о начале проверки и не содержит результата. [Вход в узел](../../src/support-agent/graph/workers/order-agent.worker.ts#L331), [SupportAgentContextSchema](../../src/support-agent/context/support-agent-context.schema.ts#L3).

| Поле | Тип и обязательность | Что означает |
| --- | --- | --- |
| `context.userId` | Обязательная строка, `trim().min(1)` | Владелец заказа. Worker передаёт ID в методы сервиса при каждом чтении и действии. |
| `requestRouter.orderRequest` | `OrderRequest \| null` | Результат маршрутизации. При вызове `orderAgent` объект должен существовать. |
| `orderRequest.action` | Обязательный `OrderAction` | Поддерживаются `LIST`, `LATEST`, `RELEVANT`, `GET`, `STATUS`, `TRACKING`, `CANCEL`. В enum также есть `RETURN_REQUEST`, `EXCHANGE_REQUEST`, `CLAIM_REQUEST`. У этого узла нет веток для них. |
| `orderRequest.orderId` | Обязательное поле, `string \| null` | Внутренний ID. Если не задан, передаётся `null`. Строка после `trim()` должна быть непустой. |
| `orderRequest.orderNumber` | `string \| null`, поле можно опустить | Публичный номер. Если передана строка, она обрезается и проверяется на непустоту. Модельная схема маршрутизатора требует само поле и допускает `null`. |

[OrderRequestSchema](../../src/support-agent/schemas/order-request.schema.ts#L3), [RequestRouterModelSchema](../../src/support-agent/schemas/request-router.schema.ts#L82), [RequestRouterSchema](../../src/support-agent/schemas/request-router.schema.ts#L154), [неподдерживаемое действие](../../src/support-agent/graph/workers/order-agent.worker.ts#L451).

### Чтение заказов и отслеживание

| `action` | Вызов | Сообщение |
| --- | --- | --- |
| `LIST` | `getUserOrders(userId)` | Для пустого списка «У вас пока нет заказов.». Иначе счётчик и пронумерованные строки, например `У вас 2 заказ(а/ов):`, `1. Заказ №1042 — отправлен.`, `2. Заказ №1035 — доставлен.`. Worker сохраняет порядок сервиса. |
| `LATEST` | `getLatestUserOrder(userId)` | Статус последнего по времени заказа или сообщение об отсутствии заказов. |
| `RELEVANT` | `getRelevantUserOrder(userId)` | Статус заказа, выбранного бизнес-правилом. `selectRelevantOrder` сначала сравнивает приоритет статуса, при равенстве — дату создания. |
| `GET`, `STATUS` | `resolveTargetOrder(ordersService, userId, request)` | Одна строка со статусом или сообщение об отсутствии заказа. `GET` формирует тот же текст, что и `STATUS`. |
| `TRACKING` | Тот же `resolveTargetOrder` | Статус заказа и сведения об отправлениях из возвращённой записи. |

[Ветки чтения](../../src/support-agent/graph/workers/order-agent.worker.ts#L351), [OrdersService](../../src/modules/orders/orders.service.ts#L91), [selectRelevantOrder](../../src/modules/orders/core/order-policy.ts#L56).

`resolveTargetOrder` принимает сервис, ID владельца и `OrderRequest`. Непустой `orderNumber` ведёт к `getOrderByNumber(userId, orderNumber)`, непустой `orderId` — к `getOrderById(userId, orderId)`. Если оба значения отсутствуют, вызывается `getRelevantUserOrder(userId)`. До вызова helper узел отклоняет запрос с обоими идентификаторами фразой «Не удалось однозначно определить заказ. Укажите один номер заказа.». Эта проверка стоит после ранних веток `LIST`, `LATEST`, `RELEVANT`, поэтому они используют свои правила выбора даже при наличии ссылок. [resolveTargetOrder](../../src/support-agent/graph/workers/order-agent.worker.ts#L171), [проверка двух идентификаторов](../../src/support-agent/graph/workers/order-agent.worker.ts#L378).

`missingOrderMessage(request)` выбирает формулировку по полям запроса. Для номера `1042` это «Заказ №1042 не найден среди ваших заказов.». Для внутреннего ID предусмотрена фраза «Запрошенный заказ не найден среди ваших заказов.». Без ссылки на конкретный заказ возвращает «У вас пока нет заказов.». Текущий адаптер возвращает `null` при отсутствии совпадения по номеру, а чтение по ID использует `findFirstOrThrow` с `userId`. Если запись по ID отсутствует или принадлежит другому пользователю, исключение выходит из узла до вызова `missingOrderMessage`. [missingOrderMessage](../../src/support-agent/graph/workers/order-agent.worker.ts#L187), [чтение по ID](../../src/modules/orders/adapters/current-store-order.adapter.ts#L98), [чтение по номеру](../../src/modules/orders/adapters/current-store-order.adapter.ts#L126).

`orderLabel(order)` из `OrderRecord.number` делает «Заказ №1042». Для `null` или пропущенного поля выводит «Заказ». `orderSummary(order)` добавляет тире, подпись статуса из `ORDER_STATUS_LABELS` и точку. Например, `{ number: '1042', status: 'SHIPPED' }` даёт «Заказ №1042 — отправлен.». [Форматирование статуса](../../src/support-agent/graph/workers/order-agent.worker.ts#L47), [orderLabel и orderSummary](../../src/support-agent/graph/workers/order-agent.worker.ts#L75).

`trackingSummary(order)` начинает со строки `orderSummary(order)`. Дальше различает три формы `order.shipments`.

| Значение | Продолжение текста |
| --- | --- |
| `undefined` или `null` | Служба доставки, если заполнен `deliveryProvider`, затем «Отслеживание отправлений для этого магазина пока не подключено.» и «Трек-номер и прогноз прибытия сейчас недоступны.». |
| `[]` | «Информации об отправлениях пока нет.». Текущий Prisma-адаптер отдаёт массив, включая пустой. |
| Непустой массив | Блок `shipmentSummary(shipment, index)` на каждую запись, блоки разделены пустой строкой. |

`shipmentSummary` принимает `ShipmentRecord` и индекс в массиве с нуля. Индекс `0` становится «Отправление 1». Статус `IN_TRANSIT` становится «в пути». Строки о перевозчике, трек-номере, URL и предполагаемой дате включаются, только когда соответствующие поля заполнены. Дата форматируется как `ru-RU` в `UTC`. Поля `shippedAt` и `deliveredAt` в этом тексте не используются. [shipmentSummary и trackingSummary](../../src/support-agent/graph/workers/order-agent.worker.ts#L83), [ShipmentRecordSchema](../../src/modules/orders/core/order-record.schema.ts#L74), [формирование массива отправлений](../../src/modules/orders/adapters/current-store-order.adapter.ts#L326).

Например, для `{ action: 'TRACKING', orderId: null, orderNumber: '1042' }` промежуточный вызов — `getOrderByNumber('user-7', '1042')`. Пусть возвращён заказ `SHIPPED` с одним отправлением `IN_TRANSIT`, полями `provider: 'СДЭК'`, `trackingNumber: 'TR-1042'`, `trackingUrl: null`, `estimatedDeliveryAt: new Date('2026-11-09T12:00:00Z')`. Тогда worker сформирует такой текст. [Ветка TRACKING](../../src/support-agent/graph/workers/order-agent.worker.ts#L384).

```text
Заказ №1042 — отправлен.

Отправление 1 — в пути.
Перевозчик: СДЭК.
Трек-номер: TR-1042.
Предполагаемая дата доставки: 09.11.2026.
```

### Выбор заказа для отмены

При `{ action: 'CANCEL', orderId: null, orderNumber: '1042' }` worker сразу ищет заказ по номеру. При двух `null` он читает список заказов пользователя и готовит варианты. После выбора из списка он повторно читает запись по `userId` и внутреннему ID. Если политика возвращает `ALREADY_CANCELLED`, worker отвечает «Заказ №1042 уже отменён.». Для других маршрутов worker готовит подтверждение. [Ветка CANCEL](../../src/support-agent/graph/workers/order-agent.worker.ts#L402).

- `isCancellationCandidate(order)` возвращает `true` для `PAID`, `PROCESSING`, `SHIPPED`, `DELIVERED`. `cancellationOptions(orders)` оставляет такие записи с заполненным номером и сортирует от новых к старым, при равной дате — по числовому номеру по убыванию. Это правило показа в меню. При явном номере или ID меню пропускается. [Фильтр и сортировка](../../src/support-agent/graph/workers/order-agent.worker.ts#L199), [ветка явной ссылки](../../src/support-agent/graph/workers/order-agent.worker.ts#L404).
- `cancellationOptionLabel(order)` формирует подпись из номера, времени создания в `Europe/Moscow`, суммы `finalAmount` в `ru-RU` с символом `₽`, подписи статуса и заголовка первого товара при его наличии. Например, заказ от `2026-11-03T09:40:00Z` с суммой `2490` и статусом `PAID` может выглядеть как «Заказ №1042 · 03.11, 12:40 МСК · 2 490 ₽ · оплачен · Куртка». [cancellationOptionLabel](../../src/support-agent/graph/workers/order-agent.worker.ts#L218).
- `selectCancellationOrder(orders)` возвращает `null`, если кандидатов нет, и сам заказ, если кандидат один. Если их несколько, делает `interrupt` с вопросом «Какой именно заказ хотите отменить?» и максимум пятью заказами на страницу. Для шести записей первый экран содержит пять заказов, «Показать ещё заказы →» и «Не отменять заказ». Второй содержит оставшийся заказ, «← Предыдущие заказы» и отказ. Значение `questionId` сравнивается с `id` варианта, например `Заказ №1042`, а подпись со временем и ценой используется для отображения. Неизвестный ID или номер с другой страницы приводит к `OrderAgent: выбранный заказ отсутствует в списке`. Выбор «Не отменять заказ» возвращает `null`, который worker превращает в «Хорошо, заказ не отменяю.». Пустой список отсеивается ещё до вызова helper с сообщением «У вас нет оплаченных заказов для отмены.». [selectCancellationOrder](../../src/support-agent/graph/workers/order-agent.worker.ts#L240), [обработка результата выбора](../../src/support-agent/graph/workers/order-agent.worker.ts#L408).

Переход к подтверждению возвращается как `Command`. Его `update` записывает намерение в State, а `goto` указывает следующий узел. Упрощённый пример значений для найденного заказа. [Создание pendingOrderAction](../../src/support-agent/graph/workers/order-agent.worker.ts#L437).

```ts
new Command({
  goto: 'confirmOrderCancellation',
  update: {
    pendingOrderAction: {
      action: 'CANCEL',
      orderId: 'ord-1042',
      orderNumber: '1042',
      userId: 'user-7',
      confirmationId: 'order_cancel_confirm:00000000-0000-4000-8000-000000000001',
    },
  },
});
```

| Поле `PendingOrderActionSchema` | Тип | Использование |
| --- | --- | --- |
| `action` | Обязательный литерал `CANCEL` | Проверяется узлом подтверждения. |
| `orderId` | Обязательная непустая строка после `trim()` | Первичный заказ для перечитывания по ID. |
| `orderNumber` | Непустая строка после `trim()`, `null` или отсутствует | Публичный номер в снимке. Worker пишет `number ?? null`. Текст подтверждения строится по заново полученному заказу. |
| `userId` | Обязательная непустая строка после `trim()` | Должен совпасть с `context.userId` при подтверждении. |
| `confirmationId` | Обязательная непустая строка после `trim()` | Worker создаёт `order_cancel_confirm:` + `randomUUID()`. При подтверждении к этому префиксу добавляется ID выбранного заказа. |

Поле `state.pendingOrderAction` по умолчанию `null`. Успешное завершение узла подтверждения, включая отказ, возвращает обновление `pendingOrderAction: null`. При исключении этот финальный `Command` не формируется. [PendingOrderActionSchema](../../src/support-agent/graph/support-agent.state.ts#L28), [поле State](../../src/support-agent/graph/support-agent.state.ts#L83), [finish в узле подтверждения](../../src/support-agent/graph/workers/order-agent.worker.ts#L482).

### Подтверждение, пауза и возврат

`createConfirmOrderCancellationNode` принимает `OrdersService` для чтения и прямой отмены, `OrderCancellationCaseService` для записи заявки и `RefundService` для отмены с возвратом. Возвращённый узел читает `config.context.userId`, `config.configurable.thread_id` как `chatId` и `state.pendingOrderAction`. Пустой или отсутствующий `chatId`, отсутствующая ожидающая отмена либо несовпадение пользователя вызывают исключение до чтения заказа. [Проверки на входе](../../src/support-agent/graph/workers/order-agent.worker.ts#L457).

Узел загружает `selectedOrder` по сохранённому ID и заново собирает список кандидатов. При двух или более кандидатах добавляет кнопку «Выбрать другой заказ». В обычном случае payload паузы выглядит так. [Построение вариантов подтверждения](../../src/support-agent/graph/workers/order-agent.worker.ts#L484).

```ts
{
  kind: 'questions',
  topic: 'orders',
  question: 'Вы действительно хотите отменить Заказ №1042?',
  options: [
    {
      id: 'order_cancel_confirm:00000000-0000-4000-8000-000000000001:ord-1042',
      label: 'Да, отменить',
    },
    { id: 'order_cancel_decline', label: 'Нет' },
  ],
}
```

| Схема | Обязательные поля и значения в этом потоке |
| --- | --- |
| `ClarificationNodeSchema` | `kind` допускает `topics`, `questions`, `custom_input`. Оба order-узла используют `questions`. `question` — строка. `topic` допускает `null`, здесь `orders`. `options` — массив вариантов. |
| `ClarificationOptionSchema` | `id` и `label` — строки длиной от одного символа. Дополнительное поле `order` может содержать `OrderCancellationCard` с номером, статусом, суммой, `currency: 'RUB'` и товарами. В обеих текущих паузах worker передаёт только `id` и `label`. |
| `ClarificationQuestionSelectedResumeSchema` | `kind: 'question_selected'` и `questionId` — строка длиной от одного символа. Совпадение с ожидаемым вариантом проверяет код узла после Zod. |

[ClarificationNodeSchema и варианты](../../src/support-agent/schemas/clarification-response.schema.ts#L39), [OrderCancellationCardSchema](../../src/support-agent/schemas/clarification-response.schema.ts#L5), [ClarificationQuestionSelectedResumeSchema](../../src/support-agent/schemas/clarification-resume.schema.ts#L16).

Если другой производитель опций передаёт `order`, схема карточки требует непустой `number`, `status` из перечисления статусов заказа, `finalAmount >= 0`, литерал `currency: 'RUB'` и массив `items`. В каждой позиции обязательны строки `productId` и `title`, строки либо `null` для `image` и `size`, положительное целое `quantity`. Отсутствие `option.order` допустимо. Для текущего order worker номер и сумма входят в текст `label` при выборе, отдельного объекта карточки в payload нет. [Форма карточки](../../src/support-agent/schemas/clarification-response.schema.ts#L5), [построение подписи](../../src/support-agent/graph/workers/order-agent.worker.ts#L218)

| Шаг | Что делает граф |
| --- | --- |
| Перед паузой | `orderAgent` записал `pendingOrderAction` и направил граф в `confirmOrderCancellation`. Вызов `interrupt(payload)` приостанавливает этот узел. Payload передаётся клиенту, состояние сохраняется через checkpointer по `thread_id` чата. |
| Возобновление | Пример входа — `{ kind: 'question_selected', questionId: 'order_cancel_confirm:00000000-0000-4000-8000-000000000001:ord-1042' }`. `SupportAgentGraph.resume` вызывает граф с `new Command({ resume: value })`, тем же `thread_id` и контекстом владельца. |
| Повторный вход | При возобновлении LangGraph запускает узел с начала. До `interrupt` снова выполняются чтения заказа и списка. При нескольких паузах в одном узле сохранённые ответы подставляются по порядку вызовов `interrupt`. В `orderAgent` при паузе выбора также повторяется `CHECKING_ORDER` и чтение списка. |
| Обработка выбора | `order_cancel_decline` завершает без отмены. «Выбрать другой заказ» вызывает меню, перечитывает выбранный заказ и возвращается к вопросу подтверждения. В цикле меняется локальный `selectedOrder`; сохранённый `pendingOrderAction` остаётся исходным. Подтверждение должно совпасть с `pendingAction.confirmationId + ':' + selectedOrder.id`. Иначе выбрасывается ошибка о неизвестном или устаревшем подтверждении. |

Если список заказов изменился между паузой и возобновлением, один и тот же `questionId` может отсутствовать на заново построенной странице. Это объясняет ошибку «выбранный заказ отсутствует в списке» при выборе по старой кнопке. [PostgresSaver](../../src/support-agent/graph/support-agent.graph.ts#L99), [resume](../../src/support-agent/graph/support-agent.graph.ts#L365), [выбор и повторное чтение](../../src/support-agent/graph/workers/order-agent.worker.ts#L490), [проверка подтверждения](../../src/support-agent/graph/workers/order-agent.worker.ts#L549).

После согласия worker ещё раз получает текущий заказ и вызывает `getOrderCancellationPlan(order)`. Этот повторный запрос позволяет учесть, что между показом кнопки и согласием заказ, платёж или отправление поменялись. Например, заказ `PAID` с `shipments: []`, `paymentType: 'CARD'`, одним успешным платежом на `2490` и `finalAmount: 2490` даёт `REFUND_BEFORE_SHIPPING`. Для неоплаченного `PENDING_PAYMENT` с пустыми массивами платежей и отправлений политика даёт `DIRECT_CANCEL`. [Повторное чтение и policy](../../src/support-agent/graph/workers/order-agent.worker.ts#L555), [getOrderCancellationPlan](../../src/modules/orders/core/order-policy.ts#L76).

| Маршрут | Вызов и результат worker |
| --- | --- |
| `ALREADY_CANCELLED` | «Заказ №1042 уже отменён.». |
| `DIRECT_CANCEL` | `ordersService.cancelOrder(userId, order.id)`. После результата — «Заказ №1042 отменён.». |
| `REFUND_BEFORE_SHIPPING` | `cancellationCaseService.createOrGet(userId, chatId, order.id)` возвращает receipt. Worker передаёт `receipt.caseId` в `refundService.cancelAndRefund(userId, order.id, receipt.caseId)` и ждёт вызов. `ConflictException` именно из вызова возврата перехватывается. Прочие исключения выходят из узла. После обычного возврата из метода или перехваченного конфликта — общий текст о принятой заявке. |
| `INTERCEPT_DELIVERY`, `FINALIZE_RETURN`, `RETURN_AFTER_DELIVERY`, `MANUAL_REVIEW` | `cancellationCaseService.createOrGet(userId, chatId, order.id)`, затем общий текст о заявке. Worker здесь завершает обработку после получения receipt. |

`cancellationAcceptedMessage(order)` возвращает «Заказ №1042: заявка на отмену принята. Возврат денежных средств будет обработан. После оформления возврата срок зачисления зависит от банка.». Этот текст означает, что пройдена ветка заявки, и одинаков для нескольких маршрутов. Реальный статус заказа и платежа определяется результатами сервисов. Worker решает, вызывать ли автовозврат, по своему `plan.route` из последнего чтения заказа. Из receipt он использует только `caseId`. [Ветки после согласия](../../src/support-agent/graph/workers/order-agent.worker.ts#L555), [текст принятой заявки](../../src/support-agent/graph/workers/order-agent.worker.ts#L325).

### Формирование ответа через `finishOrderAgent`

`finishOrderAgent(state, message, clearPendingAction = false)` читает `state.executionMode` и возвращает `Command`. Первичный worker передаёт текст и оставляет значение флага по умолчанию. Узел подтверждения передаёт `true`, добавляя `pendingOrderAction: null` в возвращаемый `update`. [finishOrderAgent](../../src/support-agent/graph/workers/order-agent.worker.ts#L133).

| Режим | `update` для сообщения «Заказ №1042 — отправлен.» | `goto` и потребитель |
| --- | --- | --- |
| `multi` | `{ workerResults: [{ worker: 'order', data: { message: 'Заказ №1042 — отправлен.' } }] }`. Проверка через `OrderAnswerBlockSchema`. | `aggregateAnswer`. Редьюсер `workerResults` добавляет непустой список блоков к уже накопленному, поэтому ранее записанный product-блок сохраняется рядом с order-блоком. Пустой вход сбрасывает список. Агрегатор читает получившиеся блоки, требует минимум два и формирует общий ответ. |
| Остальные значения, включая `single` | `activeAgent: 'orderAgent'`, `answer: { type: 'order_agent', message: 'Заказ №1042 — отправлен.', blocks: [] }`, `messages: [new AIMessage(answer.message)]`. `OrderAgentFinalAnswerSchema` подставляет пустой `blocks` по умолчанию. | `END`. Ответ доступен сервису поддержки, а `AIMessage` попадает в историю `messages`. |

[Схемы блока и одиночного ответа](../../src/support-agent/schemas/support-agent-answer.schema.ts#L11), [пустой blocks по умолчанию](../../src/support-agent/schemas/support-agent-answer.schema.ts#L35), [редьюсер workerResults](../../src/support-agent/graph/support-agent.state.ts#L70), [сборка агрегированного ответа](../../src/support-agent/graph/nodes/aggregate-final-answer.node.ts#L118).

## Данные заказа и операции магазина

### Как Order Agent обращается к заказам

`OrdersService` даёт агенту операции с заказами текущего пользователя. `userId: string` приходит из `SupportAgentContextSchema.parse(config.context)`. Для поиска `orderNumber: string` — публичный номер, а `orderId: string` — внутренний ID из запроса или уже выбранной записи. У worker есть отдельная проверка на одновременную передачу обоих идентификаторов. Функции сервиса возвращают записи магазина, на основе которых worker строит ответ. [Вызовы в Order Agent](../../src/support-agent/graph/workers/order-agent.worker.ts#L335)

`OrderPort` — TypeScript-интерфейс, который описывает пять операций хранения и возвращает `OrderRecord`. В рантайме Nest находит реализацию по токену `ORDER_PORT`. `OrdersModule` связывает этот токен с уже зарегистрированным экземпляром `CurrentStoreOrderAdapter` через `useExisting` и экспортирует `OrdersService`, `OrderCancellationCaseService`, `RefundService`. Адаптер использует `PrismaService`. [OrderPort](../../src/modules/orders/ports/order.port.ts) · [OrdersModule](../../src/modules/orders/orders.module.ts#L21) · [OrdersService](../../src/modules/orders/orders.service.ts#L67)

| Метод `OrdersService` | Что происходит и куда идёт результат |
| --- | --- |
| `getUserOrders(userId): Promise<OrderRecord[]>` | Адаптер выбирает строки с таким `userId`, сортирует по `createdAt DESC` и преобразует каждую запись. Пустой результат — `[]`. Worker строит список или подбирает варианты для отмены. |
| `getOrderById(userId, orderId): Promise<OrderRecord>` | `findFirstOrThrow` ищет по `id` **и** `userId`. Отсутствующий и чужой заказ одинаково не проходят фильтр. Адаптер пропускает исключение Prisma, поэтому эта ветка отличается от поиска по номеру, который может вернуть `null`. Worker также читает заказ по ID после выбора и перед исполнением отмены. |
| `getOrderByNumber(userId, orderNumber): Promise<OrderRecord \| null>` | Адаптер обрезает пробелы, проверяет только цифры, преобразует строку в положительное целое число в пределах `1…2147483647` и ищет по `userId` и `number`. Неверный формат даёт `null` до запроса в БД. Отсутствующий номер у этого пользователя тоже даёт `null`, по которому worker формирует сообщение «заказ не найден». |
| `getLatestUserOrder(userId): Promise<OrderRecord \| null>` | Берёт первую запись пользователя по `createdAt DESC`. Используется для `LATEST`. |
| `getRelevantUserOrder(userId): Promise<OrderRecord \| null>` | Получает весь список через `OrderPort.getUserOrders` и применяет `selectRelevantOrder`. Используется для `RELEVANT` и поиска без идентификатора в `GET/STATUS/TRACKING`. |
| `cancelOrder(userId, orderId): Promise<OrderRecord>` | Загружает заказ владельца и проверяет `getOrderCancellationEligibility`. При запрете выбрасывает `BadRequestException` с `reason`. При разрешении вызывает порт для записи. `null` от порта преобразует в `ConflictException`. Успешный результат — перечитанный `OrderRecord` со статусом `CANCELLED`. |

Методы чтения выше запрашивают БД через адаптер. `getOrderCancellationEligibility(userId, orderId)` также доступен в сервисе и возвращает `{ order, eligibility: { allowed, reason } }`. В текущем worker маршрут рассчитывается вызовом чистой функции `getOrderCancellationPlan(order)`, а `cancelOrder` самостоятельно проверяет право на прямую отмену. [Реализация методов OrdersService](../../src/modules/orders/orders.service.ts#L91) · [Запросы CurrentStoreOrderAdapter](../../src/modules/orders/adapters/current-store-order.adapter.ts#L46) · [Выбор заказа в worker](../../src/support-agent/graph/workers/order-agent.worker.ts#L171)

В адаптере `cancelOrder` открывает транзакцию и вызывает `lockCurrentStoreOrder(tx, orderId)`. `tx` — клиент Prisma внутри транзакции. Запрос `SELECT ... FOR UPDATE` блокирует найденную строку `order` до конца транзакции, функция возвращает `true` при одной строке. При записи `updateMany` проверяет владельца, статус `DRAFT` или `PENDING_PAYMENT`, отсутствие `SUCCEEDED`-платежа и отправлений из набора `SHIPPED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `EXCEPTION`, `RETURNED`. Если строка не найдена или обновлена не ровно одна строка, адаптер возвращает `null`. Проверка плана в сервисе учитывает также `PENDING`-платёж, а условие `updateMany` для платежей проверяет только `SUCCEEDED`. [Блокировка заказа](../../src/modules/orders/adapters/current-store-order-lock.ts#L3) · [Запись отмены](../../src/modules/orders/adapters/current-store-order.adapter.ts#L188)

### Контракт `OrderRecord`

`OrderRecordSchema` — схема Zod для проверки данных, полученных из адаптера. `CurrentStoreOrderAdapter.mapOrder` сначала проверяет массив JSON-позиций `order.items`, затем строит и проверяет весь объект. Ошибка `parse` прерывает вызов. Prisma загружает платежи по `createdAt DESC`, отправления по `createdAt ASC`. В примерах ниже `Date` — объект JavaScript. [OrderRecordSchema](../../src/modules/orders/core/order-record.schema.ts#L94) · [mapOrder](../../src/modules/orders/adapters/current-store-order.adapter.ts#L258) · [Модели Prisma](../../prisma/schema.prisma#L300)

| Поле `OrderRecord` | Тип и источник |
| --- | --- |
| `id`, `userId` | `string` из `Order`. Внутренний ID заказа и ID владельца. |
| `number` | `string \| null \| undefined`. Схема допускает отсутствие, `null` или непустую строку после `trim`. Текущий адаптер преобразует числовой публичный `Order.number` в строку. Worker использует её в подписи. |
| `createdAt`, `updatedAt` | `Date` из `Order`. Для выбора актуального заказа используется `createdAt`. |
| `token`, `cartId` | `string \| null` в контракте. Значения берутся из `Order`. `cartId` указывает на корзину, из которой оформлялся заказ. |
| `totalAmount`, `finalAmount` | `number` из `Order`. Стоимость товаров и итоговая сумма. Политика возврата сравнивает `finalAmount` с суммой платежа. |
| `currency` | `string \| null`. Текущий адаптер подставляет `null`. В вызове возврата YooKassa валюта задаётся отдельно как `RUB`. |
| `status` | `DRAFT \| PENDING_PAYMENT \| PAID \| PROCESSING \| SHIPPED \| DELIVERED \| CANCELLED`. Текущее состояние `Order`, источник для подписи, ранжирования и политики. |
| `fullName`, `address`, `email`, `phone`, `comment` | `string \| null` из `Order`. Контактные данные и комментарий оформления. |
| `deliveryDate`, `deliveryFee`, `deliveryTime`, `deliveryProvider` | `Date \| null`, `number \| null`, `string \| null`, `string \| null` соответственно. Параметры оформления доставки из `Order`. Worker использует `deliveryProvider` в ответе об отслеживании при недоступных данных об отправлениях. |
| `paymentType` | `string \| null` в контракте. Значение `Order.paymentType`, для автоматического возврата требуется `CARD`. |
| `items`, `payments`, `shipments` | Вложенные записи ниже. Пустой список платежей или отправлений означает отсутствие соответствующих записей. Только `shipments` допускает также `null` или отсутствие поля, что означает недоступные данные об отправлениях. Текущий адаптер всегда передаёт массив `shipments`. |

| Вложенная схема | Поля, типы и происхождение |
| --- | --- |
| `OrderItemRecordSchema` | `productId`, `title`, `price` — строки. `quantity` — положительное целое. `image`, `size` — строки либо `null`. Всё берётся из `Order.items`. `OrdersService.createOrder` сохраняет снимок позиций корзины, включая название, цену и первое изображение товара. Для существующего `DRAFT` этот снимок может быть обновлён. |
| `OrderPaymentRecordSchema` | `id` — строка или целое число, текущая модель `Payment` даёт число. `createdAt`, `updatedAt` — `Date`. `orderId`, `providerPaymentId` — строки. `amount` — число. `status` — `PENDING \| SUCCEEDED \| FAILED`. `paidAt` — `Date \| null`. `rawResponse` — значение неизвестной формы или `null` из `Payment.rawResponse`. Для решения об отмене используются статус и сумма, а текущая финансовая операция повторно читает `Payment` из БД. |
| `ShipmentRecordSchema` | `id` — непустая строка. `provider`, `trackingNumber` — `string \| null`. `trackingUrl` — валидный URL или `null`. `estimatedDeliveryAt`, `shippedAt`, `deliveredAt` — `Date \| null`. `status` — `PENDING \| SHIPPED \| IN_TRANSIT \| OUT_FOR_DELIVERY \| DELIVERED \| EXCEPTION \| RETURNED \| UNKNOWN`. Данные из `Shipment`. Статус, перевозчик, трек-номер, ссылка и прогноз даты используются в ответе об отслеживании. |

[Схемы вложенных записей](../../src/modules/orders/core/order-record.schema.ts#L23) · [Снимок позиций в createOrder](../../src/modules/orders/orders.service.ts#L474) · [Отображение отправлений](../../src/support-agent/graph/workers/order-agent.worker.ts#L83)


### Как выбирается актуальный заказ

`selectRelevantOrder(orders: readonly OrderRecord[]): OrderRecord | null` возвращает `null` для пустого списка. Иначе сортирует копию массива. Сначала сравнивает приоритеты статусов, а при равенстве берёт более новый `createdAt`. Исходный список не меняется. Порядок по убыванию приоритета: `SHIPPED` (70), `PROCESSING` (60), `PAID` (50), `PENDING_PAYMENT` (40), `DRAFT` (30), `DELIVERED` (20), `CANCELLED` (10). Отдельного исключения доставленных и отменённых заказов нет. [selectRelevantOrder](../../src/modules/orders/core/order-policy.ts#L56)

Фрагмент `selectRelevantOrder` показывает, как после сравнения статусов применяется дата:

```ts
return [...orders].sort((left, right) => {
  const priorityDifference =
    ORDER_RELEVANCE_PRIORITY[right.status] -
    ORDER_RELEVANCE_PRIORITY[left.status];

  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  return right.createdAt.getTime() - left.createdAt.getTime();
})[0];
```

Условный набор заказов одного пользователя:

| Публичный номер | Статус | `createdAt` |
| --- | --- | --- |
| `"103"` | `DRAFT` | 3 ноября |
| `"102"` | `SHIPPED` | 2 ноября |
| `"101"` | `SHIPPED` | 1 ноября |

Вызов `getLatestUserOrder(userId)` возвращает `OrderRecord` №103. Вызов `getRelevantUserOrder(userId)` возвращает №102. Статус `SHIPPED` обгоняет более свежий `DRAFT`, а из двух отправленных заказов выигрывает более свежий. Worker затем берёт `number` и `status` из выбранного объекта. [Методы OrdersService](../../src/modules/orders/orders.service.ts#L106) · [Подпись заказа в worker](../../src/support-agent/graph/workers/order-agent.worker.ts#L75)

### Как выбирается маршрут отмены

`getOrderCancellationPlan(order: OrderRecord): OrderCancellationPlan` — чистая функция. Она возвращает `{ route, hasSucceededPayment }`, где флаг означает наличие хотя бы одной записи `Payment(SUCCEEDED)`. Маршрут определяет следующий шаг приложения. Функция читает текущий снимок данных, поэтому результат сам по себе не подтверждает выполнение операции. Порядок проверок важен. [getOrderCancellationPlan](../../src/modules/orders/core/order-policy.ts#L76)

| Условие в порядке проверки | `route` |
| --- | --- |
| Заказ уже `CANCELLED` | `ALREADY_CANCELLED` |
| Заказ `DELIVERED` | `RETURN_AFTER_DELIVERY` |
| `shipments` равно `null` или отсутствует | `INTERCEPT_DELIVERY` для заказа `SHIPPED`, иначе `MANUAL_REVIEW` |
| Все отправления доставлены, список непустой | `RETURN_AFTER_DELIVERY` |
| Доставлена часть отправлений | `MANUAL_REVIEW` |
| Все отправления возвращены, список непустой | `FINALIZE_RETURN` |
| Вернулась часть отправлений или есть `UNKNOWN` | `MANUAL_REVIEW` |
| Заказ `SHIPPED` или хотя бы одно отправление имеет `SHIPPED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `EXCEPTION` | `INTERCEPT_DELIVERY` |
| Хотя бы один платёж `PENDING` | `MANUAL_REVIEW` |
| Есть успешный платёж | `REFUND_BEFORE_SHIPPING` при ровно одном `SUCCEEDED`, его сумме, равной `finalAmount`, и `paymentType === 'CARD'`. Иначе `MANUAL_REVIEW`. |
| `PAID` или `PROCESSING` без успешного платежа | `MANUAL_REVIEW` |
| Остался `DRAFT` или `PENDING_PAYMENT` | `DIRECT_CANCEL` |
| Прочие случаи | `MANUAL_REVIEW` |

Например, для `PENDING_PAYMENT` с `shipments: []` и `payments: []` результат — `{ route: 'DIRECT_CANCEL', hasSucceededPayment: false }`. При добавлении незавершённого платежа результат меняется на `{ route: 'MANUAL_REVIEW', hasSucceededPayment: false }`. Для `PAID`, `CARD`, `finalAmount: 2500`, `shipments: []` и одного `SUCCEEDED` на 2500 получается `{ route: 'REFUND_BEFORE_SHIPPING', hasSucceededPayment: true }`. Если при тех же данных отправление уже `IN_TRANSIT`, логистическая ветка срабатывает раньше платежной и возвращает `INTERCEPT_DELIVERY`. Данные примеров условные. [Развилки плана](../../src/modules/orders/core/order-policy.ts#L109)

`getOrderCancellationEligibility(order)` превращает маршрут в `{ allowed, reason }` для прямой отмены. Только `DIRECT_CANCEL` даёт `{ allowed: true, reason: 'ALLOWED' }`. Для остальных маршрутов `allowed: false`, а причины распределены так: `ALREADY_CANCELLED → ALREADY_CANCELLED`, `INTERCEPT_DELIVERY → ALREADY_SHIPPED`, `RETURN_AFTER_DELIVERY → ALREADY_DELIVERED`, `REFUND_BEFORE_SHIPPING` и `FINALIZE_RETURN → REFUND_REQUIRED`, `MANUAL_REVIEW → UNSUPPORTED_STATUS`. Это решение о вызове прямой отмены, а для финансового возврата действует собственная проверка ниже. [getOrderCancellationEligibility](../../src/modules/orders/core/order-policy.ts#L213)

### Как регистрируется обращение

`OrderCancellationCaseService.createOrGet(userId: string, chatId: string, orderId: string): Promise<OrderCancellationCaseReceipt>` вызывается с ID пользователя и чата из контекста и ID выбранного заказа. Сервис читает заказ с проверкой владельца и пересчитывает маршрут. Для `ALREADY_CANCELLED` и `DIRECT_CANCEL` выбрасывает `ConflictException`. Ошибка поиска заказа также передаётся вызывающему коду. [createOrGet](../../src/modules/orders/cancellation/order-cancellation-case.service.ts#L82) · [Вызов после подтверждения](../../src/support-agent/graph/workers/order-agent.worker.ts#L555)

1. `createCaseIssue(order)` формирует строку с публичным номером или подписью «без публичного номера», а затем отдельной строкой добавляет внутренний ID.
2. Транзакция блокирует строку `Chat` с указанными `chatId` и `userId`. Если подходящей строки нет, выбрасывается `ForbiddenException`.
3. Под блокировкой выполняется поиск по `userId`, `chatId`, причине `CUSTOMER_REQUEST`, точной строке `issue` и статусу `WAITING_OPERATOR` либо `IN_PROGRESS`. Из совпадений берётся самое свежее. В таком случае возвращается его ID с `alreadyExists: true`.
4. При отсутствии совпадения создаётся `SupportCase(WAITING_OPERATOR)` с `reason: CUSTOMER_REQUEST`, `issue` и `summary`. `createCaseSummary` сохраняет название маршрута, статус заказа, признак успешной оплаты и сведения об отправлениях. Поле `kind` в этой записи получает Prisma default `GENERAL`.

Условный результат первого вызова:

```ts
{
  caseId: 'case-42',
  orderId: 'order-204',
  orderNumber: '204',
  route: 'REFUND_BEFORE_SHIPPING',
  alreadyExists: false,
}
```

`caseId` — ID сохранённого обращения. `orderId` и `orderNumber: string | null` берутся из записи заказа. `route` отражает план, рассчитанный при этом вызове, в том числе при переиспользовании открытого обращения. При маршруте возврата worker передаёт `caseId` в `RefundService`. Обращение фиксирует запрос покупателя. Этот сервис пишет только в `SupportCase`, поэтому результат `createOrGet` сам по себе ещё не сообщает, что изменился `Order.status`, назначен оператор или отправлен запрос в YooKassa. [Формирование issue и summary](../../src/modules/orders/cancellation/order-cancellation-case.service.ts#L38) · [Запись SupportCase](../../src/modules/orders/cancellation/order-cancellation-case.service.ts#L101) · [SupportCase в Prisma](../../prisma/schema.prisma#L60)


### Как оформляется полный возврат до отправки

`RefundService.cancelAndRefund(userId: string, orderId: string, caseId: string): Promise<RefundStatus>` получает ID владельца и заказа, а также `caseId` из результата `createOrGet`. Сервис сначала фиксирует отмену и намерение вернуть деньги в PostgreSQL, затем обращается к YooKassa. `RefundStatus` имеет три значения: `PENDING`, `SUCCEEDED`, `CANCELED`. Статус заказа при отмене пишется как `CANCELLED` с двумя `L`. [cancelAndRefund](../../src/modules/orders/refund/refund.service.ts#L39) · [Модель Refund](../../prisma/schema.prisma#L354)

1. **Подготовка в транзакции.** Сервис блокирует строку заказа с помощью `lockCurrentStoreOrder` и читает её по `orderId` и `userId` с платежами, отправлениями и возможным возвратом. Отсутствующий и чужой заказ приводят к `NotFoundException`. Если `Refund` уже есть, сервис переиспользует его только при `Order(CANCELLED)` и наличии соответствующего платежа. Несогласованные данные дают `ConflictException`.
2. **Проверки перед созданием.** Для нового возврата требуются `Order(PAID | PROCESSING)`, `paymentType === 'CARD'`, отсутствие отправленных посылок, отсутствие `Payment(PENDING)` и ровно один `Payment(SUCCEEDED)`. Отправления должны быть все `PENDING` и с `shippedAt: null`, допускается пустой список. Сумма платежа должна быть положительной и равняться `finalAmount`, а `providerPaymentId` не должен начинаться с `reservation:`. При нарушении проверок выбрасывается `ConflictException`. Это более строгие условия исполнения, чем условия выбора маршрута.
3. **Запись в PostgreSQL.** В той же транзакции создаётся `Refund(PENDING)` с суммой из платежа и сохранённым `idempotenceKey: randomUUID()`. `Order.status` устанавливается в `CANCELLED`. Один `orderId` и один `paymentId` могут быть связаны каждый только с одной записью `Refund` по ограничениям Prisma. Ключ используется для повторного обращения к провайдеру в рамках той же операции. В таблице `Refund` сохраняются связи с заказом и платежом. `caseId` остаётся аргументом текущего вызова и используется позже для закрытия обращения.
4. **Обращение к YooKassa после фиксации транзакции.** Уже успешный `Refund` приводит к вызову `resolveCase` и возврату `SUCCEEDED`. При `CANCELED` сервис возвращает это значение. Для `PENDING` с `providerRefundId` выполняется `getRefund`. Для `PENDING` без него выполняется `createFullRefund` с сохранённым ключом, если возраст записи в диапазоне от 0 до 23 часов, исключая верхнюю границу. Иначе код пишет предупреждение о ручной сверке и возвращает `PENDING`.
5. **Сохранение ответа.** `saveResult` требует ID возврата, совпадение `payment_id` и суммы и валюту `RUB`. Затем переводит `pending/succeeded/canceled` в локальный `RefundStatus` и условно обновляет запись по `id` и `status: PENDING`. Сохраняет `providerRefundId` и выбранные поля ответа. При `SUCCEEDED` метод `resolveCase` переводит кейс указанного пользователя из `WAITING_OPERATOR` в `RESOLVED` и заполняет `closedAt`. Это отдельная запись после обновления возврата.
6. **Ошибки.** Ошибки транзакционной подготовки выходят из метода. Сбои внутри `try` при запросе к провайдеру или обработке его ответа логируются и дают `PENDING` как возвращаемое значение. Предварительная фиксация `Order(CANCELLED)` уже произошла. Ветка существующего `SUCCEEDED` вызывает `resolveCase` до этого `try`, поэтому возможное исключение оттуда передаётся вызывающему коду.

[Проверки и запись](../../src/modules/orders/refund/refund.service.ts#L44) · [Выбор запроса после commit](../../src/modules/orders/refund/refund.service.ts#L133) · [Сохранение ответа и закрытие обращения](../../src/modules/orders/refund/refund.service.ts#L190)

`YookassaService` отвечает за HTTP. `createFullRefund({ providerPaymentId, amount, idempotenceKey })` валидирует непустой ID исходного платежа, положительную целую безопасную сумму и непустой ключ длиной до 64 символов. При неверных аргументах выбрасывает `BadRequestException`. Отправляет `POST /refunds` с `Idempotence-Key`, `payment_id` и `amount: { value: amount.toFixed(2), currency: 'RUB' }`. `getRefund(providerRefundId)` требует непустой ID, кодирует его в URL и делает `GET /refunds/{id}`. Оба метода возвращают типизированный `YookassaRefundResponse` с ID возврата, ID платежа, статусом, суммой и датой. `parseResponse` сначала читает JSON и при неуспешном HTTP-ответе выбрасывает `BadGatewayException`. Проверку соответствия ответа сохранённому платежу выполняет `RefundService.saveResult`. [Ответ провайдера](../../src/payment/yookassa/yookassa.service.ts#L59) · [POST возврата](../../src/payment/yookassa/yookassa.service.ts#L172) · [GET возврата](../../src/payment/yookassa/yookassa.service.ts#L221) · [Разбор ответа](../../src/payment/yookassa/yookassa.service.ts#L258)

Условный пример для заказа №204 с суммой 2500, одним успешным платежом `pay-204` и без отправлений:

| Шаг | Данные после шага |
| --- | --- |
| Создание обращения | `SupportCase(case-42, WAITING_OPERATOR)`. |
| Commit подготовки возврата | `Order(order-204, CANCELLED)`, `Refund(order-204, amount: 2500, PENDING)` с ключом. |
| Запрос | `POST /refunds`, тело `{ payment_id: 'pay-204', amount: { value: '2500.00', currency: 'RUB' } }`. |
| Если YooKassa вернул `succeeded` с совпавшими данными | `Refund(SUCCEEDED)`, сохранён ID возврата провайдера. При обращении в `WAITING_OPERATOR` оно становится `RESOLVED`. Метод возвращает `SUCCEEDED`. |
| Если вернул `pending` с совпавшими данными | `Refund(PENDING)` с сохранённым ID провайдера. Следующий прямой вызов сервиса при таком состоянии использовал бы `getRefund`. |

В коде подтверждения отмены worker ожидает `cancelAndRefund`, но не использует его возвращаемый статус при построении текста. В этой ветке `ConflictException` перехватывается, прочие исключения передаются выше. `cancellationAcceptedMessage(order)` сообщает о принятии запроса. Если покупатель снова явно указывает уже отменённый заказ, `ALREADY_CANCELLED` завершает обработку до вызова возврата. Сам сервис умеет переиспользовать запись `Refund`, но такой повторный запрос в чате до этого кода не доходит. Пример показывает развилки исходного кода. Фактические ответы провайдера, состояние БД и фоновое исполнение этим примером не проверяются. [Проверка при выборе цели](../../src/support-agent/graph/workers/order-agent.worker.ts#L433), [вызов и ответ worker](../../src/support-agent/graph/workers/order-agent.worker.ts#L555)

## Ошибки и границы реализации

### Где останавливается запрос

| Ситуация | Что происходит |
| --- | --- |
| Пользователь не проходит проверку сокета или доступа к чату | Запрос не допускается к order-узлам. [WsJwtGuard](../../src/modules/auth/guards/ws-jwt.guard.ts#L15), [assertUserCanAccessChat](../../src/modules/chat/chat.service.ts#L120) |
| `value` не соответствует общей resume-схеме | Gateway отклоняет его на `parse` до записи пользовательского сообщения. [resumeClarification](../../src/modules/chat/chat.gateway.ts#L532) |
| `value` соответствует общей схеме, но паузы нет или для заказа пришёл неподходящий вариант | Сообщение пользователя может уже быть сохранено и подтверждено ACK. Сервис проверяет наличие паузы, а узел проверяет тип ответа и допустимый `questionId`. [SupportAgentService.resume](../../src/support-agent/support-agent.service.ts#L128), [проверка опции](../../src/support-agent/graph/workers/order-agent.worker.ts#L549) |
| Публичный номер неизвестен покупателю | Чтение возвращает `null`. Worker формирует обычный ответ о том, что заказ не найден. Для отсутствующего или чужого внутреннего ID адаптер выбрасывает исключение. [Чтение по ID и номеру](../../src/modules/orders/adapters/current-store-order.adapter.ts#L98) |
| Между чтением и прямой отменой состояние изменилось | Повторная доменная проверка может дать `BadRequestException`. Если условное обновление не нашло строку для отмены, сервис выдаёт `ConflictException`. [OrdersService.cancelOrder](../../src/modules/orders/orders.service.ts#L125) |
| Автовозврат вернул `ConflictException` | Worker перехватывает конфликт именно вокруг `cancelAndRefund` и отвечает о принятой заявке. Конфликт при создании самого обращения и другие ошибки этого вызова worker не перехватывает. [Обработка подтверждения](../../src/support-agent/graph/workers/order-agent.worker.ts#L569) |

Для исключений внутри `runAssistant` и `runAssistantResume` Gateway пишет ошибку в лог и обычно отправляет клиенту `chat:error`. `retryable` классифицирует сбой для клиента. Например, таймаут или `429` могут дать `true`, обычная ошибка проверки ID подтверждения — `false`. Само событие не запускает повтор. Конфликты, распознанные как устаревший результат из-за изменения чата, отбрасываются отдельно. [Классификация](../../src/modules/chat/chat.gateway.ts#L61), [обработка ошибок запуска](../../src/modules/chat/chat.gateway.ts#L690), [событие ошибки](../../src/modules/chat/chat.gateway.ts#L927)

### Незавершённые и спорные места

- **Контракт действий шире worker.** `RETURN_REQUEST`, `EXCHANGE_REQUEST` и `CLAIM_REQUEST` валидны для роутера, но активный worker заканчивает их ошибкой. Схема `ClarificationOptionSchema` также допускает карточку `order`. Показанные order-узлы её не заполняют. [Действия](../../src/support-agent/schemas/order-request.schema.ts#L3), [конец worker](../../src/support-agent/graph/workers/order-agent.worker.ts#L451), [схема опции](../../src/support-agent/schemas/clarification-response.schema.ts#L39)
- **Маршрут для ручной обработки фиксирует обращение.** Ветки `INTERCEPT_DELIVERY`, `FINALIZE_RETURN`, `RETURN_AFTER_DELIVERY` и `MANUAL_REVIEW` доходят до `SupportCase(GENERAL)`. В этой цепочке нет команды перевозчику, операции возврата товара или перехода Chat в `OPERATOR`. Очередь handoff выбирает обращения вида `HANDOFF`. [Ветвление](../../src/support-agent/graph/workers/order-agent.worker.ts#L555), [запись обращения](../../src/modules/orders/cancellation/order-cancellation-case.service.ts#L140), [отбор очереди](../../src/modules/chat/chat-handoff.service.ts#L243)
- **У ответа и финансовой операции разные гарантии.** Текст о принятой заявке одинаков для успешного, ожидающего и некоторых конфликтных исходов автовозврата. Метод умеет перечитать уже зарегистрированный возврат, но обычный повтор диалога по `CANCELLED` заканчивается раньше этого вызова. По текущему дереву не найден отдельный вызов для автоматической сверки этих возвратов. [Итоговый текст](../../src/support-agent/graph/workers/order-agent.worker.ts#L325), [ветки worker](../../src/support-agent/graph/workers/order-agent.worker.ts#L555), [проверка существующего Refund](../../src/modules/orders/refund/refund.service.ts#L133)
- **Проверки прямой отмены различаются до транзакции и внутри неё.** Политика отправляет заказ с `Payment(PENDING)` на ручную проверку, а предикат записи адаптера исключает `SUCCEEDED`. При параллельной записи нового платежа это оставляет окно между проверкой сервиса и условным обновлением. Это вывод по условиям кода, а не воспроизведённая гонка. [Проверка плана](../../src/modules/orders/core/order-policy.ts#L165), [предикат записи](../../src/modules/orders/adapters/current-store-order.adapter.ts#L199)
- **Resume зависит от повторяемости ветвления.** Список кандидатов и условия показа кнопок вычисляются заново. Если за время ожидания изменились строки, порядок или состав страницы, прежний ID может не пройти проверку. Отказ при таком расхождении виден в коде. Поведение при конкурирующих запросах на разных экземплярах приложения не проверялось. [Повторное построение страницы](../../src/support-agent/graph/workers/order-agent.worker.ts#L251), [повторное чтение при подтверждении](../../src/support-agent/graph/workers/order-agent.worker.ts#L484)

Справочник проверен чтением исходников и установленного LangGraph. В `package-lock.json` закреплён `@langchain/langgraph` 1.4.9. Не подтверждались реальные решения модели на примерах, доставка и отображение событий на клиенте, применение локальных миграций, восстановление checkpoint после сбоя и результат возврата в YooKassa. [Версия LangGraph](../../package-lock.json#L3516)
