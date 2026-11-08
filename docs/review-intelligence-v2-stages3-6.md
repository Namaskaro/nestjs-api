# Review Intelligence V2 — реализация этапов 3–6

Код подготовлен в существующих backend/frontend `feature/review-intelligence-v2`.
Исходные SHA: backend `b764a23377b666ad45564d53e47dc69ba6b084b5`, frontend
`ca2cf1789b0e3917d6bc5e525f133157002d039a`. Этапы 1–2 приняты пользователем.

**Живые критерии приёмки остаются открытыми.** Пользователь выбрал проверки без
записи и платных вызовов. Это ограничение соблюдено: миграций, новых PG/Qdrant
записей, фонового запуска на рабочей базе и платных AI-вызовов не было.
Коммиты сохраняют реализацию; они не означают успешную живую приёмку или deployment.

## Этап 3: индекс и тематический retrieval

- В существующем ReviewsModule добавлен `ReviewIndexService`.
- Коллекция `reviews`, dense/BM25 через существующие AiService/QdrantService.
  Main ID = publicationId; дополнение имеет свой ID и embedding. Payload содержит
  связи, kind, hash текста и embedding space. Summary и каталоговые embeddings
  не меняются. Поиск использует configured primary embedding space.
- Одобрение main/addendum, удаление и повторное создание оставляют durable
  indexPending в той же транзакции. HTTP не обращается к embedding API.
- Worker: опрос 30 секунд, до пяти Review за проход, один проход на процесс,
  lease 120 секунд с heartbeat, ограниченные повторные попытки.
- Существующий hash предотвращает переembedding main при новом дополнении.
  Очистка сначала инспектирует ограниченные IDs, затем читает актуальную PG-публикацию.
  Поздний или неопределённый upsert компенсируется в finally; новая публикация
  не удаляется. При ошибке очистки durable отметка сохраняется.
- Внутренний search ограничен productId и embedding space, до 16 кандидатов.
  Тексты и авторы повторно читаются из PostgreSQL по текущим publicationId/status.
  Qdrant payload не используется как источник текста. Новый публичный платный API
  не добавлялся; retrieval вызывается консультацией по явному reviewQuery.

`QdrantService` получил только тонкие keyword-index/scroll операции.
Каталоговый init/reindex не запускался. В реальном guest_qdrant коллекция reviews
пока отсутствует; её создание и live-indexing не проверены.

## Этап 4: Review Summary

- `review-summary.model.ts`: schema, prompt, hash/version, пороги и map/reduce.
- `ReviewSummaryService`: due-row polling, claim/heartbeat, snapshot, сохранение
  и диагностика. Брокер сообщений, новая таблица заданий и test platform не созданы.
- Первый порог 10 разных покупателей; далее следующий десяток до 100,
  затем основание + ceil(10%). Обработанные 23 дают следующий порог 30.
- CorpusVersion и requestedVersion разделены. Дополнения включаются в следующий
  плановый снимок, но не запрашивают генерацию. Голоса не меняют Summary.
- Удаление учтённого отзыва очищает доступную сводку в транзакции; при N<10
  генерация отменяется, при достаточном корпусе запрашивается пересчёт.
  Retraction/lease guards блокируют результат старого задания.
- Малый корпус — один STANDARD structured-output вызов в существующем jsonMode.
  Большой корпус делится без потери текста; промежуточные сводки объединяются
  уровнями. Лимит вызовов и проверка сходимости предотвращают бесконечный reduce.
- Token counter текущего chat-model используется с резервом для schema/wrapper.
  Его точность относительно реального tokenizer провайдера и контекстного окна
  ещё не подтверждена live. Нет утверждения о проверенном расходе/качестве модели.
- Prompt отделяет субъективные мнения от Product Facts, запрещает выдуманные
  свойства, распространённость и команды внутри пользовательских текстов.
  Числовая статистика вычисляется PostgreSQL.
- Готовая сводка, статистика и их согласованность читаются одной RepeatableRead
  транзакцией ReviewsService. Новые публикации сами по себе не скрывают прежнюю
  готовую сводку; удаление обработанного источника скрывает её явно.

## Этап 5: Consultant, Recommendation, Review Q&A

- ProductAgentService получает review-данные через ReviewsModule. Wiring использует
  forwardRef на существующей границе модулей; AuthModule/JWT не изменены.
- DETAILS передаёт stats и готовую Summary в существующий productDetailsPresentation.
  Для обычного DETAILS нет нового LLM или review retrieval.
- RECOMMEND получает reviewExperience по серверным positions в прежнем единственном
  вызове Recommendation Synthesizer. Существующий prompt сохранён и дополнен
  короткими правилами естественного использования впечатлений. Дополнительной
  генерации и Qdrant-поиска в обычной рекомендации нет. При отсутствии Summary
  продолжается рекомендация по Facts.
- Nullable optional reviewQuery разрешён только у DETAILS. Отсутствующее поле
  не добавляется в старые нормализованные decisions: старые workspace snapshots
  и их прежние идентификаторы не меняются из-за нового null-поля.
- Q&A использует существующую серверную selection, product-scoped retrieval,
  до четырёх целых текстов в ограниченном контексте и один STANDARD вызов.
  Позиции источников проверяются. При пустой выдаче LLM не вызывается.
- После генерации Q&A повторно проверяет все переданные источники. Recommendation
  проверяет актуальность использованных Summary/statistics. При изменении основания
  новый зависимый текст не отправляется; повторный LLM автоматически не запускается.
- Frontend: расширены AI types, InlineProductDetails; добавлен InlineReviewAnswer
  с естественным ответом и раскрываемыми датированными источниками. Существующие
  parser, MessageArtifacts и ArtifactPanel передают вложенный details-контракт.
- По окончательному уточнению пользователя сохранённые тексты чата не переписываются.
  ChatService/Support Graph и маршрутизация handoff не изменены.

## Этап 6: небольшой рейтинг-сигнал и Compare

После действующих retrieval/hard filters/reranker корректируются только его top-6:

```text
B = (N × averageRating + 20 × 3) / (N + 20)
u = (B − 3) / 2
N = 0 → u = 0
finalScore = catalogScore + REVIEW_RATING_WEIGHT × u
```

При равенстве сохраняется исходный rank. Разрыв больше 2λ не инвертируется.
Отсутствие отзывов даёт нулевую поправку. Состав кандидатов не расширяется.
Ошибка чтения статистики сохраняет тот же top-6 и его каталожный порядок.
При ошибке reranker действует прежний путь без rating query/correction.
Тексты, Summary и голоса в формуле отсутствуют. Настройки — стартовые параметры,
не доказанный оптимум; живая калибровка релевантности не выполнялась.

Compare читает только средние оценки batch-запросом, без чтения Summary,
тематического retrieval и новых LLM-вызовов. Старые artifacts без averageRating
совместимы. InlineComparison показывает mean либо отсутствие оценок.

## Настройки и запуск

Файлы окружения и существующая конфигурация проекта не изменялись.

| Параметр | Значение по умолчанию |
| --- | --- |
| REVIEW_INDEX_ENABLED | false; включается оператором после разрешения embedding-расхода |
| REVIEW_SUMMARY_ENABLED | false; включается оператором после разрешения LLM-расхода |
| REVIEW_SUMMARY_INPUT_TOKENS | 6000, минимум 4096 с резервом для schema |
| REVIEW_SUMMARY_MAX_CALLS | 32 на job, допустимо 1–128 |
| REVIEW_RATING_WEIGHT | 0.005, диапазон 0–0.02; 0 отключает поправку |

Оба worker выбирают только due-строки, не сканируют все товары. Lease продлевается
через 40 секунд, в том числе во время LLM. Повторные задержки 30s/120s/600s/до1h;
после пяти попыток pending сохраняется для диагностики и целевого вмешательства.
Бюджетные/config ошибки Summary останавливают автоматические повторные расходы.
Сброс попыток/запуск на рабочей базе — отдельная операция записи, сейчас не выполнялась.
Exactly-once платный расход при crash после ответа провайдера не обещается.

## Выполненная проверка

| Проверка | Фактический результат |
| --- | --- |
| Backend npm run build | PASS на итоговом source после snapshot repair |
| Существующий targeted backend Jest | 114/114, 13 suites, PASS |
| Существующий frontend Jest AI/reviews | 16/16, 3 suites, PASS |
| Изолированные scripted проверки с mocked IO | 8 index, 10 Summary/snapshot, 6 Q&A, 6 ranking/search; PASS |
| Frontend production compile | PASS |
| Полный frontend build | FAIL prerender /checkout/payment-result: useSearchParams/Suspense, файл не изменён |
| Scoped frontend TypeScript vs HEAD | baseline0/current0/introduced0, четыре изменённых файла |
| UI preview | Реальные React components + существующий CSS, desktop1280/mobile390; SSR/DOM/скриншоты проверены |
| Реальная PostgreSQL, только чтение | Новый stats+Summary snapshot на пустом публичном корпусе PASS |
| Сохранность БД | Три исходных Review PENDING; все 30 table fingerprints совпали с этапом2 |

Jest и изолированные проверки используют моки. Они не подтверждают поведение
реального Qdrant/провайдера или конкурентную PG lease на новых worker.
UI-preview — локальная SSR-визуальная проверка, не сквозная JWT/HTTP/DB проверка.
Существующие проверки не ослаблялись; адаптированы mocks нового метода и ожидания
новых полей. Новые Jest suites, универсальные фабрики и зависимости не добавлялись.

## Review и незакрытые критерии

Исправлены в scope:

1. Неопределённый поздний Qdrant upsert: cleanup в finally удаляет только старые IDs;
   регрессионный scripted check сохранил новую публикацию.
2. Раздельное чтение stats/Summary: общий RepeatableRead snapshot устранил возможность
   смешать состояния до/после удаления. Проверены общий tx и настоящий read-only PG.
3. Старые test doubles дополнены новым review/rating методом; прежние assertions сохранены.

Не проверены и не объявляются выполненными:

- Реальные indexing/search, очистка и restart на Qdrant reviews.
- Реальные lease/concurrency/restart и пороги Summary с новым корпусом PostgreSQL.
- Фактическая размерность и совместимость полного 4000-символьного текста с embedding,
  tokenizer/context budget, single/batch/reduce output и качество русского Summary/Q&A.
- Сквозная browser → JWT → PostgreSQL/Qdrant/AI интеграция и живая калибровка rating.
- Успешная полная production-сборка frontend и общий project typecheck с исходными ошибками.

Для этих живых проверок нужны отдельно разрешённые новые маркированные записи и
платные вызовы; пользователь сейчас их не разрешил. Goal остаётся открытым.
Детальная хронология, ремонтные попытки, evidence и SHA находятся в локальном STATE.
