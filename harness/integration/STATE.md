# Support Engine V1 — состояние интеграции

Обновлено 2026-11-14. Режим IMPLEMENTATION / INTEGRATION. Оба локальных слияния оставлены открытыми для проверки.

| Checkout | Исходный HEAD | MERGE_HEAD Agentic Memory |
|---|---|---|
| `refactor-guest` | `3f4c4f92919f219c01f9de28301e556c7f7bad8a` | `c7158919fafdf765627bf1dba8f4ee90d7919bf0` |
| `refactor-client` | `5150e24fe6d72a8845eb3d5b9e3c3fe60b8a53e8` | `9ce0fae8d9fc1eeb085d9e195ff3e0ff9dfb0789` |

Исходная ветка обоих checkout — `local/review-intelligence-test`. Исходные деревья были чистыми. В каждом checkout есть локальная ветка `integration/support-engine-v1` и тег `backup/support-engine-v1-before-integration` на исходном HEAD. Коммит требует отдельного разрешения.

## Разрешение конфликтов

- Backend — девять файлов. Объединены Prisma schema и инструкции к общему стенду. Сохранены команды Review V2, экспорты для Review Live, актуальный Agentic Memory SPEC и ссылка на первоначальный черновик. Prisma Client заново сгенерирован версией 6.3.0. Временный каталог генерации позволил сохранить побайтно идентичную Windows DLL, заблокированную для замены.
- `UserContextFact` явно сопоставлен с именем индекса в PostgreSQL. Существующие SQL миграций сохранены.
- Workspace test fixture предоставляет Review capabilities. Frozen Evaluation выдаёт пустой набор Review-данных для снимков без этих данных и не вызывает живые адаптеры.
- Frontend — автоматическое слияние, конфликтов Git нет. Проверены поля и события resume по DTO и ChatGateway и сохранение Review presentation в публичном payload.
- Сторонние правки `AGENTS.md` и трёх файлов `.agents/skills/support-engine-productization`, а также новый `discovery-2026-11-14.md` появились после исходной проверки и оставлены вне индекса.

## Проверки

| Проверка | Фактический результат |
|---|---|
| Backend `npm run build` | PASS |
| Backend Jest `modules/reviews modules/chat product-consultation support-agent` | 595 passed в 89 наборах. Исправлены тестовые контракты Handoff, подтверждения отмены и валидации Workspace. Отдельный повтор сценариев Order Agent interrupt/resume прошёл 9 из 9. |
| Frontend Jest `useAuth.test.tsx`, `src/features/ai-assistant`, `src/entities/reviews` | 29 passed в 7 наборах. При расширенном запуске исходный `login-fom.test.tsx` не загрузился из-за импорта отсутствующего `auth.actions`. Файл содержит только настройку mock и пустой набор тестов, его blob совпадает с HEAD. |
| Frontend Cypress `reviews-stage2.cy.ts` | 5 passed в Electron headless. Next dev запущен из временного снимка без `.env`, запросы Review API перехвачены Cypress. |
| Frontend `tsc --noEmit --incremental false` | PASS на свежих `.next/types`. Исправлены типы маршрутов, компонентов и тестовых провайдеров. |
| Frontend `npm run build` | PASS с включённой проверкой типов. Пререндер 28 из 28 страниц после исправления App Router и добавления `Suspense`. Осталось предупреждение Tailwind об easing. |
| PostgreSQL / Qdrant `support-engine-it-8fe7bdf3202e` | `migrate` и `contract` PASS. Применены 36 миграций с нуля, `prisma migrate diff` без расхождений. |
| Review V2 `test:integration:reviews` | 11 passed. Проверены HTTP, модерация, Summary, Q&A, отзыв источников, индексация и перезапуск. |
| Agentic Memory / User Context | `agentic-memory.mjs`, `agentic-memory-resume.mjs`, `agentic-memory-portability.mjs`, `agentic-memory-restart.mjs` PASS. Проверены изоляция, дедупликация, TTL 7/14/90, свежий поиск, подтверждение и отзыв фактов, перезапуск. |
| Совместный сценарий, первый прогон | PASS. PostgreSQL-эпизод восстановлен через прямой вызов ChatGateway и Workspace после 8 дней. Product Consultant заново нашёл товар и вернул источник опубликованного отзыва из Qdrant. |
| Совместный браузерный сценарий | Cypress 15.13.1, Electron 138, 1 из 1. Реальный `/login` и HttpOnly JWT, WebSocket `chat:join`, `chat:consultation_resume_decision` и `chat:send_message`. Сохранённый эпизод V2 с `price <= 5200` после тестовой паузы 8 дней восстановлен, одноразовое предложение использовано при явном продолжении. Review Q&A показал ответ и ссылку на товар. Два источника в сохранённом сообщении сверены с опубликованными отзывами. Изолированный Redis 5.0.14 обслуживал session middleware, запись и чтение health-ключа проверены. AI и reranker детерминированы. Локальный отчёт и команда повтора в `.tmp/support-engine-v1-joint/EVIDENCE.md`. |

## Готовность

Режим текущей проверки — интеграция NextShop. `MILESTONE_GATE: PASS` для совместного сценария, целевых регрессий и сборок. Оба merge открыты с подготовленными индексами и ожидают отдельного подтверждения пользователя.

Изолированный стенд остановлен командой `integration -- stop`, тома PostgreSQL и Qdrant сохранены. Временный Redis остановлен и удалён. После остановки идентификаторы и время работы `guest_pg`, `guest_redis` и `guest_qdrant` сверены с исходными. В рамках повторной проверки миграции не запускались.

`PORTABILITY_GATE: NOT VERIFIED` и `RELEASE_GATE: NOT VERIFIED` для объединённого кандидата. Предыдущий этап проверил отдельные границы Review и Memory с синтетическим альтернативным источником. Полный путь объединённой версии проверен в NextShop. Самостоятельная установка, живые внешние API, обновление и rollback вне проверки.
