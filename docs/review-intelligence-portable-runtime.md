# Review Intelligence — PORTABLE_RUNTIME

## Независимый host

`createPortableReviewRuntime` собирает существующие ReviewIndex,
ReviewSummaries, Review Q&A и review experience в обычном процессе Node.
Host передаёт подключение PostgreSQL, QdrantService, адаптер источника с
доверенным `storeId` и порты модели и embeddings. Он может встроить этот
вызов в своё расписание. AppModule, Nest-контроллеры магазина, Prisma,
Order, User и Product Consultant для запуска не требуются. Существующие
порты, публичные DTO и путь NextShop сохранены.

- `ReviewFeed` дополняет `ReviewSourcePort` и `ReviewProductLookup`.
  Источник обязан отдать непрерывную последовательность изменений с
  позиции 1 для каждого магазина и своё актуальное положение `head()`.
  `revision` растёт отдельно для каждого reviewId. Новый публичный текст
  или рейтинг требует нового publicationId. Снятие публикации передаётся
  с `rating: null`. Источник остаётся авторитетом для текста, автора и
  актуальных публичных ревизий.
- `PostgresReviewState` реализует `ReviewIndexJobs`, `ReviewSummaryJobs`
  и `ReviewExperiencePort`. В схеме `review_engine` хранятся checkpoint,
  ссылки на текущие публикации и отозванные ревизии, проекция рейтинга,
  задания, попытки, сроки и токены lease, производные Summary. Исходные
  тексты и данные покупателя читаются через источник.
- Синхронизация применяет страницу и checkpoint в одной транзакции с
  блокировкой строки магазина. Повторные и поздние ревизии пропускаются.
  Запись Summary проверяет lease, requestedVersion и версию последнего
  отзыва публикации. Если checkpoint отстаёт от источника, статистика и
  готовые сводки скрываются до синхронизации. Q&A повторно проверяет
  ссылки напрямую у источника.
- SQL-запросы состояния ограничены привязкой `storeId`. Qdrant использует
  существующий адаптер с отдельной коллекцией на магазин. Перед запуском
  нескольких воркеров host один раз вызывает `initialize()` на магазин.
  Изоляция проверяется при одинаковых product, review и publication ID.
  PostgreSQL и Qdrant доступны доверенному host. Изоляция отдельных
  недоверенных клиентов СУБД на уровне DB credentials вне этого профиля.

## Воспроизводимый запуск без NextShop

Используйте выделенный чистый проект Shared Integration Test Environment.
Проверка отклоняет БД с таблицами в `public`. Команды запускаются из
backend-копии, чей Compose project предназначен для автоматических тестов.

```powershell
npm.cmd run integration -- up
node infra/integration/portable-review.mjs verify
npm.cmd run integration -- stop
```

Команда `verify` загружает только `review_engine` и тестовую схему
`review_source_fixture`. Первый процесс создаёт и обрабатывает внешний
feed, оставляет занятые lease и отложенную попытку. Runner перезапускает
оба контейнера с сохранением томов. Второй процесс проверяет checkpoint,
записи источника, устаревшие ссылки, lease и время повтора, затем
восстанавливает обработку и очищает свои данные. Таймеры ускоряются только
после проверки сохранённых значений. Модели детерминированные.

Для подключения другого Node host примените
`src/review-intelligence/adapters/postgres-review-state.sql` отдельным
административным шагом в выделенной БД Engine. Передайте `pg.Pool`,
`QdrantService` и реализацию `ReviewFeed` в
`createPortableReviewRuntime`. Вызовите `initialize()`, затем по
расписанию `synchronize()` и `runPending()`. Большой feed обрабатывайте
страницами до совпадения checkpoint с head. Для запросов используйте
`experience()`, `search()` и `answer()`. При остановке вызовите
`close()`, затем закройте принадлежащий host пул. Резервная копия и
восстановление должны охватывать схему Engine и том Qdrant. Внешний feed
должен хранить историю начиная с сохранённого checkpoint.

## Результат и продуктовый аудит

Новые файлы в `src/review-intelligence`:

- `portable-runtime.ts` — точка композиции host.
- `application/review-feed.ts` — контракт изменений и авторитетных чтений.
- `adapters/postgres-review-state.ts` и `.sql` — долговечное состояние Engine.

`infra/integration/portable-review.mjs` проверяет запуск, конкуренцию,
изоляцию и перезапуск. `portable-review-fixture.cjs` представляет
внешний источник с исходными отзывами в отдельной PostgreSQL-схеме.
Оба файла используют существующий runner. Исходные файлы предыдущего
milestone сверены с резервным снимком.

| Gate | Статус и основание |
| --- | --- |
| A. Контракт | PASS. Отдельная граница входящего feed, состав конфигурации, действующие API и DTO NextShop |
| B. Архитектура | PASS. Node host запущен до Prisma-миграций. Проверка runtime imports исключает NextShop AppModule, доменные модули и Prisma |
| C. Переносимость | PASS для двух адаптеров. Внешний источник имеет свою схему, пережил перезапуск и обрабатывается теми же индексом, Summary и Q&A |
| D. Интеграция | PASS. PostgreSQL 15.18 и Qdrant 1.19.0. Новый Node-процесс восстановил checkpoint, ревизии, lease, retry и производные данные. NextShop — 11/11 интеграционных тестов, 64/64 целевых Jest, HTTP/WebSocket smoke и Cypress 1/1 |
| E. Изоляция | PASS для доверенного host. Два магазина использовали общие серверы и совпадающие ID. Состояние и выдача сохранили разделение. DB credentials для недоверенных клиентов вне профиля |
| F. Эксплуатация | PASS для перезапуска на прежних томах. Восстановление из резервной копии и обновление SQL-схемы в независимом production-окружении NOT VERIFIED |
| G. Поставка | Готово для интеграции в общий Support Engine на проверенном профиле. Production-сборка frontend имеет известный baseline prerender на `/checkout/payment-result`. Live AI передан пользователю для последующего ручного тестирования |

**DEVELOPMENT_COMPLETE. MILESTONE_GATE — PASS. RELEASE_GATE — NOT READY.**
Пользователь принял независимый runtime, детерминированные проверки и
ручную функциональную и визуальную приёмку. Готовность подтверждена для
интеграции в доверенный Node host. Для выпуска остаются production
prerender frontend, проверка восстановления из резервной копии и
обновления/отката SQL-схемы в независимом production-окружении.
Изоляция клиентов с прямым недоверенным доступом к СУБД вне проверенного
профиля. Реальные провайдеры и качество ответов переданы на отдельную
ручную проверку. [Инструкция Live AI](review-intelligence-manual-ai-testing.md)
