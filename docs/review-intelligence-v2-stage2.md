# Review Intelligence V2 — этап 2

Реализованы статистика, голосование, keyset-пагинация, полноценный блок отзывов
на странице товара и минимальная модерация Admin/Manager. Этапы 3–6 не выполнялись.
Backend baseline: `8550deac33f9f747ecac0c32847a05e624771cec`;
frontend baseline: `c36428a1cce35c39f8c9419c8c3b87f77a967b8e`.
Оба репозитория используют существующую `feature/review-intelligence-v2`.

Полная frontend production-сборка пока заблокирована исходными auth-страницами.
Ниже результаты проверок разделены; успешная полная сборка не заявляется.

## Backend и контракты

| API | Поведение |
| --- | --- |
| `GET /reviews/:productId?sort=date&take=20&cursor=...` | Теперь `{ items, nextCursor }`, три сортировки date/rating/popular, размер 1–50, default 20 |
| `GET /reviews/:productId/stats` | averageRating, ratingCount, positiveCount, neutralCount, negativeCount, positivePercent |
| `GET /reviews/:productId/my-votes?ids=id1,id2` | JWT, только собственные голоса по максимум 50 UUID, для текущих публичных публикаций этого товара |
| `PUT /reviews/:reviewId/vote` | JWT; `{ publicationId, value: UP/DOWN/null }`; null отменяет голос |
| Создание/дополнения/удаление/mine/модерация | Контракты этапа 1 сохранены |

Старый frontend, ожидающий массив из публичного GET reviews, нужно обновлять вместе
с backend. Изменение контракта необходимо для согласованной курсорной пагинации.

Stats считают весь опубликованный корпус основных отзывов через Prisma aggregate
и groupBy в одном RepeatableRead snapshot. 4–5 положительные, 3 нейтральные,
1–2 отрицательные. Дополнения и голоса не участвуют. При отсутствии оценок
averageRating равен null, количества и positivePercent равны 0; UI скрывает звёзды.

Голос и производные счётчики меняются одной Serializable-транзакцией с условным
обновлением родительского stateVersion/publicationId. Composite PK ReviewVote
обеспечивает один голос пользователя. Повтор того же значения идемпотентен;
self-vote, неопубликованная/удалённая и старая публикация не принимаются.
Сериализационный конфликт возвращается 409, автоматических повторов нет.
После 409 интерфейс обновляет состояние; пользователь может повторить действие.

popularityScore хранит floor(Wilson lower bound × 1 000 000), z=1.96.
Счётчики голосов публичные, собственный голос запрашивается отдельно и не смешивается
с общим публичным кэшем авторизации. Голоса не запускают индексацию или Summary.

Курсор содержит версию, productId, sort, asOf, полный tuple и publicationId.
Порядок DESC: дата/id; рейтинг/дата/id; Wilson/дата/id. Не требуется существование
якорной строки. publishedAt <= asOf исключает новые публикации из начатого просмотра.
Popularity остаётся live: чужой голос может переместить отзыв между страницами;
frontend дедуплицирует id+publicationId, сбрасывает страницы после своего голоса
и начинает с первого курсора при смене сортировки. Снимков выдачи нет.

Списковые методы ProductsService больше не запрашивают reviews relation и тексты.
Остальные поля и способы пагинации товаров сохранены. getProductById оставляет
совместимый публичный preview до 20 отзывов; основной UI использует отдельный GET.
На frontend Product.reviews стал optional; существующих читающих его потребителей
кроме заменённого review-блока не найдено. Обычные карточки не получили новых review UI.
Prisma schema и миграции в этапе 2 не менялись.

## Frontend

- Существующий reviews-блок получает средний рейтинг, количество и долю положительных
  оценок с backend; по загруженным страницам рейтинг не вычисляется.
- TanStack useInfiniteQuery управляет сортировкой, курсором и «Показать ещё».
  Страницы дедуплицируются по id+publicationId; private query keys включают userId.
- Список показывает опубликованные датированные дополнения, публичные счётчики,
  собственный голос, смену и отмену; кнопки своего отзыва заблокированы.
- Форма начинает без выбранных звёзд. Обязательны 1–5 и непустой текст до 4000;
  отправляются только productId/rating/text. mutateAsync действительно ожидается,
  при ошибке текст сохраняется и окно не закрывается.
- Кнопка создания зависит от backend eligibility. Свой PENDING/REJECTED/PUBLISHED,
  причина модерации, дополнения и удаление показаны в отдельном приватном блоке.
  Для дополнения нет новой оценки; редактирования текстов нет.
- ProductDetails («Подробнее») и прежний ProductView получают только настоящий
  средний рейтинг из stats. Фиктивные звёзды и 128 reviews удалены; процента,
  списка и Summary в модальном окне нет.
- Новая `/admin/reviews` и ссылка в существующем меню: очередь основных отзывов
  и дополнений, approve/reject, необязательный комментарий. Backend guards остаются
  источником разрешений; архитектура авторизации не менялась.
- Комментарий модератора привязан к id+publicationId и не переносится в новую
  публикацию того же слота. Notifications admin используют существующий глобальный
  react-hot-toast; публичный review-блок — существующий Sonner provider группы root.

## Изменённые файлы

| Репозиторий / файлы | Ответственность |
| --- | --- |
| Backend `reviews.service.ts`, `reviews.controller.ts` | Stats, страницы, own votes и голосование |
| Backend `review-publication.ts`, новый `dto/review-list.dto.ts` | Публичные счётчики, Wilson, tuple cursor и валидация |
| Backend `products.service.ts` | Удаление избыточных текстов из списков, bounded detail preview |
| Backend существующие два review specs и новый `reviews-list-vote.spec.ts` | Сохранение проверок этапа 1, новые правила/HTTP/cursor/Wilson |
| Frontend review types/actions/schema/useReviews | Типизированный API, Query cache, mutations и валидация |
| Frontend существующие ReviewForm/Modal/Item/Reviews/StarRating и новый ReviewOwner | Пользовательский lifecycle и отображение |
| Frontend ProductDetails/ProductView, Product type и product page | Настоящий modal rating, optional list reviews, удаление userId prop |
| Frontend `/admin/reviews/page.tsx`, admin layout | Минимальная модерация и существующее меню |
| Frontend два новых Jest files, один Cypress spec | Форма, API, Query, роли, публикации и браузерный пользовательский путь |

AuthModule/JWT Guard, OrdersService, AI Provider, Product Search, Support Graph,
основные рабочие каталоги и исходные ветки не менялись.

## Проверки с моками и браузером

- Backend `npm run build`: PASS. Targeted Jest: **58/58**, 3 suites.
- Frontend targeted Jest: **12/12**, 2 suites. Использованы существующие Jest,
  Testing Library и renderWithQueryClient, без новых фабрик/платформ.
- Cypress: **5/5**, реальный Next dev server и перехваченные API-ответы.
  Проверены server stats, vote, pagination/dedup/sort reset, начальные пустые звёзды,
  создание PENDING без author, дополнение/удаление, Manager-модерация обоих видов,
  настоящий mean без лишних данных в «Подробнее». Проверена ширина review-блока
  на 390px. Скриншоты просмотрены. Реальные JWT/DB HTTP этим набором не проверялись.
- TypeScript по существующему Cypress config: PASS.
- Scoped TypeScript syntactic/semantic diagnostics изменённых src файлов: **0 новых**.
  Два оставшихся сообщения воспроизведены in-memory компилятором на исходном HEAD:
  отсутствующий экспорт Brand и missing Sizes.initialSelected в прежнем ProductView.
  Это целевая проверка, не успешный полный project typecheck.

## Настоящая PostgreSQL

На `guest_pg / guest_refactor`, `localhost:5403`, разовый прогон собранного
ReviewsService через настоящий PrismaClient: **18/18 групп PASS**.

Проверены нулевой корпус и null mean; все количества/среднее/процент по 4 опубликованным
отзывам при странице 2; исключение PENDING/REJECTED; date/rating/popular cursor на
равных датах; binding курсора; self-vote/nonpublic refusal; UP/DOWN/change/cancel,
идемпотентность; конкурентные разные/один voter; точные счётчики и Wilson; private own
votes; настоящий composite unique; независимость rating от votes/addenda; продолжение
после удаления якоря; asOf и новый publicationId; отсутствие переноса старых голосов.

До writes зафиксированы UUID: 7 новых users (6 Client + Manager), 1 product,
6 DELIVERED orders, 6 reviews и 1 addendum; голоса используют эти composite IDs.
Каждый автор создавал отзыв через реальную проверку собственной покупки.
Номера orders заданы отрицательными, существующая sequence не расходуется.
Middleware задавала только заранее выделенные primary ID, результаты запросов не заменялись.

После проверки идентичности, маркеров и связей удалены только эти записи.
Счётчики и контрольные отпечатки **всех 30 существующих таблиц**, включая историю
миграций, совпали до и после. RunId `e68d66f6-b69e-4b2a-8945-29df9fd38871`;
локальные ignored evidence находятся в backend `.tmp/pg-integration-stage2/`.
Другие базы, реальные пользователи, товары и заказы не изменялись.

Первый запуск был остановлен auto-review, не увидевшим разрешение из вложения.
После read-only подтверждения явной авторизации (пункт 9, строка 159) и точного scope
тот же прямой запуск был допущен. Отказ не обходился, до допуска writes не выполнялись.

## Review, исправления и оставшийся блокер

- Prisma 6.3 contextual groupBy TS2615 устранён переносом promise-переменных перед
  $transaction; сохранены groupBy/aggregate и RepeatableRead. Build/tests PASS.
- Scoped review обнаружил перенос moderator reason между публикациями. Regression
  воспроизвёл ошибку; id+publicationId key исправил её. Frontend 12/12 PASS.
- В Cypress исправлены только неверный тестовый маршрут и неполный synthetic blurURL;
  затем все 5 сценариев прошли, проверки не ослаблялись.
- Новых открытых функциональных findings в пределах этапа не осталось.

Полный frontend `next build` компилирует код, затем падает при prerender исходных
auth-страниц: `/auth` (useSearchParams без Suspense) или `/auth/new-password`
(существующий page экспортирует только именованный NewPassword; ошибка RSC/functions).
На baseline до frontend edits подтверждён сбой `/auth`; итоговый прогон остановился
на `/auth/new-password`. Оба auth-файла остались исходными, auth diff пустой.
Полный `tsc --noEmit` также падает на исходном ResetPasswordForm TS1109.
Эти посторонние файлы и настройка ignoreBuildErrors не изменялись, проверки не обходились.
Полная production-сборка и полный project typecheck не являются PASS.

Пользователь явно принял перечисленные целевые проверки как эквивалентную проверку
этапа 2 и разрешил commit/push обоих feature-репозиториев при сохранении этих
ограничений полной frontend-сборки. Это решение не превращает упавшие команды в PASS
и не расширяет scope на Auth. Код и итоговый diff проверены; функциональных
findings в пределах этапа не осталось. Этап 2 передаётся на приёмку пользователя.
Этапы 3–6 не начинаются.
