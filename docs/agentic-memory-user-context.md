# Agentic Memory и User Context

**Эпизод** — сохранённое состояние одной задачи подбора в одном источнике консультации. Покупатель может вернуться к прежним условиям или начать отдельный подбор. **Подтверждённое предпочтение** — явно сохранённый покупателем факт для его профиля в конкретном магазине. Эпизод принадлежит источнику и задаче, факт — покупателю и магазину. Сроки жизни различаются.

## От сообщения до записи

1. Покупатель просит подобрать синие кроссовки Aurora до 6000 ₽. `ChatService` сохраняет сообщение и создаёт допуск с идентификатором попытки, последовательностью сообщения и версией передачи оператору. `ChatGateway` получает актуальный снимок памяти через `getBasis`.
2. ProductAgent и Workspace ведут рабочие задачи подбора. `compileConsultationMemoryObservations` связывает допустимые цели и критерии с текущим источником, проверяет профиль и формирует изменения рабочего состояния. Цель обозначает назначение подбора. У NextShop `profileId` — семейство атрибутов, например `SHOES`. Адаптер в v2 записывает тот же идентификатор в `goalKey`. Во внешнем каталоге `profileId: "WORKSTATION"` и `goalKey: "rendering"` могут различаться. Рассмотренные, сравнённые и рекомендованные товары приходят как ссылки из подтверждённых действий и проверенной выдачи. При восстановлении каталог снова проверяет цены и наличие.
3. После успешного хода ProductAgent передаёт кандидата `ConsultationMemoryCandidate`. `nextShopMemoryCandidate` переводит атрибуты в каноническую форму. `ChatGateway` сначала сохраняет и публикует обычный ответ. После этого `ConsultationMemory.project` в отдельной транзакции проверяет владельца, актуальность допуска, ревизии, эпоху памяти, источник ответа и квитанцию повтора. Сбой этой транзакции оставляет обычный ответ доступным.
4. `start` создаёт эпизод с новым `taskKey`. `update` изменяет существующий открытый эпизод при актуальном основании. Критерии объединяются по паре `attributeId` и `operator`. `considered` пополняется с удалением дублей и лимитом 20, переданные `compared` и `recommended` заменяют соответствующий список. `outcome` закрывает эпизод. Показ карточки, отказ и клик «Продолжить» сами по себе срок не продлевают.

Пример канонического входа после публикации ответа. Идентификаторы и значения иллюстративные.

```json
{
  "sourceMessageId": "customer-entry/1",
  "changes": [{
    "taskKey": "workstation",
    "kind": "start",
    "criteria": {
      "profileId": "WORKSTATION",
      "goalKey": "rendering",
      "set": [
        {"attributeId": "cpuVendor", "operator": "eq", "value": "acme", "unit": null},
        {"attributeId": "ramGb", "operator": "gte", "value": 32, "unit": "GB"}
      ]
    },
    "considered": ["pc-01", "pc-04"],
    "compared": ["pc-01", "pc-04"],
    "recommended": ["pc-01"]
  }]
}
```

### Поля и жизненный цикл эпизода

| Поле | Тип и смысл |
| --- | --- |
| `storeKey`, `subjectKey`, `sourceKind`, `sourceKey` | Строки. Ключ области памяти объединяет магазин, владельца, вид и ID источника. NextShop преобразует пользователя и чат в эти поля. |
| `id`, `taskKey`, `type` | ID эпизода, ID задачи внутри источника, тип `PRODUCT_SELECTION`. |
| `status`, `outcome`, `closedAt` | Хранимый статус `OPEN` или `CLOSED`. Для открытого эпизода после 14 суток API вычисляет `PAUSED`. Результат nullable: `PRODUCT_SELECTED`, `NO_MATCH`, `USER_CANCELLED`, `FINISHED_UNSPECIFIED`. `closedAt` задаётся при закрытии. |
| `snapshot`, `schemaVersion` | Канонический снимок и версия хранения. v1 без `goalKey`, v2 допускает его. Reader принимает обе версии. Версия хранения остаётся внутри адаптера и не является полем HTTP-представления. |
| `profileId`, `goalKey`, `constraints` | Профиль nullable, цель необязательна и nullable. Критерий содержит ключ атрибута, `eq/contains/lte/gte`, строку, конечное число или boolean и nullable-единицу. В patch опущенное поле сохраняется, `null` сбрасывает профиль или цель, `clear` удаляет критерий. |
| `considered`, `compared`, `recommended`, `lastSourceMessageId` | Массивы ссылок до 20, 20 и 5 соответственно. Nullable ID сообщения привязывает снимок к подтверждённому источнику. |
| `revision`, `contentRevision` | Целые версии для проверки актуальности и подавления повторного предложения одной и той же версии содержимого. Исправление принимает ожидаемую `revision`. |
| `lastMeaningfulAt`, `expiresAt` | Даты, в HTTP передаются в ISO 8601. Граница TTL — ровно 90 суток после последнего подтверждённого изменения. |
| `memoryEpoch`, `purgedThroughSeq`, `offerSuppressedUntil` | Служебные поля области. Эпоха и порог входов защищают от устаревших операций, дата подавляет предложения после отказа. |

На 7-е сутки без содержательной активности может появиться предложение незавершённого подбора. После «Не сейчас» действует пауза в 7 суток и та же версия содержимого повторно не предлагается. «Продолжить» возвращает одноразовую привязку для явного следующего хода. После 14 суток эпизод приостановлен и всё ещё доступен для продолжения. На границе 90 суток эпизод сразу исключается из чтения, восстановления и нового подтверждения. Следующая почасовая очистка физически удаляет просроченную строку и её предложения. Очистка также обрабатывает просроченные квитанции.

### Явное подтверждение предпочтения

Покупатель подтверждает критерий отдельной командой `UserContext.confirm`. Адаптер проверяет аутентификацию, формирует доверенные `storeKey` и `subjectKey`. В транзакции приложение сверяет живой источник и его ревизию, применяет `PreferencePolicy`, берёт значение из эпизода, сохраняет факт и увеличивает ревизию профиля. NextShop разрешает `color/eq` для профилей `SHOES`, `CLOTHES`, `ACCESSORIES`. Синтетический магазин использует `WORKSTATION/cpuVendor`. Пустой профиль имеет `revision: 0` и `facts: []`.

| Поле | Тип и смысл |
| --- | --- |
| `domainKey`, `preferenceKey`, `value` | Две строки идентифицируют факт внутри профиля. Значение — строка, число или boolean. Новое подтверждение той же пары может заменить значение и его источник. |
| `confirmation`, `commandId` | Факт имеет состояние `CONFIRMED`. UUID команды позволяет повторить текущее подтверждение с тем же источником без повторной записи. |
| `source` | `sourceKind`, `sourceKey`, `episodeId`, `episodeRevision`, `criterion` фиксируют происхождение. |
| `observedAt`, `confirmedAt`, `updatedAt` | Момент содержательного изменения источника, момент подтверждения, момент записи факта. |
| `expectedRevision`, `revision` | Ожидаемая и текущая целочисленные ревизии профиля. При конфликте перечитайте профиль. |

Факт живёт независимо. Плановая очистка вызывает `purgeExpired` и сохраняет факт. Явное удаление источника удаляет факты с этим источником. Исправление отзывает связанные факты, если подтверждённый критерий удалён или изменён либо изменён профиль эпизода. Отзыв и правка выполняются в одной транзакции. Можно удалить один факт или весь профиль напрямую. Отзыв старого источника не затрагивает факт, который покупатель уже подтвердил по другому эпизоду.

## API NextShop

Операции выполняются через штатную авторизацию. Владелец и магазин выводятся на сервере. Неверный ввод даёт HTTP 400, отсутствующая сессия 401, запрет роли 403 для User Context, отсутствующий или чужой источник 404 и конфликт ревизий 409. Для хоста, отличного от NextShop, классы приложений возвращают типизированные доменные ошибки, а конкретные коды устанавливает inbound-адаптер.

| Операция | Вход и результат |
| --- | --- |
| `GET /chat/:chatId/consultation-episodes` | До 100 действующих эпизодов владельца, сначала недавно изменённые. В снимок ответа входят публичные поля эпизода, указанные выше, без `scopeId`, `schemaVersion` и `closedAt`. |
| `PATCH /chat/:chatId/consultation-episodes/:episodeId` | `{"revision":1,"change":{"criteria":{"set":[{"attributeId":"color","operator":"eq","value":"зелёный","unit":null}]}}}`. Возвращает обновлённый эпизод. |
| `DELETE /chat/:chatId/consultation-episodes/:episodeId` | HTTP 204. Явное удаление и отзыв источника. |
| `GET /me/user-context` | `{revision, facts}` для владельца. |
| `PUT /me/user-context/preferences/:domainKey/:preferenceKey` | Команда ниже, ответ `{revision, fact}`. |
| `DELETE /me/user-context/preferences/:domainKey/:preferenceKey?expectedRevision=N` | Удаляет указанный факт и возвращает `{revision}`. |
| `DELETE /me/user-context?expectedRevision=N` | Удаляет все факты владельца и возвращает `{revision}`. |
| Socket.IO `chat:join` | Передайте `{chatId, requestConsultationOffer: true}`. При доступном бот-чате ответ включает `consultationOffer` и `consultationIntent`. Предложение содержит `offerId`, `expiresAt`, `serverNow`, `state` и `criteria`. |
| Socket.IO `chat:consultation_resume_decision` | `{chatId, offerId, decision}`. Допустимы `continue`, `later`, `start_new`. Для `continue` ответ содержит `decision`, `continuationOfferId` и `criteria`. Устаревшая команда возвращает конфликт. |
| Socket.IO `chat:send_message` | Явный следующий ход с `continuationOfferId`. Для кнопки прежних условий также передаются `clientMessageId` и `consultationAction: "resume_unchanged"`. Критерии нового сообщения приоритетнее сохранённых. |

Пример элемента списка эпизодов NextShop на 89-е сутки.

```json
{
  "id": "10000000-0000-4000-8000-000000000003",
  "taskKey": "selection-1",
  "type": "PRODUCT_SELECTION",
  "status": "PAUSED",
  "outcome": null,
  "revision": 1,
  "contentRevision": 1,
  "lastMeaningfulAt": "2026-01-01T12:00:00.000Z",
  "expiresAt": "2026-04-01T12:00:00.000Z",
  "snapshot": {
    "profileId": "SHOES",
    "goalKey": "SHOES",
    "constraints": [
      {"attributeId": "color", "operator": "eq", "value": "синий", "unit": null},
      {"attributeId": "price", "operator": "lte", "value": 6000, "unit": null}
    ],
    "considered": ["10000000-0000-4000-8000-000000000004"],
    "compared": [],
    "recommended": [],
    "lastSourceMessageId": "10000000-0000-4000-8000-000000000005"
  }
}
```

Пример тела `PUT /me/user-context/preferences/SHOES/color`.

```json
{
  "commandId": "10000000-0000-4000-8000-000000000001",
  "expectedRevision": 0,
  "evidence": {
    "chatId": "10000000-0000-4000-8000-000000000002",
    "episodeId": "10000000-0000-4000-8000-000000000003",
    "episodeRevision": 1,
    "criterion": {"attributeId": "color", "operator": "eq"}
  }
}
```

Пример `GET /me/user-context` после подтверждения.

```json
{
  "revision": 1,
  "facts": [{
    "domainKey": "SHOES",
    "preferenceKey": "color",
    "value": "синий",
    "confirmation": "CONFIRMED",
    "source": {
      "sourceKind": "CHAT",
      "sourceKey": "10000000-0000-4000-8000-000000000002",
      "episodeId": "10000000-0000-4000-8000-000000000003",
      "episodeRevision": 1,
      "criterion": {"attributeId": "color", "operator": "eq"}
    },
    "commandId": "10000000-0000-4000-8000-000000000001",
    "observedAt": "2026-01-01T12:00:00.000Z",
    "confirmedAt": "2026-01-02T10:00:00.000Z",
    "updatedAt": "2026-01-02T10:00:00.000Z"
  }]
}
```

## Подключение независимого магазина

| Слой | Файлы и методы |
| --- | --- |
| Core памяти | [consultation-memory.core.ts](../src/consultation-memory/consultation-memory.core.ts), [memory.contract.ts](../src/consultation-memory/memory.contract.ts), [memory.policies.ts](../src/consultation-memory/memory.policies.ts). Снимок, merge, TTL, владение и актуальность предложений. |
| Application памяти | [ConsultationMemory](../src/consultation-memory/consultation-memory.application.ts). `getBasis` фиксирует текущий допуск, `assertReplyCurrent` защищает публикацию продолжения, `project` проверяет и записывает изменения. `getResumeState`, `decideResumeOffer`, `consumeResumeOffer` управляют продолжением. `list`, `correct`, `remove`, `purgeExpired` обслуживают историю. |
| Контракты профиля | [UserContext](../src/user-context/user-context.application.ts), [user-context.contract.ts](../src/user-context/user-context.contract.ts). `get`, `confirm`, `remove` и транзакционный отзыв. Тип `StoreEventV1` задаёт форму возможного события. Подписка и автоматическое применение профиля в ProductAgent в эту поставку не входят. |
| Порты | [MemoryRepository/MemoryUnit](../src/consultation-memory/memory.port.ts), `UserContextRepository/UserContextUnit`, `PreferencePolicy`. Ключи, управление транзакциями и доступ к проверенному источнику. |
| PostgreSQL | [postgres-memory-runtime.ts](../src/consultation-memory/postgres-memory-runtime.ts), [PrismaMemoryRepository](../src/consultation-memory/prisma-memory.repository.ts), [PrismaUserContextRepository](../src/user-context/prisma-user-context.repository.ts). Engine владеет таблицами областей, эпизодов, квитанций, предложений и фактов. Хост поставляет `PrismaMemorySource` и PrismaClient с миграциями этого профиля. |
| NextShop | [next-shop-memory.adapter.ts](../src/consultation-memory/next-shop-memory.adapter.ts), [next-shop-user-context.adapter.ts](../src/user-context/next-shop-user-context.adapter.ts), [ChatGateway](../src/modules/chat/chat.gateway.ts). Переводит User/Chat/Message и атрибуты магазина, обеспечивает авторизацию, запускает почасовую очистку. |

1. Аутентифицируйте запрос в хосте. Сопоставьте стабильные ID магазина, клиента и источника. Храните допуск, идентификаторы входа и ответа, последовательность, доступность помощника и подтверждённый ответ в устойчивом источнике. В PostgreSQL-адаптере реализуйте `state`, `input`, `hasReply`, `markStartNew`, `chatLink`. Для внешнего источника `chatLink` возвращает `null`. `state(..., true)` обеспечивает короткую сериализацию транзакции в хосте.
2. Соберите `createPostgresMemoryRuntime({ prisma, source, preferencePolicy, now, writeVersion })`. Сборка возвращает `memory`, `userContext` и `memoryRepository` для `bind(tx)` при транзакционном приёме продолжения. Она связывает отзыв фактов с той же транзакцией исправления или удаления эпизода. При использовании других хранилищ обеспечьте эти же гарантии через порты. Другой ORM в этой поставке не проверялся.
3. После сохранения и публикации ответа вызовите `memory.project` с допустимым кандидатом. Для прямого доступа отдавайте только данные авторизованного владельца. Планируйте `memory.purgeExpired(storeKey)` для каждого обслуживаемого магазина, проверяйте ошибки и длительность запуска. Этот Node runtime использует часы и политику, заданные хостом. Redis, Qdrant, UI и модель нужны только тем сценариям хоста, которые действительно от них зависят.

Сквозные проверки находятся в [интеграционном стенде](../infra/integration/README.md). `agentic-memory-resume.mjs` проверяет продолжение NextShop с реальным каталогом. `agentic-memory-portability.mjs` выполняет один контракт на NextShop и ПК. `agentic-memory-restart.mjs` запускает два отдельных Node-процесса над постоянными строками источника, памяти и профиля. Он проверяет день 89/90, очистку, отзыв и одинаковые внешние идентификаторы в разных магазинах.
