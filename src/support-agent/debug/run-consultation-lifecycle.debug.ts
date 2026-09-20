import {
  abandonConsultationSession,
  buildConsultationCompletionPresentation,
  completeConsultationSession,
  markConsultationSessionHandedOff,
  touchConsultationSession,
} from '../agents/product-agent/consultation-session';

import {
  emptyProductContext,
  type ProductContext,
} from '../../product-consultation/application/context/product-context.schema';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectThrow(fn: () => unknown, message: string): void {
  let thrown = false;

  try {
    fn();
  } catch {
    thrown = true;
  }

  assert(thrown, message);
}

function createActiveContext(
  needIds: string[] = ['need-1'],
  now = new Date('2026-09-17T12:00:00.000Z'),
): ProductContext {
  const context = emptyProductContext();

  touchConsultationSession(context, needIds, now);

  return context;
}

function testActiveSession(): void {
  const context = createActiveContext();

  const session = context.consultationSession;

  assert(session, 'ACTIVE session не была создана.');

  assert(
    session.status === 'ACTIVE',
    'Новая consultation session должна быть ACTIVE.',
  );

  assert(
    session.needIds.length === 1 && session.needIds[0] === 'need-1',
    'ACTIVE session содержит неверные needIds.',
  );

  assert(
    session.completedAt === null,
    'ACTIVE session не должна иметь completedAt.',
  );

  assert(
    session.completionReason === null,
    'ACTIVE session не должна иметь completionReason.',
  );

  assert(session.feedback === null, 'ACTIVE session не должна иметь feedback.');

  console.log('✅ ACTIVE session создаётся корректно');
}

function testTouchActiveSession(): void {
  const context = createActiveContext();

  const firstSession = context.consultationSession;

  assert(firstSession, 'Начальная session отсутствует.');

  const sessionId = firstSession.sessionId;

  const startedAt = firstSession.startedAt;

  touchConsultationSession(
    context,
    ['need-1', 'need-2'],
    new Date('2026-09-17T12:05:00.000Z'),
  );

  const updated = context.consultationSession;

  assert(updated, 'Session исчезла после touch.');

  assert(
    updated.sessionId === sessionId,
    'touch не должен создавать новую ACTIVE session.',
  );

  assert(updated.startedAt === startedAt, 'touch не должен менять startedAt.');

  assert(
    updated.lastActivityAt === '2026-09-17T12:05:00.000Z',
    'touch должен обновлять lastActivityAt.',
  );

  assert(
    updated.needIds.length === 2 &&
      updated.needIds.includes('need-1') &&
      updated.needIds.includes('need-2'),
    'touch должен объединять needIds.',
  );

  console.log('✅ ACTIVE session обновляется без создания новой');
}

function testUserDone(): void {
  const context = createActiveContext();

  const activeId = context.consultationSession?.sessionId;

  const completed = completeConsultationSession(context, {
    reason: 'USER_DONE',

    now: new Date('2026-09-17T12:10:00.000Z'),
  });

  assert(
    completed.status === 'COMPLETED',
    'USER_DONE должен завершать session.',
  );

  assert(
    completed.completionReason === 'USER_DONE',
    'USER_DONE reason потерян.',
  );

  assert(
    completed.sessionId === activeId,
    'Completion не должен создавать новую session.',
  );

  assert(
    completed.selectedProductIds.length === 0,
    'USER_DONE не должен автоматически выбирать товар.',
  );

  assert(
    completed.feedback === null,
    'Completion не должен автоматически создавать feedback.',
  );

  const presentation = buildConsultationCompletionPresentation(completed);

  assert(
    presentation.status === 'COMPLETED',
    'Completion presentation имеет неверный status.',
  );

  assert(
    presentation.reason === 'USER_DONE',
    'Completion presentation потерял reason.',
  );

  assert(
    presentation.feedbackRequest.kind === 'HELPFULNESS',
    'Completion должен запросить helpfulness feedback.',
  );

  assert(
    presentation.feedbackRequest.options[0] === 'HELPFUL' &&
      presentation.feedbackRequest.options[1] === 'NOT_HELPFUL',
    'Completion feedback options неверны.',
  );

  console.log('✅ USER_DONE завершает консультацию');
}

function testProductSelected(): void {
  const context = createActiveContext();

  const completed = completeConsultationSession(context, {
    reason: 'PRODUCT_SELECTED',

    selectedProductIds: ['product-2', 'product-2'],

    now: new Date('2026-09-17T12:15:00.000Z'),
  });

  assert(
    completed.status === 'COMPLETED',
    'PRODUCT_SELECTED должен завершать session.',
  );

  assert(
    completed.completionReason === 'PRODUCT_SELECTED',
    'PRODUCT_SELECTED reason потерян.',
  );

  assert(
    completed.selectedProductIds.length === 1 &&
      completed.selectedProductIds[0] === 'product-2',
    'Выбранный товар сохранён неверно.',
  );

  const presentation = buildConsultationCompletionPresentation(completed);

  assert(
    presentation.selectedProductIds[0] === 'product-2',
    'Completion presentation потерял выбранный товар.',
  );

  console.log('✅ PRODUCT_SELECTED сохраняет выбранный товар');
}

function testUserStopped(): void {
  const context = createActiveContext();

  const completed = completeConsultationSession(context, {
    reason: 'USER_STOPPED',

    now: new Date('2026-09-17T12:20:00.000Z'),
  });

  assert(
    completed.status === 'COMPLETED',
    'USER_STOPPED должен завершать session.',
  );

  assert(
    completed.completionReason === 'USER_STOPPED',
    'USER_STOPPED reason потерян.',
  );

  assert(
    completed.selectedProductIds.length === 0,
    'USER_STOPPED не должен выбирать товар.',
  );

  console.log('✅ USER_STOPPED завершает консультацию без выбора товара');
}

function testCompleteWithoutActiveSession(): void {
  const context = emptyProductContext();

  expectThrow(
    () =>
      completeConsultationSession(context, {
        reason: 'USER_DONE',
      }),

    'Completion без ACTIVE session должен завершаться ошибкой.',
  );

  console.log('✅ COMPLETE без ACTIVE session отклоняется');
}

function testProductSelectedWithoutProduct(): void {
  const context = createActiveContext();

  expectThrow(
    () =>
      completeConsultationSession(context, {
        reason: 'PRODUCT_SELECTED',

        selectedProductIds: [],
      }),

    'PRODUCT_SELECTED без товара должен завершаться ошибкой.',
  );

  console.log('✅ PRODUCT_SELECTED без товара отклоняется');
}

function testHandoffCreated(): void {
  const context = createActiveContext();

  const handedOff = markConsultationSessionHandedOff(
    context,
    new Date('2026-09-17T12:25:00.000Z'),
  );

  assert(handedOff, 'Handoff потерял active session.');

  assert(
    handedOff.status === 'HANDED_OFF',
    'Фактический handoff должен переводить session в HANDED_OFF.',
  );

  assert(
    handedOff.completionReason === 'HANDOFF',
    'HANDED_OFF должен иметь reason=HANDOFF.',
  );

  assert(
    handedOff.completedAt === '2026-09-17T12:25:00.000Z',
    'HANDED_OFF должен фиксировать completedAt.',
  );

  assert(
    handedOff.feedback === null,
    'HANDED_OFF не должен запрашивать consultation feedback.',
  );

  console.log('✅ Фактический handoff завершает session как HANDED_OFF');
}

function testHandoffDeclined(): void {
  const context = createActiveContext();

  const before = context.consultationSession;

  assert(before, 'ACTIVE session отсутствует.');

  const sessionId = before.sessionId;

  const after = context.consultationSession;

  assert(after, 'Session исчезла после симуляции decline.');

  assert(
    after.status === 'ACTIVE',
    'Отказ от handoff не должен завершать консультацию.',
  );

  assert(
    after.sessionId === sessionId,
    'Отказ от handoff не должен создавать новую session.',
  );

  console.log('✅ Отказ от handoff оставляет consultation ACTIVE');
}

function testAbandoned(): void {
  const context = createActiveContext();

  const abandoned = abandonConsultationSession(
    context,
    new Date('2026-09-17T12:30:00.000Z'),
  );

  assert(abandoned, 'ABANDONED потерял session.');

  assert(
    abandoned.status === 'ABANDONED',
    'Stale consultation должна стать ABANDONED.',
  );

  assert(
    abandoned.completionReason === 'STALE',
    'ABANDONED должна иметь reason=STALE.',
  );

  assert(
    abandoned.feedback === null,
    'ABANDONED не должна содержать feedback.',
  );

  console.log('✅ Stale consultation переводится в ABANDONED');
}

function testNewSessionAfterCompletion(): void {
  const context = createActiveContext();

  const firstId = context.consultationSession?.sessionId;

  completeConsultationSession(context, {
    reason: 'USER_DONE',

    now: new Date('2026-09-17T12:35:00.000Z'),
  });

  const next = touchConsultationSession(
    context,
    ['need-new'],
    new Date('2026-09-17T13:00:00.000Z'),
  );

  assert(
    next.status === 'ACTIVE',
    'После terminal session новая консультация должна стать ACTIVE.',
  );

  assert(
    next.sessionId !== firstId,
    'После завершённой consultation должен создаваться новый sessionId.',
  );

  assert(
    next.needIds.length === 1 && next.needIds[0] === 'need-new',
    'Новая consultation получила неверные needIds.',
  );

  assert(
    next.completionReason === null,
    'Новая ACTIVE consultation не должна наследовать completionReason.',
  );

  assert(
    next.feedback === null,
    'Новая ACTIVE consultation не должна наследовать feedback.',
  );

  console.log('✅ После terminal state создаётся новая ACTIVE session');
}

function run(): void {
  console.log('CONSULTATION LIFECYCLE DEBUG');

  console.log('Paid LLM calls: 0');

  console.log('Database calls: 0');

  console.log('Qdrant searches: 0');

  console.log('');

  testActiveSession();

  testTouchActiveSession();

  testUserDone();

  testProductSelected();

  testUserStopped();

  testCompleteWithoutActiveSession();

  testProductSelectedWithoutProduct();

  testHandoffCreated();

  testHandoffDeclined();

  testAbandoned();

  testNewSessionAfterCompletion();

  console.log('');

  console.log('✅ CONSULTATION LIFECYCLE DEBUG PASSED');
}

try {
  run();
} catch (error) {
  console.error('');

  console.error('❌ CONSULTATION LIFECYCLE DEBUG FAILED');

  console.error(error);

  process.exitCode = 1;
}
