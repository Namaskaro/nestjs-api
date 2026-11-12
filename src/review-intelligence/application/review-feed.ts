import type { ReviewProductLookup, ReviewSourcePort } from './ports';

/** The source owns an ordered, replayable stream per store. */
export type ReviewPublicationChange = {
  position: number;
  revision: number;
  reviewId: string;
  productId: string;
  publicationId: string;
  rating: number | null; // null means unpublished or withdrawn
};

export interface ReviewFeed extends ReviewSourcePort, ReviewProductLookup {
  head(): Promise<number>;
  changesAfter(
    position: number,
    limit: number,
  ): Promise<ReviewPublicationChange[]>;
}
