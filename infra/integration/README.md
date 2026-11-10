# Интеграционный стенд Support Engine

Стенд запускает PostgreSQL 15.18 с pgvector и Qdrant 1.19.0 в выделенном Docker Compose project. Идентификатор `support-engine-it-<12hex>` вычисляется из пути worktree. У каждого проекта свои контейнеры, bridge-сеть и два тома. Docker назначает свободные порты на `127.0.0.1` при запуске. Актуальные адреса показывает `ready`.

## Запуск из PowerShell

Нужны локальный Docker Desktop с Linux Engine версии 28 или выше, Compose с поддержкой `up --wait`, Node.js 22 или выше и npm. Проверено на Windows 10 22H2, Node.js 24.3, Docker Engine 29.5.3 и Compose 5.1.4. Docker context должен использовать локальный сокет. `NODE_ENV` может отсутствовать или иметь значение `test`. Выберите локальный context через `docker context use`, если текущий context удалённый.

Из корня checkout установите зависимости. `PRISMA_SKIP_POSTINSTALL_GENERATE` позволяет выполнить установку без перегенерации клиентских файлов в репозитории.

```powershell
$env:PRISMA_SKIP_POSTINSTALL_GENERATE = 'true'
npm.cmd ci
Remove-Item Env:PRISMA_SKIP_POSTINSTALL_GENERATE
```

После успешной установки выполняйте команды по порядку. Продолжайте после кода выхода `0`.

```powershell
npm.cmd run integration -- up
npm.cmd run integration -- ready
npm.cmd run integration -- migrate
npm.cmd run integration -- collections
npm.cmd run integration -- seed
npm.cmd run integration -- test
npm.cmd run integration -- contract
```

`migrate` запускает Prisma CLI из временной копии схемы и миграций с тестовым `POSTGRES_URI`. Сверка истории допускает новые миграции и учитывает LF/CRLF при проверке SHA-256 применённых файлов. `collections` создаёт `products` и `store_knowledge` с именованными `dense` (768 измерений, Cosine) и `bm25` (sparse, IDF), а также отдельную `support_integration_smoke` с трёхмерными векторами. `seed` повторяемо добавляет синтетические `User`, `Chat`, `SupportCase` и три точки в smoke-коллекцию. Для прикладных тестов с другим embedding layout нужна отдельная тестовая коллекция. Оба smoke используют детерминированные векторы.

## Остановка и очистка

```powershell
npm.cmd run integration -- stop
npm.cmd run integration -- reset
```

`stop` сохраняет данные. После `up` прежние записи доступны на вновь проверенных портах. `reset` удаляет контейнеры, сеть и оба тома данного worktree. Если сервисы остановлены, `reset` сначала запускает их для проверки идентичности и адресов. При неполном составе проекта, несоответствии меток или недоступности одного из сервисов очистка завершается ошибкой. Для параллельных наборов используйте разные worktrees. Выполняйте остановку и очистку после завершения тестов.

При ошибке готовности используйте `docker ps -a` с фильтром `label=com.docker.compose.project=<project>` и `docker logs <container>` для диагностики контейнера. При ошибке `migrate deploy` Prisma выводит имя миграции и ошибку PostgreSQL. Если изменился checksum или сохранённая история не соответствует checkout, используйте `reset` для намеренной очистки тестового состояния и затем `up` и `migrate`. При диагностике проблемы с образом или health check сохраняйте идентификатор проекта и вывод ошибки.

Перед обновлением образов выполните `reset` на прежней ревизии, затем синхронно обновите пины в `compose.yaml` и значения аттестации в `environment.mjs`. Проверьте чистый запуск, `migrate`, `test` и `contract`. Если образ уже обновлён в файлах, а контейнеры остались на старой версии, для очистки нужна прежняя конфигурация этого worktree.

## Подключение новых проверок

Проверки изолированного компонента могут импортировать `withServices` из `environment.mjs`. Функция заново аттестует окружение перед вызовом и закрывает `pool` по завершении. В callback доступны `pool`, `qdrant(method, path, body)`, `databaseUrl`, `qdrantUrl` и `qdrantApiKey`. URL и ключ предназначены для текущего callback. При проверке Nest-модуля можно передать `databaseUrl` тестовому Prisma-клиенту и переопределить `QDRANT_CLIENT` клиентом с `qdrantUrl` и `qdrantApiKey`. Используйте отдельные идентификаторы записей и коллекций на сценарий.

На этой базе можно запускать тесты Prisma-адаптеров заказов и handoff, PostgreSQL checkpointer LangGraph, запись и поиск в Qdrant и проверку изоляции payload. Проверки, которым нужны Redis, сетевые LLM/embedding-провайдеры или весь `AppModule`, требуют дополнительной конфигурации тестового модуля.

Для другого Prisma-хоста перенесите каталог `infra/integration`, npm-скрипт и зависимости `pg` и `prisma`. Хост предоставляет `prisma/schema.prisma` с `env("POSTGRES_URI")` и каталог `prisma/migrations`. После `up` и `migrate` выполните `contract`. Прикладные команды `collections`, `seed` и `test` используют `fixtures.mjs` текущего Support Engine. Для второго хоста можно подключить собственные прикладные фикстуры через `withServices`.

## Review Intelligence V2

В backend worktree Review Intelligence выполните команды по порядку в отдельной
PowerShell-сессии с `NODE_ENV=test` или без `NODE_ENV`.

```powershell
npm.cmd run integration -- up
npm.cmd run integration -- migrate
npm.cmd run integration -- contract
npm.cmd run test:integration:reviews
npm.cmd run integration -- stop
```

`contract` проверяет инфраструктуру. `test:integration:reviews` проверяет HTTP
отзывов, Prisma, настоящие индексы Qdrant, воркеры и пути ProductAgent.
Набор требует пустых таблиц отзывов и сводок и сам создаёт свои записи.
Он перезапускает оба сервиса своего Compose project, проверяет данные на новых
адресах и удаляет свои fixtures. На прогон закладывайте около минуты, включая
проверку heartbeat. Для параллельных прогонов используйте разные worktrees.
AI и reranker заменяются детерминированными подставными ответами.
Команды `collections` и `seed` для набора Review не требуются.

Для повторной проверки миграций с пустых томов используйте `reset` перед
`up` только для выделенного тестового проекта. Результаты, ограничения и
условия ручного запуска описаны в [отчёте Review Intelligence](../../docs/review-intelligence-v2-integration.md).
