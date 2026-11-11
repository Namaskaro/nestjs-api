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

## Agentic Memory V1

После подготовки стенда прогоните целевые сценарии памяти.

```powershell
node infra/integration/agentic-memory.mjs
node infra/integration/agentic-memory-resume.mjs
```

Оба прогона используют аттестацию адресов и отдельные синтетические аккаунты. Время передаётся через управляемые часы. Для каталога тест использует Qdrant с детерминированными векторами. В штатной конфигурации включайте функцию только после применения миграции. Для включения задайте CONSULTATION_MEMORY_ENABLED=1 и стабильный CONSULTATION_MEMORY_STORE_KEY для магазина. При отключении флага обычный чат остаётся доступным. Сохраняйте прежний ключ, чтобы продолжала работать очистка и владелец мог удалить свои записи.

Для ручной приёмки подключите согласованные ревизии backend и frontend к изолированному окружению. Полный AppModule дополнительно требует изолированный Redis, настройки аутентификации и провайдеры для выбранных сценариев. Используйте синтетические аккаунты и подборы. В тестовом запуске подмените CONSULTATION_MEMORY_CLOCK управляемыми часами, чтобы открыть чат после 7 суток, проверить «Не сейчас», отдельным сценарием продолжить и обновить бренд, цвет и бюджет. Проверьте две вкладки, reconnect, новый независимый подбор и гостевой чат. Клиентский клик не запускает поиск. После прогона остановите выделенный стенд.

При диагностике сбоя сверяйте предупреждения Consultation memory projection failed и Consultation memory projection skipped: stale. Сохранённый ответ с expectsEpisodeProjection=true и без ConsultationTurnReceipt по assistantMessageId после завершения попытки обозначает пропущенную проекцию. Не воспроизводите LLM-вызов для её восстановления. Явное продолжение привязывается к последней сохранённой ревизии эпизода.

## Agentic Memory и User Context · переносимость

После миграции выполните общий контракт на двух источниках:

```powershell
node infra/integration/agentic-memory-portability.mjs
```

NextShop использует проверенный Chat/Message и настоящий каталог в agentic-memory-resume.mjs. Синтетический источник ПК имеет собственный формат идентичности, критерии и небольшой каталог. Он подключается к тому же приложению памяти и User Context, записывает состояние в PostgreSQL без связи с Chat и использует управляемое время.

CONSULTATION_MEMORY_WRITE_V2=1 включает запись снимков v2. Reader принимает v1 и v2. Для отката записи выключите флаг на совместимой ревизии, которая уже читает обе версии. Применённые миграции сохраняются. USER_CONTEXT_ENABLED=1 включает подтверждение. Чтение, удаление и отзыв уже сохранённых фактов доступны при выключенной записи с тем же ключом магазина.

User Context использует штатную сессию владельца:

- GET /me/user-context возвращает revision и facts.
- PUT /me/user-context/preferences/SHOES/color подтверждает цвет. Тело содержит commandId (UUID), expectedRevision и evidence с chatId, episodeId, episodeRevision и criterion = { attributeId: "color", operator: "eq" }. Значение выбирается из эпизода.
- DELETE /me/user-context/preferences/SHOES/color?expectedRevision=N и DELETE /me/user-context?expectedRevision=N удаляют факт или весь профиль. После конфликта получите актуальную ревизию. Повтор команды с тем же commandId и источником возвращает уже сохранённый факт.
- Плановое истечение эпизода не меняет профиль. Явное исправление соответствующего критерия или удаление эпизода отзывает факт с этим источником.

В preview используйте обычный вход. JwtGuard проверяет подпись, WsJwtGuard читает актуальную роль из базы. Сценарии, часы, локальный AI и полный набор сервисов описаны в инструкции приёмки. Проверьте два подключения к одному чату и сохранение истории при новом подборе. Для диагностики проверяйте метки проекции памяти и ошибки запроса профиля.
