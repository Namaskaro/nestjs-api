# Support Engine — Portability Checklist

## Как применять

Укажи возможность, branch/SHA, состояние рабочей копии, профиль поставки,
заявленные интеграции, затронутые порты, активный путь и владельцев данных.
Для каждого критерия укажи `PASS`, `FAIL`, `NOT VERIFIED`, `BLOCKED`
или `N/A` с причиной. Различай чтение кода, текущий прогон и исторический
отчёт с его SHA и профилем. Для прогона запиши команду, версии сервисов,
фикстуры и результат. Применимый обязательный критерий с `FAIL`,
`NOT VERIFIED` или `BLOCKED` исключает PASS gate.

| Gate | Что подтверждает | Обязательное свидетельство |
| --- | --- | --- |
| `MILESTONE_GATE` | Работоспособность значимого этапа в его scope | Проверены wiring, критерии этапа и регрессии. Для работы с PostgreSQL/Qdrant выполнены релевантные функциональные сценарии G. |
| `PORTABILITY_GATE` | Возможность заменить адаптер затронутой границы | Подтверждены применимые критерии A–F по переносимости. Общий набор G прошёл с действующим и независимым адаптерами без правок CORE/APPLICATION. Для клиентской границы проверен независимый клиент. |
| `RELEASE_GATE` | Готовность конкретного кандидата в заявленном профиле | Пройдены все применимые обязательные milestone и portability gates, совместный прогон и эксплуатационные критерии H. |

Статусы записываются раздельно. PASS узкого gate не распространяется
на весь продукт. `production-ready` допустим только при `RELEASE_GATE: PASS`
в явном scope. Статус не разрешает deployment, миграцию или платные вызовы.

## A. Core independence

- [ ] Domain rules do not import NextShop services or models.
- [ ] Application logic does not depend on concrete adapters.
- [ ] Фактический wiring, включая транзитивные вызовы, соответствует
      карте CORE / APPLICATION / PORT / ADAPTER / INFRASTRUCTURE / STORE-OWNED.
- [ ] Core contracts do not expose Prisma-generated types.
- [ ] Core does not depend on frontend frameworks.
- [ ] Core does not depend on NestJS transport objects.
- [ ] LLM integration is replaceable.
- [ ] Embedding integration is replaceable.
- [ ] Vector-search integration is replaceable.
- [ ] Infrastructure errors are mapped to application-level
      outcomes where appropriate.

## B. External integrations

- [ ] External system boundaries are identified.
- [ ] Required outbound ports are defined.
- [ ] Existing compatible ports are reused.
- [ ] External data is converted to canonical models.
- [ ] External IDs are preserved and correctly mapped.
- [ ] Missing or unsupported source capabilities are handled.
- [ ] Source synchronization supports updates and deletions.
- [ ] Source freshness and provenance are tracked where needed.
- [ ] External write operations are authorized.
- [ ] State-changing operations have appropriate idempotency
      and error-recovery handling.

## C. Client independence

- [ ] Public responses are structured and versioned.
- [ ] Responses do not require Next.js or React.
- [ ] UI components do not define domain contracts.
- [ ] Chat session and message flows are transport-neutral.
- [ ] Streaming events have documented semantics.
- [ ] Error contracts are consistent.
- [ ] Client actions are validated by the server.

## D. Data and infrastructure

- [ ] Engine-owned data is separate from commerce source data.
- [ ] PostgreSQL dependencies stay outside the pure core.
- [ ] Qdrant dependencies stay outside the pure core.
- [ ] Optional infrastructure is documented.
- [ ] Tenant isolation applies to persistence and search.
- [ ] Secrets and provider configuration are externalized.
- [ ] Background jobs support retries and recovery.
- [ ] Data lifecycle and deletion requirements are defined.
- [ ] The capability can run without the NextShop frontend.
- [ ] Зависимости внутреннего профиля Engine перечислены отдельно от
      требований к магазину; вторая внутренняя СУБД не требуется.

## E. AI processing

- [ ] LLM-specific request/response formats stay in adapters.
- [ ] Models can be replaced without rewriting domain logic.
- [ ] Embedding models and index versions are tracked.
- [ ] Reindexing or migration strategy is documented.
- [ ] Generated claims retain appropriate source evidence.
- [ ] Unavailable AI providers produce defined failures
      or supported fallback behavior.
- [ ] No hidden dependency on test-only LLM behavior exists.

## F. Capability-specific checks

### Product Consultant

- [ ] Product retrieval uses replaceable integrations.
- [ ] Catalog enrichment is independent of the source DB.
- [ ] Product variants and attributes use canonical mappings.
- [ ] Search results respect tenant and source freshness.

### Review Intelligence

- [ ] Review retrieval is not tied to NextShop Prisma services.
- [ ] Evidence includes verifiable source references.
- [ ] Review publication changes invalidate affected results.
- [ ] Summaries and Q&A support different review providers.
- [ ] Frontend cards consume public structured artifacts.

### Agentic Memory

- [ ] Memory does not require NextShop-specific User/Chat types.
- [ ] External customer identity mapping is explicit.
- [ ] Retention and deletion work independently of the store.
- [ ] Memory is isolated by tenant and authorized user.
- [ ] Store-originated events are optional, not mandatory.

### User Context

- [ ] Профиль отделён от диалога и эпизодов. Идентичность,
      подтверждение, ревизии, отзыв и удаление проверяются отдельно.
- [ ] Внешний сигнал имеет происхождение и версию; неподдерживаемые
      события не требуются для работы профиля.

### Order Agent

- [ ] Order business logic uses application ports.
- [ ] Store-specific order states are mapped explicitly.
- [ ] External mutations use command adapters.
- [ ] Permissions and confirmation rules are enforced.
- [ ] Unsupported operations fail safely.

### Routing / Customer Help

- [ ] Роутер учитывает доступные возможности; типы графа не образуют
      публичный контракт. Пропуск недоступного worker проверен.
- [ ] Знания и политики магазина входят через адаптер, а чтение и
      индексирование сохраняют tenant, свежесть и происхождение.

## G. Контрактные и функциональные проверки

- [ ] Один параметризованный набор исполнен с действующим и независимым
      адаптерами **того же порта**. Второй источник имеет собственную
      исходную форму, ID и маппинг. Покажи замену на реальном пути
      от use case до эффекта. Моки с готовыми каноническими записями
      недостаточны. Переиспользуй существующую тестовую инфраструктуру.
- [ ] Проверены успех, отсутствие или неполнота данных, чужой владелец,
      совпадающий внешний ID другого tenant, отсутствующая возможность,
      ошибка доступа и недоступность. Где применимо, проверь дубликат,
      позднее событие, изменение и удаление, конфликт версий и запись
      без повторного эффекта.
- [ ] Публичный контракт проверен независимым клиентом без UI NextShop:
      версия, артефакты, ошибки, повтор команд, reconnect, порядок и
      повтор доставки в заявленном объёме.
- [ ] Для PostgreSQL/Qdrant использованы инструкции
      [Shared Integration Test Environment](../../../infra/integration/README.md).
      Проверь прикладное поведение на настоящих изолированных сервисах.
      Smoke инфраструктуры и моки не подтверждают прикладной сценарий.
- [ ] Если второй источник синтетический, отмечены непроверенные реальные
      API, права, лимиты и побочные эффекты. Результат не переносится на
      другие возможности или внешние интеграции.

## H. Допуск к production

- [ ] Зафиксированы версия и поддерживаемые профили. Интегратор по инструкции
      устанавливает Engine с нуля без NextShop, с миграциями, конфигурацией,
      диагностикой и секретами вне кода. Проверены перезапуск и сохранность.
- [ ] Для всех заявленных реальных интеграций пройдены сценарии на их API
      (например, в sandbox): auth, права, лимиты, актуализация, операции и
      ошибки в заявленном scope. Есть приёмка интегратором или потребителем.
- [ ] Сквозным тестом подтверждены trusted tenant/identity, изоляция данных,
      индексов, очередей и контекста LLM, права и жизненный цикл данных.
      Конкурентные сценарии проверены на заявленной топологии.
- [ ] На кандидате проверены ключевые сценарии, отказ и восстановление с
      разрешёнными реальными зависимостями. Для AI проверены поддерживаемые
      провайдеры, качество, доказательства, бюджеты, таймауты и лимиты.
- [ ] Проверены обновление, rollback, резервное копирование и восстановление
      схем и индексов. Есть наблюдаемость, пределы эксплуатации и инструкция
      для ответственного за реакцию на сбои.
- [ ] Релизные проверки выполнены на точном кандидате или их применимость
      к нему обоснована. Незапущенный обязательный тест, несовместимый
      контракт или непройденный обязательный gate блокируют production-ready.

## I. Отчёт

В `STATE.md` или отчёте укажи карту, риски совместимости, проверенные
сценарии и открытый долг. Для каждого из трёх gates укажи статус,
критерий, артефакт или команду и следующий шаг. Если подтверждён только
NextShop или синтетический источник, явно назови этот профиль.
