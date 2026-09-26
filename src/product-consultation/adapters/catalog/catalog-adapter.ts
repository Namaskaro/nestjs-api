// START CHANGES — UNIVERSAL CATALOG ADAPTER ENGINE

import {
  CategoryProfileSchema,
  ProductDetailsSchema,
  ProductFactSchema,
  ProductSourceSchema,
  type AttributeDefinition,
  type CategoryProfile,
  type ProductDetails,
  type ProductFact,
} from '@/src/product-consultation/core/consultation-core.schema';

import type {
  AttributeBag,
  AttributeMapping,
  AttributeSource,
  CanonicalValue,
  CatalogAdapter,
  CatalogMapping,
  CatalogPath,
  DecodeContext,
  DecodedValue,
  RawObservation,
  UnitConversion,
  UnitRegistry,
  ValueDecoder,
} from './catalog-adapter.types';

type ProductSource = ProductDetails['source'];

type PathResult = {
  present: boolean;

  value: unknown;

  path: string;
};

type BagIndex = {
  normalizeKey: (key: string) => string;

  values: Map<string, RawObservation[]>;

  /**
   * Ошибка всего контейнера.
   *
   * В отличие от предыдущего варианта,
   * одна плохая запись внутри bag
   * НЕ портит все остальные attributes.
   */
  containerIssue: RawObservation | null;
};

function configurationError(message: string): never {
  throw new Error(`Catalog adapter configuration: ${message}`);
}

function pathPointer(path: CatalogPath): string {
  if (path.length === 0) {
    return '$';
  }

  return (
    '/' +
    path
      .map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1'))
      .join('/')
  );
}

function assertPath(path: CatalogPath): void {
  const valid =
    Array.isArray(path) &&
    path.every((part) => {
      if (typeof part === 'string') {
        return part.length > 0;
      }

      return (
        typeof part === 'number' && Number.isSafeInteger(part) && part >= 0
      );
    });

  if (!valid) {
    configurationError('Invalid catalog path');
  }
}

function readPath(root: unknown, path: CatalogPath): PathResult {
  let current = root;

  for (let index = 0; index < path.length; index += 1) {
    if (current === null || typeof current !== 'object') {
      /*
       * Путь частично существует,
       * но структура источника повреждена.
       */
      return {
        present: true,

        value: undefined,

        path: pathPointer(path.slice(0, index)),
      };
    }

    const key = path[index];

    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      return {
        present: false,

        value: undefined,

        path: pathPointer(path),
      };
    }

    current = (current as Record<string | number, unknown>)[key];
  }

  return {
    present: true,

    value: current,

    path: pathPointer(path),
  };
}

function observation(
  value: unknown,
  paths: string[],
  transformations: string[] = [],
  unit?: unknown,
  displayValue?: string,
): RawObservation {
  return {
    value,

    paths,

    transformations,

    unit,

    displayValue,
  };
}

function buildBagIndex(row: unknown, bag: AttributeBag): BagIndex {
  const normalizeKey = bag.normalizeKey ?? ((key: string) => key.trim());

  const result: BagIndex = {
    normalizeKey,

    values: new Map(),

    containerIssue: null,
  };

  const container = readPath(row, bag.path);

  if (!container.present) {
    return result;
  }

  const invalidateContainer = (): void => {
    result.containerIssue = observation(
      null,
      [container.path],
      ['invalid_attribute_container'],
    );
  };

  const add = (rawKey: string, entry: RawObservation): void => {
    const key = normalizeKey(rawKey);

    if (!key) {
      return;
    }

    const entries = result.values.get(key) ?? [];

    entries.push(entry);

    result.values.set(key, entries);
  };

  if (bag.kind === 'object') {
    if (
      container.value === null ||
      typeof container.value !== 'object' ||
      Array.isArray(container.value)
    ) {
      invalidateContainer();

      return result;
    }

    for (const [key, value] of Object.entries(container.value)) {
      add(
        key,
        observation(
          value,
          [pathPointer([...bag.path, key])],
          ['read_attribute_object'],
        ),
      );
    }

    return result;
  }

  if (!Array.isArray(container.value)) {
    invalidateContainer();

    return result;
  }

  container.value.forEach((rawEntry: unknown, entryIndex: number) => {
    const entryPath = [...bag.path, entryIndex];

    if (bag.kind === 'labels') {
      /*
       * Нерелевантная или свободная строка
       * просто не является фактом.
       */
      if (typeof rawEntry !== 'string') {
        return;
      }

      const match = rawEntry.match(/^([^:=\r\n]+?)\s*[:=]\s*([^\r\n]*)$/);

      if (!match) {
        return;
      }

      const rawValue = match[2].trim();

      add(
        match[1],
        observation(
          rawValue,
          [pathPointer(entryPath)],
          ['parse_labeled_attribute'],
          undefined,
          rawValue,
        ),
      );

      return;
    }

    /*
     * pairs bag.
     */
    const key = readPath(row, [...entryPath, ...bag.keyPath]);

    const value = readPath(row, [...entryPath, ...bag.valuePath]);

    /*
     * Если key невалиден,
     * мы не можем понять,
     * к какому canonical attribute
     * относится запись.
     *
     * Поэтому не портим unrelated facts.
     */
    if (typeof key.value !== 'string' || !key.value.trim()) {
      return;
    }

    const unit = bag.unitPath
      ? readPath(row, [...entryPath, ...bag.unitPath])
      : null;

    add(
      key.value,
      observation(
        value.value,
        [key.path, value.path, ...(unit?.present ? [unit.path] : [])],
        ['read_attribute_pair'],
        unit?.present ? unit.value : undefined,
      ),
    );
  });

  return result;
}

function readSource<Row>(
  row: Row,
  source: AttributeSource<Row>,
  bags: ReadonlyMap<string, BagIndex>,
): RawObservation[] {
  if (source.kind === 'custom') {
    return source.read(row).map((entry) => ({
      ...entry,

      transformations: [
        `custom:${source.id}`,
        ...(entry.transformations ?? []),
      ],
    }));
  }

  if (source.kind === 'bag') {
    const bag = bags.get(source.bag);

    if (!bag) {
      return configurationError(`Unknown bag "${source.bag}"`);
    }

    if (bag.containerIssue) {
      return [bag.containerIssue];
    }

    const aliases = new Set(
      source.aliases.map((alias) => bag.normalizeKey(alias)),
    );

    return [...aliases].flatMap((alias) => bag.values.get(alias) ?? []);
  }

  const value = readPath(row, source.path);

  if (!value.present) {
    return [];
  }

  const display = source.displayPath ? readPath(row, source.displayPath) : null;

  const unit = source.unitPath ? readPath(row, source.unitPath) : null;

  return [
    observation(
      value.value,
      [
        value.path,

        ...(display?.present ? [display.path] : []),

        ...(unit?.present ? [unit.path] : []),
      ],
      ['read_path'],
      unit?.present ? unit.value : undefined,
      typeof display?.value === 'string' ? display.value : undefined,
    ),
  ];
}

function conversionFor(
  units: UnitRegistry,
  canonicalUnit: string,
  inputUnit: string,
): UnitConversion | null {
  /*
   * Unit IDs являются exact identifiers.
   *
   * Намеренно НЕ делаем global lowerCase:
   * в технических каталогах регистр
   * иногда имеет смысл.
   */
  if (inputUnit === canonicalUnit) {
    return {
      factor: 1,

      offset: 0,
    };
  }

  const registry = units[canonicalUnit];

  if (!registry || !Object.prototype.hasOwnProperty.call(registry, inputUnit)) {
    return null;
  }

  return registry[inputUnit];
}

function decodeNumber(
  raw: unknown,
  context: DecodeContext,
): DecodedValue | null {
  let value: number;

  let suffix = '';

  const transformations: string[] = [];

  if (typeof raw === 'number') {
    value = raw;
  } else if (typeof raw === 'string') {
    const match = raw
      .trim()
      .match(/^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*(.*)$/);

    if (!match) {
      return null;
    }

    value = Number(match[1].replace(',', '.'));

    suffix = match[2].trim();

    transformations.push('parse_decimal');
  } else {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  if (
    context.observedUnit !== undefined &&
    (typeof context.observedUnit !== 'string' || !context.observedUnit.trim())
  ) {
    return null;
  }

  const observedUnit =
    typeof context.observedUnit === 'string' ? context.observedUnit.trim() : '';

  const canonicalUnit = context.attribute.unit;

  /*
   * Обычное безразмерное число:
   * price, stock, compartments...
   */
  if (canonicalUnit === null) {
    if (suffix || observedUnit || context.inputUnit) {
      return null;
    }

    return {
      value,

      transformations,
    };
  }

  /*
   * Если единица присутствует сразу
   * и в строке, и metadata,
   * они должны означать одно и то же.
   */
  if (suffix && observedUnit) {
    const fromSuffix = conversionFor(context.units, canonicalUnit, suffix);

    const fromMetadata = conversionFor(
      context.units,
      canonicalUnit,
      observedUnit,
    );

    if (
      !fromSuffix ||
      !fromMetadata ||
      fromSuffix.factor !== fromMetadata.factor ||
      fromSuffix.offset !== fromMetadata.offset
    ) {
      return null;
    }
  }

  const inputUnit = suffix || observedUnit || context.inputUnit;

  if (!inputUnit) {
    return null;
  }

  const conversion = conversionFor(context.units, canonicalUnit, inputUnit);

  if (!conversion) {
    return null;
  }

  const normalized = value * conversion.factor + conversion.offset;

  if (!Number.isFinite(normalized)) {
    return null;
  }

  transformations.push(
    `unit:${inputUnit}->${canonicalUnit};` +
      `factor=${conversion.factor};` +
      `offset=${conversion.offset}`,
  );

  return {
    value: normalized,

    transformations,
  };
}

function validCanonicalValue(
  value: unknown,
  definition: AttributeDefinition,
): value is CanonicalValue {
  switch (definition.kind) {
    case 'text':
      return typeof value === 'string' && value.trim().length > 0;

    case 'number':
      return typeof value === 'number' && Number.isFinite(value);

    case 'boolean':
      return typeof value === 'boolean';

    case 'set':
      return (
        Array.isArray(value) &&
        value.every(
          (item) => typeof item === 'string' && item.trim().length > 0,
        )
      );
  }
}

export const decodeDefault: ValueDecoder = (value, context) => {
  if (context.attribute.kind === 'number') {
    return decodeNumber(value, context);
  }

  if (context.attribute.kind === 'text') {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    return {
      value: trimmed,

      transformations: trimmed === value ? [] : ['trim_text'],
    };
  }

  if (context.attribute.kind === 'boolean') {
    return typeof value === 'boolean'
      ? {
          value,

          transformations: [],
        }
      : null;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  if (normalized.length === 0 || normalized.length !== value.length) {
    return null;
  }

  return {
    value: normalized,

    transformations: ['trim_and_deduplicate_set'],
  };
};

function equalityKey(value: CanonicalValue): string {
  return JSON.stringify(
    Array.isArray(value) ? [...new Set(value)].sort() : value,
  );
}

function formatValue(value: CanonicalValue, unit: string | null): string {
  const text = Array.isArray(value) ? value.join(', ') : String(value);

  return unit ? `${text} ${unit}` : text;
}

function unknownFact(definition: AttributeDefinition): ProductFact {
  return ProductFactSchema.parse({
    attributeId: definition.id,

    kind: definition.kind,

    unit: definition.unit,

    status: 'unknown',

    value: null,

    displayValue: null,

    provenance: [],
  });
}

function makeFact<Row>(
  definition: AttributeDefinition,
  rule: AttributeMapping<Row> | undefined,
  row: Row,
  bags: ReadonlyMap<string, BagIndex>,
  source: ProductSource,
  mapping: CatalogMapping<Row>,
): ProductFact {
  if (!rule) {
    /*
     * Profile знает attribute,
     * но Store не умеет его предоставить.
     */
    return unknownFact(definition);
  }

  if ('notApplicable' in rule) {
    return ProductFactSchema.parse({
      attributeId: definition.id,

      kind: definition.kind,

      unit: definition.unit,

      status: 'not_applicable',

      value: null,

      displayValue: null,

      provenance: [
        {
          sourceId: `${mapping.sourceId}:mapping`,

          recordId: mapping.version,

          observedAt: source.observedAt,

          updatedAt: null,

          paths: [`/attributes/${definition.id}`],

          transformation: `not_applicable:${rule.notApplicable}`,
        },
      ],
    });
  }

  const groups = rule.sources.map((item) => readSource(row, item, bags));

  const observations =
    rule.merge === 'first_present'
      ? groups.find((group) => group.length > 0) ?? []
      : groups.flat();

  if (observations.length === 0) {
    return unknownFact(definition);
  }

  const decode = rule.decode ?? decodeDefault;

  const parsed = observations.map((entry) => {
    const decoded = decode(entry.value, {
      attribute: definition,

      units: mapping.units ?? {},

      inputUnit: rule.inputUnit,

      observedUnit: entry.unit,
    });

    if (
      decoded &&
      (!validCanonicalValue(decoded.value, definition) ||
        !Array.isArray(decoded.transformations) ||
        decoded.transformations.some(
          (step) => typeof step !== 'string' || !step.trim(),
        ))
    ) {
      configurationError(
        `Decoder returned invalid value for "${definition.id}"`,
      );
    }

    return {
      entry,

      decoded,
    };
  });

  const knownValues = parsed.flatMap(({ decoded }) =>
    decoded ? [decoded.value] : [],
  );

  const hasInvalid = parsed.some(({ decoded }) => decoded === null);

  let status: ProductFact['status'] = 'unknown';

  let value: CanonicalValue | null = null;

  if (rule.merge === 'set_union') {
    if (knownValues.length > 0 && !hasInvalid) {
      const values = knownValues.flatMap((known) => {
        if (!Array.isArray(known)) {
          configurationError(`set_union received non-set "${definition.id}"`);
        }

        return known;
      });

      value = [...new Set(values)];

      status = 'known';
    }
  } else {
    const distinct = new Set(knownValues.map(equalityKey));

    if (distinct.size > 1) {
      status = 'conflicting';
    } else if (knownValues.length > 0 && !hasInvalid) {
      status = 'known';

      value = knownValues[0];
    }
  }

  let displayValue: string | null = null;

  if (status === 'known' && value !== null) {
    const first = observations[0];

    displayValue =
      definition.kind !== 'number' && rule.merge !== 'set_union'
        ? first?.displayValue ??
          (typeof first?.value === 'string'
            ? first.value
            : formatValue(value, definition.unit))
        : formatValue(value, definition.unit);
  }

  return ProductFactSchema.parse({
    attributeId: definition.id,

    kind: definition.kind,

    unit: definition.unit,

    status,

    value,

    displayValue,

    provenance: parsed.map(({ entry, decoded }) => ({
      ...source,

      paths: [...new Set(entry.paths)],

      transformation: [
        `mapping@${mapping.version}`,

        ...(entry.transformations ?? []),

        ...(decoded?.transformations ?? ['decode:unknown']),

        `merge:${rule.merge ?? 'consensus'}`,
      ].join(' | '),
    })),
  });
}

function attributeSignature(definition: AttributeDefinition): string {
  return JSON.stringify({
    kind: definition.kind,

    unit: definition.unit,

    comparison: definition.comparison,

    allowedOperators: [...definition.allowedOperators].sort(),
  });
}

function validateMapping<Row>(
  mapping: CatalogMapping<Row>,
  profiles: readonly CategoryProfile[],
): {
  profiles: Map<string, CategoryProfile>;

  definitions: Map<string, AttributeDefinition>;
} {
  if (!mapping.sourceId.trim() || !mapping.version.trim()) {
    configurationError('sourceId and version are required');
  }

  const profileRegistry = new Map<string, CategoryProfile>();

  const definitions = new Map<string, AttributeDefinition>();

  for (const rawProfile of profiles) {
    const profile = CategoryProfileSchema.parse(rawProfile);

    if (profileRegistry.has(profile.id)) {
      configurationError(`Duplicate profile "${profile.id}"`);
    }

    profileRegistry.set(profile.id, profile);

    for (const definition of profile.attributes) {
      const previous = definitions.get(definition.id);

      if (
        previous &&
        attributeSignature(previous) !== attributeSignature(definition)
      ) {
        configurationError(
          `Incompatible canonical attribute "${definition.id}"`,
        );
      }

      definitions.set(definition.id, definition);
    }
  }

  for (const [canonicalUnit, aliases] of Object.entries(mapping.units ?? {})) {
    if (!canonicalUnit || canonicalUnit !== canonicalUnit.trim()) {
      configurationError('Invalid canonical unit');
    }

    for (const [alias, conversion] of Object.entries(aliases)) {
      if (
        !alias ||
        alias !== alias.trim() ||
        !Number.isFinite(conversion.factor) ||
        conversion.factor <= 0 ||
        !Number.isFinite(conversion.offset)
      ) {
        configurationError(
          `Invalid unit conversion "${alias}" -> "${canonicalUnit}"`,
        );
      }
    }
  }

  for (const bag of Object.values(mapping.bags ?? {})) {
    assertPath(bag.path);

    if (bag.kind === 'pairs') {
      assertPath(bag.keyPath);

      assertPath(bag.valuePath);

      if (bag.unitPath) {
        assertPath(bag.unitPath);
      }
    }
  }

  for (const [attributeId, rule] of Object.entries(mapping.attributes)) {
    const definition = definitions.get(attributeId);

    if (!definition) {
      configurationError(
        `Mapping references unknown attribute "${attributeId}"`,
      );
    }

    if ('notApplicable' in rule) {
      if (!rule.notApplicable.trim()) {
        configurationError(`notApplicable requires a reason: "${attributeId}"`);
      }

      continue;
    }

    if (rule.sources.length === 0) {
      configurationError(`No sources for "${attributeId}"`);
    }

    if (rule.merge === 'set_union' && definition.kind !== 'set') {
      configurationError(`set_union requires set attribute "${attributeId}"`);
    }

    if (rule.inputUnit !== undefined) {
      if (
        definition.kind !== 'number' ||
        definition.unit === null ||
        !conversionFor(mapping.units ?? {}, definition.unit, rule.inputUnit)
      ) {
        configurationError(`Invalid inputUnit for "${attributeId}"`);
      }
    }

    for (const source of rule.sources) {
      if (source.kind === 'path') {
        assertPath(source.path);

        if (source.displayPath) {
          assertPath(source.displayPath);
        }

        if (source.unitPath) {
          assertPath(source.unitPath);
        }

        continue;
      }

      if (source.kind === 'bag') {
        const bag = mapping.bags?.[source.bag];

        if (!bag || source.aliases.length === 0) {
          configurationError(`Invalid bag source for "${attributeId}"`);
        }

        continue;
      }

      if (!source.id.trim()) {
        configurationError(`Custom source requires id for "${attributeId}"`);
      }
    }
  }

  return {
    profiles: profileRegistry,

    definitions,
  };
}

export function createCatalogAdapter<Row>(
  mapping: CatalogMapping<Row>,
  rawProfiles: readonly CategoryProfile[],
): CatalogAdapter<Row> {
  const { profiles } = validateMapping(mapping, rawProfiles);

  function mapOne(row: Row, observedAt: string): ProductDetails {
    const { recordId, updatedAt, ...header } = mapping.readHeader(row);

    const profile = profiles.get(header.profileId);

    if (!profile) {
      return configurationError(`Unknown profile "${header.profileId}"`);
    }

    const source = ProductSourceSchema.parse({
      sourceId: mapping.sourceId,

      recordId,

      observedAt,

      updatedAt,
    });

    const bags = new Map<string, BagIndex>(
      Object.entries(mapping.bags ?? {}).map(([id, bag]) => [
        id,
        buildBagIndex(row, bag),
      ]),
    );

    const facts = new Map<string, ProductFact>(
      profile.attributes.map((definition) => [
        definition.id,

        makeFact(
          definition,
          mapping.attributes[definition.id],
          row,
          bags,
          source,
          mapping,
        ),
      ]),
    );

    const issues = mapping.validateFacts?.(facts) ?? [];

    for (const issue of issues) {
      if (!issue.reason.trim() || issue.attributeIds.length === 0) {
        configurationError('Invalid fact issue');
      }

      const affected = [...new Set(issue.attributeIds)].map((id) => {
        const fact = facts.get(id);

        if (!fact) {
          return configurationError(
            `Fact policy references absent attribute "${id}"`,
          );
        }

        return fact;
      });

      const provenance = affected.flatMap((fact) =>
        fact.provenance.map((entry) => ({
          ...entry,

          transformation: [entry.transformation, `policy:${issue.reason}`]
            .filter(Boolean)
            .join(' | '),
        })),
      );

      for (const fact of affected) {
        facts.set(
          fact.attributeId,
          ProductFactSchema.parse({
            ...fact,

            status:
              fact.status === 'conflicting' || issue.status === 'conflicting'
                ? 'conflicting'
                : 'unknown',

            value: null,

            displayValue: null,

            provenance,
          }),
        );
      }
    }

    return ProductDetailsSchema.parse({
      ...header,

      attributes: [...facts.values()],

      source,
    });
  }

  return {
    mapOne,

    mapMany: (rows, observedAt) => rows.map((row) => mapOne(row, observedAt)),
  };
}
