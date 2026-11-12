# Integration — PLAN

Status: DRAFT
Source: harness/integration/SPEC.md

## 1. Предварительное решение
Сначала подтвердить входные функции, target baseline и SHA для backend/frontend. Затем отдельно согласовать порядок интеграции и исправления конфликтов. Не использовать произвольную ветку `main` без проверки.

## 2. Milestones
| Этап | Результат | Проверка/gate | Статус |
|---|---|---|---|
| I0 Source readiness | Точные исходные SHA, пользовательская приёмка, незакрытые блокеры | SOURCE_GATE | NOT_STARTED |
| I1 Integration design | Матрица затронутых контрактов, порядок Git, план тестов, rollback | INTEGRATION_DESIGN_GATE; отдельно productization DESIGN_GATE в REUSABLE_PRODUCT | NOT_STARTED |
| I2 Safe integration | Отдельные интеграционные branches/worktrees backend и frontend | MERGE_GATE | NOT_STARTED |
| I3 Verification | Prisma migrations, Qdrant, Redis, targeted/regression/cross-feature tests | INTEGRATION_GATE; отдельно productization MILESTONE_GATE | NOT_STARTED |
| I4 Release candidate | Один локальный магазин, реальные JWT/HTTP/WS, E2E, тестовые учётные записи | RC_GATE | NOT_STARTED |
| I5 User validation | Ручные сценарии, баги, исправления, повторная проверка | USER_ACCEPTANCE_GATE; live-feedback-planning при замечаниях | NOT_STARTED |
| I6 Release approval | Итоговые SHA, инструкции, rollback, отдельно продуктовая матрица A–G | RELEASE_GATE; отдельно productization RELEASE_GATE | NOT_STARTED |

## 3. Области конфликтов для исследования
- `ChatService` / Gateway / LangGraph checkpoint и память
- ProductAgent / Review presentations / WebSocket artifacts
- Prisma schema, индексы и миграции
- Auth/roles/handoff, workers и feature flags
- Frontend parser/rendering и back/forward compatibility
- Qdrant collection names, embedding dimensions; Redis configuration

Это список гипотез для проверки, не доказанные конфликты.

## 4. Стратегия тестов
Сначала дешёвые проверки изменённых контрактов; полные E2E и регрессии только на контрольных этапах. Все изменяющие данные операции — на выделенном и аттестованном тестовом стенде. Paid AI calls только по явному разрешению. Зафиксировать достаточные сквозные сценарии из SPEC.md.

## 5. План восстановления
На этапе проекта: подготовить безопасный rollback версии приложения, совместимые/аддитивные миграции, backup/restore план и порядок отключения flags. Не удалять схемы/данные как «автооткат».

## 6. Что необходимо согласовать до реализации
- Точные target branches/baseline SHA и source SHA.
- APPLICATION или REUSABLE_PRODUCT.
- Права на локальные integration commits и тестовые записи.
- Процесс ручной приёмки и отдельно push/merge/deploy.
