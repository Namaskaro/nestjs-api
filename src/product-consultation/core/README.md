# Consultation Core

## Назначение

Consultation Core — универсальное deterministic-ядро товарной консультации.

Он не является:

- поисковым движком;
- конкретным LLM;
- базой данных;
- knowledge base;
- интерфейсом магазина;
- отдельным e-commerce provider.

Его задача — обеспечить устойчивую механику консультации:

- помнить задачи пользователя;
- помнить критерии выбора;
- помнить feedback по товарам;
- работать с подтверждёнными ProductFacts;
- отличать known от unknown;
- проверять обязательные требования;
- детерминированно сравнивать товары;
- проверять основания рекомендаций;
- формировать server-owned artifacts.

---

# Главная архитектурная граница

Consultation Core должен оставаться независимым от:

- Prisma;
- Postgres;
- Qdrant;
- Shopify;
- Bitrix;
- 1C;
- конкретной LLM;
- конкретного embedding provider;
- конкретного UI;
- конкретной товарной категории.

Core работает с универсальными контрактами.

---

# Слои

## Consultation Core

`consultation-core/`

Отвечает за универсальный алгоритм:

- memory patches;
- server-generated IDs;
- memory revisions;
- product authorization;
- relevant fact selection;
- deterministic requirement checks;
- deterministic comparisons;
- recommendation verification;
- server-owned artifacts.

Core не знает, где физически находится Product.

---

## Category Profiles

`category-profiles/`

CategoryProfile — профессиональные знания о классе товаров.

Профиль определяет:

- какие canonical attributes существуют;
- тип каждого attribute;
- canonical unit;
- допустимые операции;
- правила сравнения;
- default criteria;
- critical attributes;
- consultation guidance;
- полезные вопросы;
- references на большой knowledge corpus.

CategoryProfile не знает:

- названия таблиц;
- Prisma fields;
- API fields;
- aliases конкретного магазина;
- где физически хранится значение.

---

## Catalog Adapters

`catalog-adapters/<store>/`

Catalog Adapter знает конкретный источник данных.

Он отвечает за:

- чтение raw product record;
- mapping store fields в canonical attribute IDs;
- normalization;
- units;
- taxonomy binding;
- provenance;
- преобразование raw product в ProductDetails/ProductFacts;
- преобразование store search constraints в CanonicalRequirements.

Пример:

Store A:

`Product.details["Вес"]`

Store B:

`specifications.weight`

Store C:

`metafields.product_weight`

После adapter Core во всех трёх случаях получает:

`attributeId = "weight"`.

---

# Новый магазин

Для нового магазина обычно создаётся:

`catalog-adapters/<store>/`

Сам ConsultationCore не изменяется.

Adapter должен определить:

1. Откуда читать актуальные данные.
2. Как raw fields соответствуют canonical attributes.
3. Как значения безопасно нормализуются.
4. Какие единицы используются.
5. Как store taxonomy связывается с CategoryProfile.
6. Какие данные считаются unknown.
7. Какие данные являются conflicting.
8. Как сохраняется provenance.

Search/retrieval adapter может быть отдельным модулем.

Consultation adapter не обязан знать устройство retrieval engine.

---

# Новая категория

Для новой категории создаётся:

`category-profiles/<category>.profile.ts`

Например:

- shoes;
- clothes;
- industrial-pump;
- tractor;
- mri-scanner;
- laptop.

Профиль добавляет domain expertise.

Сам ConsultationCore не изменяется.

---

# Универсальность не означает одинаковую сложность категорий

Fashion-категория может иметь:

- один goal;
- несколько criteria;
- десяток attributes.

Сложное промышленное оборудование может иметь:

- несколько независимых goals;
- десятки criteria;
- десятки ProductFacts;
- большой corpus технической документации.

Persistent memory и полный server-side fact set не равны LLM prompt.

Core может хранить значительно больше информации,
чем получает модель за один turn.

---

# Persistent memory и LLM view

ProductContext является persistent памятью ProductAgent.

Внутри ProductNeed consultation memory хранит:

- goals;
- criteria;
- feedback.

Server-side safety limits являются защитой состояния,
а не ограничением предметной области.

LLM получает отдельную компактную проекцию.

Например сервер может хранить:

- 20 goals;
- 60 criteria;
- 80 product attributes.

Но текущий вопрос пользователя может требовать только:

- 2 relevant goals;
- 5 relevant criteria;
- 6 relevant ProductFacts.

Остальные данные не должны автоматически попадать в prompt.

Это позволяет масштабировать domain complexity
без линейного роста token cost.

---

# Goals

Goal отвечает на вопрос:

"Зачем пользователь покупает товар?"

Примеры:

- костюм на свадьбу;
- ежедневная городская ходьба;
- обработка тяжёлой почвы;
- диагностика определённого класса исследований;
- запуск локальных моделей;
- работа с конкретным производственным процессом.

Goal не является ProductFact.

Goal также не превращается автоматически в hard requirement.

Например:

"хочу использовать компьютер для AI"

не означает автоматически:

"RAM >= 64 GB".

---

# Criteria

Criterion отвечает на вопрос:

"Какое свойство пользователь хочет учитывать и каким образом?"

Примеры:

- weight <= 1500 kg;
- material = cotton;
- compatibility contains X;
- обратить внимание на noiseLevel.

Criterion может быть:

- наблюдаемым preference;
- обязательным пользовательским requirement.

Нельзя создавать обязательный numerical threshold только из общего goal.

---

# Feedback

Feedback — реакция пользователя на конкретный товар.

Примеры:

- нравится;
- не нравится;
- слишком тяжёлый;
- подходит, но дорогой.

Feedback относится к ProductNeed и productId.

Feedback не становится автоматически:

- глобальным user preference;
- фильтром бренда;
- ProductFact.

---

# ProductFact

ProductFact — подтверждённое server-side свойство товара.

Состояния:

- known;
- unknown;
- not_applicable;
- conflicting.

Unknown не означает false.

Отсутствие поля не означает not_applicable.

Known fact должен иметь provenance.

Semantic enrichment из retrieval не становится ProductFact автоматически.

---

# AgentFactView

Полный ProductFact может содержать:

- sourceId;
- recordId;
- timestamps;
- source paths;
- transformations.

Эти сведения полезны Core, observability и debug.

LLM по умолчанию получает только:

- attributeId;
- status;
- value;
- unit;
- displayValue.

Это является обязательной cost boundary.

---

# Token budget

Нельзя связывать одним числом:

- количество результатов поиска;
- количество карточек UI;
- server allow-list;
- количество ProductFacts;
- количество facts в initial LLM context;
- количество products в comparison.

Это разные ограничения.

По умолчанию ConsultationAgent должен получать небольшой relevant subset.

Дополнительные данные запрашиваются через tools только по необходимости.

Полная provenance не передаётся LLM.

Полные server artifacts не подмешиваются автоматически
в следующие prompts.

---

# Recommendation verification

LLM предлагает recommendation.

Core проверяет её.

Structured recommendation должна ссылаться на:

- requirement;
- criterion;
- goal;
- preference;
- guidance rule.

И одновременно на known ProductFact.

Концептуальная цепочка:

user need / goal / criterion
→ known product fact
→ recommendation reason.

Ссылка подтверждает существование основания и факта.

Она не доказывает автоматически семантическую истинность
свободного текста LLM.

---

# Comparison

Comparison выполняется deterministic TypeScript-кодом.

Core сравнивает факты.

LLM объясняет человеку смысл различий.

Core не создаёт:

- универсальный winner;
- fake match percentage;
- выдуманную точность.

Unknown остаётся unknown.

---

# Большая domain knowledge

Небольшая expert guidance хранится прямо в CategoryProfile.

Для большого корпуса:

- manuals;
- buying guides;
- clinical documentation;
- compatibility documents;
- size charts;
- manufacturer documentation;
- технические регламенты;

не нужно бесконечно расширять CategoryProfile.

Позже подключается отдельный bounded retrieval layer,
например `get_buying_guidance`.

Он может использовать embeddings/RAG.

Документы не становятся автоматически ProductFacts.

---

# Model agnostic

ConsultationCore не зависит от LLM provider.

LangChain, YandexGPT, OpenAI, Gemini, GigaChat,
Qwen, DeepSeek или другая модель находятся снаружи Core.

LLM wrapper должен преобразовывать стандартные
ConsultationAgent contracts в provider-specific вызов.

Provider selection не является обязанностью ConsultationCore.

---

# Database agnostic

ConsultationCore не выполняет SQL и не импортирует Prisma.

Postgres является source of truth текущего магазина,
но это свойство current-store adapter.

Другой deployment может использовать:

- another SQL database;
- document database;
- external commerce API;
- ERP;
- PIM.

Если adapter выдаёт корректные ProductDetails/ProductFacts,
Core остаётся прежним.

---

# Platform agnostic

Shopify, Bitrix, 1C, custom backend и другие commerce systems
должны подключаться через отдельные integration adapters.

Не создавать один гигантский универсальный adapter.

Catalog, cart, orders и customer data могут иметь
отдельные contracts/adapters.

---

# Как расширять систему

## Добавить Store

1. Создать `catalog-adapters/<store>/`.
2. Реализовать mapping.
3. Реализовать product adapter.
4. Связать taxonomy с profiles.
5. Проверить provenance и canonical units.
6. Не менять ConsultationCore без появления нового
   действительно универсального primitive.

## Добавить Category

1. Создать `<category>.profile.ts`.
2. Определить canonical attributes.
3. Добавить guidance/questions.
4. Зарегистрировать profile.
5. Добавить соответствующий mapping в Store Adapter.

## Добавить Attribute

1. Создать canonical definition.
2. Определить kind.
3. Определить canonical unit.
4. Определить allowed operators.
5. Определить comparison behavior.
6. Добавить mapping только в те stores,
   которые реально предоставляют это значение.

## Добавить новый универсальный тип данных

Если существующих:

- text;
- number;
- boolean;
- set;

реально недостаточно для нескольких domains,
добавляется новый generic primitive.

Это изменение Core допустимо.

Нельзя добавлять новый primitive только ради особенности
одного конкретного магазина.

---

# Consultation effectiveness

Не добавлять отдельный EvaluatorAgent только ради analytics.

Позже использовать event-based слой.

Примеры событий:

- consultation_started;
- product_recommended;
- consultation_helpful_yes;
- consultation_helpful_no;
- add_to_cart;
- order_created;
- recommended_product_purchased.

События должны иметь:

- eventId;
- timestamp;
- needId;
- user/session identity, если доступна;
- productId/orderId, когда применимо.

Покупка рекомендованного товара —
сильный business outcome.

Положительный helpful feedback без покупки —
самостоятельный positive signal.

Не вводить искусственные 100% / 50% оценки
до появления реальных данных.

Сначала сохраняются raw events.

---

# Invariants

1. ProductContext — единственная persistent product memory.
2. ProductAgent владеет commit persistent memory.
3. Один needId представляет продолжающуюся потребность.
4. CategoryProfile не знает Store schema.
5. Store Adapter не содержит consultation policy.
6. ConsultationCore не знает Prisma/Postgres/Qdrant.
7. ConsultationCore не зависит от LLM provider.
8. Semantic enrichment не является verified ProductFact.
9. Unknown не означает false.
10. LLM не создаёт server IDs.
11. Authorization выполняется server-side.
12. Allow-list не передаётся LLM без необходимости.
13. Recommendation использует только разрешённый товар.
14. Recommendation reason требует known exposed fact.
15. Hard requirements проверяются deterministic кодом.
16. Comparison не создаёт fake winner или match score.
17. Full provenance остаётся server-side.
18. Persistent memory может быть значительно больше LLM view.
19. UI result limit не равен LLM fact limit.
20. Новый Store обычно требует Adapter, а не изменения Core.
21. Новая Category обычно требует Profile, а не изменения Core.
22. Большой knowledge corpus подключается retrieval layer.
23. README не является частью LLM prompt.