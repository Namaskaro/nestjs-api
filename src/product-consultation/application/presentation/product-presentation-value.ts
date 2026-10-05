type PresentationFact = {
  attributeId: string;

  status: 'known' | 'unknown' | 'not_applicable' | 'conflicting';

  value: string | number | boolean | string[] | null;

  displayValue: string | null;
};

const GENDER_LABELS: Record<string, string> = {
  MAN: 'Мужской',

  MALE: 'Мужской',

  WOMAN: 'Женский',

  FEMALE: 'Женский',

  UNISEX: 'Унисекс',
};

export function productPresentationDisplayValue(
  fact: PresentationFact,
): string | null {
  if (
    fact.status === 'known' &&
    fact.attributeId === 'gender' &&
    typeof fact.value === 'string'
  ) {
    const label = GENDER_LABELS[fact.value.trim().toUpperCase()];

    if (label) {
      return label;
    }
  }

  return fact.displayValue;
}
