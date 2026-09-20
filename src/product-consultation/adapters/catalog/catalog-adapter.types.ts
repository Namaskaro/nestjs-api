import type {
  AttributeDefinition,
  ProductDetails,
  ProductFact,
} from '@/src/product-consultation/core/consultation-core.schema';

export type CatalogPath = readonly (string | number)[];

export type UnitConversion = {
  factor: number;
  offset: number;
};

export type UnitRegistry = Readonly<
  Record<string, Readonly<Record<string, UnitConversion>>>
>;

export type CanonicalValue = Exclude<ProductFact['value'], null>;

export type RawObservation = {
  value: unknown;

  unit?: unknown;

  displayValue?: string;

  paths: string[];

  transformations?: string[];
};

export type DecodeContext = {
  attribute: AttributeDefinition;

  units: UnitRegistry;

  inputUnit?: string;

  observedUnit?: unknown;
};

export type DecodedValue = {
  value: CanonicalValue;

  transformations: string[];
};

export type ValueDecoder = (
  value: unknown,
  context: DecodeContext,
) => DecodedValue | null;

type AttributeBagBase = {
  path: CatalogPath;

  normalizeKey?: (key: string) => string;
};

export type LabelAttributeBag = AttributeBagBase & {
  kind: 'labels';
};

export type ObjectAttributeBag = AttributeBagBase & {
  kind: 'object';
};

export type PairAttributeBag = AttributeBagBase & {
  kind: 'pairs';

  keyPath: CatalogPath;

  valuePath: CatalogPath;

  unitPath?: CatalogPath;
};

export type AttributeBag =
  | LabelAttributeBag
  | ObjectAttributeBag
  | PairAttributeBag;

export type AttributeSource<Row> =
  | {
      kind: 'path';

      path: CatalogPath;

      displayPath?: CatalogPath;

      unitPath?: CatalogPath;
    }
  | {
      kind: 'bag';

      bag: string;

      aliases: readonly string[];
    }
  | {
      kind: 'custom';

      id: string;

      read: (row: Row) => readonly RawObservation[];
    };

export type AttributeMapping<Row> =
  | {
      notApplicable: string;
    }
  | {
      sources: readonly AttributeSource<Row>[];

      merge?: 'consensus' | 'first_present' | 'set_union';

      inputUnit?: string;

      decode?: ValueDecoder;
    };

export type CatalogHeader = Omit<
  ProductDetails,
  'attributes' | 'availability' | 'source'
> & {
  recordId: string;

  updatedAt: string | null;
};

export type FactIssue = {
  attributeIds: readonly string[];

  status: 'unknown' | 'conflicting';

  reason: string;
};

export type CatalogMapping<Row> = {
  sourceId: string;

  version: string;

  readHeader: (row: Row) => CatalogHeader;

  bags?: Readonly<Record<string, AttributeBag>>;

  attributes: Readonly<Record<string, AttributeMapping<Row>>>;

  units?: UnitRegistry;

  availability?: {
    inStockAttributeId: string;

    stockAttributeId: string;
  };

  validateFacts?: (
    facts: ReadonlyMap<string, ProductFact>,
  ) => readonly FactIssue[];
};

export type CatalogAdapter<Row> = {
  mapOne: (row: Row, observedAt: string) => ProductDetails;

  mapMany: (rows: readonly Row[], observedAt: string) => ProductDetails[];
};
