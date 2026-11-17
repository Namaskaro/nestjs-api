# Support Engine — Event Ingestion V1. Состояние Harness

## Подготовка · 17 ноября 2026

- База разработки — `integration/support-engine-v1` на `9b8098e703372aaa35b752a213f7b80fe615e5b0`. Ревизия подтверждена в исходном checkout и в `origin`.
- Изолированный worktree — `E:\A_PROJECTS_PET\REFACTOR_GUEST\NestNextShop\refactor-guest-event-ingestion-v1`, ветка `feature/event-ingestion-v1` от указанной ревизии.
- [SPEC.md](SPEC.md) и [PLAN.md](PLAN.md) скопированы из исходного checkout. SHA-256 совпал с исходниками для обоих файлов.
- В базовой ревизии доступны [Productization Skill](../../.agents/skills/support-engine-productization/SKILL.md), [Architecture Contract](../../.agents/skills/support-engine-productization/architecture-contract.md), [Portability Checklist](../../.agents/skills/support-engine-productization/portability-checklist.md) и [конфигурация Shared Integration Test Environment](../../infra/integration/README.md). Docker Engine на момент проверки недоступен. Стенд не запускался.

## Текущий этап

M0 «Согласование». Harness подготовлен к контрольному коммиту. PLAN остаётся проектом для утверждения. Реализация и проверки gates не начинались.

## Открытые решения

1. Подтвердить изолированный WooCommerce-стенд, Blocks и HPOS, право установки плагина, версии WooCommerce и шлюза, профиль автоматического test capture.
2. Утвердить гарантию для окна до долговечной записи перехода WooCommerce либо выбрать проверяемый атомарный источник переходов.
3. Уточнить границу оплаты и checkout NextShop, транзакционные предусловия и необходимость серверной сверки списаний без status-sync.
4. Согласовать семантику отмены DRAFT и `search.submitted`.
5. Утвердить цели и основания обработки, ответственность за удаление, сроки хранения и порядок восстановления с учётом актуальных барьеров.
6. Утвердить точный контракт событий, механизмы доставки и параметры сверки в PLAN.

Подробности — SPEC §10 и PLAN §9.
