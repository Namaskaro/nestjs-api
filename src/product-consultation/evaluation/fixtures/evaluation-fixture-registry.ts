import {
  EvaluationFixtureSchema,
  type EvaluationFixture,
} from './evaluation-fixture';

export class EvaluationFixtureRegistry {
  private readonly fixtures = new Map<string, EvaluationFixture>();

  constructor(fixtures: readonly EvaluationFixture[] = []) {
    for (const fixture of fixtures) {
      this.register(fixture);
    }
  }

  register(fixture: EvaluationFixture): void {
    const parsed = EvaluationFixtureSchema.parse(fixture);

    if (this.fixtures.has(parsed.id)) {
      throw new Error(
        `EvaluationFixtureRegistry: fixture "${parsed.id}" уже зарегистрирован`,
      );
    }

    this.fixtures.set(parsed.id, parsed);
  }

  has(fixtureId: string): boolean {
    return this.fixtures.has(fixtureId);
  }

  get(fixtureId: string): EvaluationFixture {
    const fixture = this.fixtures.get(fixtureId);

    if (!fixture) {
      throw new Error(
        `EvaluationFixtureRegistry: fixture "${fixtureId}" не найден`,
      );
    }

    return fixture;
  }

  all(): readonly EvaluationFixture[] {
    return [...this.fixtures.values()];
  }
}
