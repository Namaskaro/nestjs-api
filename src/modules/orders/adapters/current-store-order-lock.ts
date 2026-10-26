import type { Prisma } from '@prisma/generated';

export async function lockCurrentStoreOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "order"
    WHERE "id" = ${orderId}
    FOR UPDATE
  `;

  return rows.length === 1;
}
