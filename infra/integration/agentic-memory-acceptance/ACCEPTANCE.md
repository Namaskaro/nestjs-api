
# Live Preview · ручная приёмка

Локальный инструмент для синтетических данных. Backend слушает только 127.0.0.1, проверяет состав изолированного Compose-проекта и отдельного Redis. Детерминированный AI-адаптер обслуживает сценарии без платных запросов.

## Запуск для разработчика

В backend worktree с установленными зависимостями запустите `npm.cmd run integration -- up`, `npm.cmd run integration -- migrate` и `npm.cmd run integration -- ready`. Возьмите имя проекта из результата `ready`. Подготовьте отдельный Redis для этого проекта и приватный каталог состояния вне Git. Если Redis этого стенда уже запущен, используйте его существующий `redis.json`.

```powershell
$env:ACCEPTANCE_STATE_DIR = (New-Item -ItemType Directory -Path (Join-Path $env:TEMP ([guid]::NewGuid().ToString()))).FullName
$env:ACCEPTANCE_FRONTEND = '<абсолютный путь к feature-worktree frontend>'
$project = '<support-engine-it-... из команды ready>'
if ($project -notmatch '^support-engine-it-[a-f0-9]{12}$') { throw 'Неизвестный тестовый проект' }
$password = [guid]::NewGuid().ToString('N')
$redisId = docker run -d --name "$project-acceptance-redis" --label 'support-engine.acceptance=agentic-memory-e4229ad' -p '127.0.0.1::6379' redis@sha256:fc5ecd863862f89f04334b7cbb57e93c9790478ea8188a49f6e57b0967d38c75 redis-server --requirepass $password
if ($LASTEXITCODE -ne 0) { throw 'Не удалось запустить тестовый Redis' }
$address = docker port $redisId 6379/tcp
if ($LASTEXITCODE -ne 0 -or $address -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Неизвестный адрес Redis' }
@{id = $redisId; port = [int]$Matches[1]; password = $password} | ConvertTo-Json -Compress |
  Set-Content -Encoding ascii (Join-Path $env:ACCEPTANCE_STATE_DIR 'redis.json')
node infra/integration/agentic-memory-acceptance/launch.cjs back
node infra/integration/agentic-memory-acceptance/launch.cjs front
```

Дождитесь `ACCEPTANCE_READY` в `back.log` и готовности Next.js в `front.log`. PID и конфигурация остаются в каталоге состояния. После остановки стенда повторный запуск использует прежние данные. Если Docker назначил Redis новый порт, проверьте ID контейнера и обновите только порт в `redis.json`. Для остановки сверяйте PID и команду процесса, затем останавливайте только процессы приёмки и Redis с проверенным именем.

Наборы `browser.cy.js` и `acceptance-panel.cy.js` запускайте на выделенном стенде до ручных прогонов. Они сбрасывают данные своих синтетических аккаунтов. Cypress установлен во frontend worktree.

```powershell
$acceptance = (Resolve-Path infra/integration/agentic-memory-acceptance).Path
node (Join-Path $env:ACCEPTANCE_FRONTEND 'node_modules/cypress/bin/cypress') run --project $acceptance --config-file (Join-Path $acceptance 'cypress.config.cjs') --browser electron
```

## Сценарии

[Панель приёмки](http://127.0.0.1:41820/__acceptance) · [Вход в магазин](http://127.0.0.1:41821/auth?activeTab=login)

Используйте отдельный профиль браузера для тестового магазина. В панели пароль доступен рядом с кнопкой «Копировать пароль».

## Сценарии чата

Выберите карточку в разделе Agentic Memory. Закройте открытые чаты, нажмите «Подготовить сценарий» и дождитесь сообщения о готовности. Панель установит начальный день и подготовит чат выбранного аккаунта. Для DECLINE кнопка называется «Подготовить DECLINE». Нажмите «Открыть магазин» и следуйте шагам в карточке. После смены дня обновите вкладку магазина и нажмите «Чат поддержки». «Сбросить сценарий» очищает чат указанного аккаунта. Для повтора снова нажмите кнопку подготовки.

- DECLINE. Нажмите «Подготовить DECLINE», войдите как decline@memory-v1.example.test, откройте чат и нажмите «Не сейчас». Карточка исчезнет сразу. На день 13 после перезагрузки она не появится. Для повтора снова нажмите «Подготовить DECLINE».
- PAUSED. Нажмите «Подготовить сценарий» в карточке PAUSED, войдите как paused@memory-v1.example.test. Откройте чат, нажмите «Продолжить» и введите «Поменяй бренд на Nord, цвет на зелёный и бюджет до 8000 рублей.». После Enter в выдаче должен быть Nord Green 7500.
- GUEST. В приватном окне откройте магазин и нажмите «Чат поддержки». Должно появиться «Войдите, чтобы открыть чат поддержки». История, карточка и поле ввода недоступны. Повторите после «Профиль» → «Выйти» в той же вкладке.

## User Context

Откройте [раздел User Context](http://127.0.0.1:41820/__acceptance#user-context) и выберите тестовый аккаунт. Вкладку магазина можно оставить открытой.

1. Нажмите «Сбросить тест User Context», затем «Подготовить тестовый эпизод».
2. Нажмите «Подтвердить синий цвет» и «Проверить профиль». Ожидаемый факт — «Цвет — синий · подтверждено».
3. Нажмите «Удалить предпочтение». Факт исчезнет, исходный эпизод останется.
4. Повторите шаги 1–2 и нажмите «Проверить истечение эпизода». На день 89 эпизод доступен для продолжения. На день 90 API скрывает эпизод, а цвет в профиле сохраняется. Строка эпизода может оставаться в PostgreSQL до почасовой очистки. «Вернуться к дню 0» закрывает сравнение и не меняет день магазина.
5. Повторите шаги 1–2 и нажмите «Проверить отзыв при изменении источника». Условия подбора покажут зелёный цвет, а профиль станет пустым.

Действия User Context используют реальные API со штатной тестовой авторизацией. Проверка истечения меняет время только для своих запросов. Критерии PASS/FAIL по всем сценариям приведены в панели.
