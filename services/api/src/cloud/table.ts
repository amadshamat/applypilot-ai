import type { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';

/**
 * The single DynamoDB table. Every key starts with the user's id, so one
 * user's items share a partition and every query names it: there is no
 * operation that reads across users (DECISIONS 049).
 *
 *   pk = USER#<sub>   sk = PROFILE | APP#<id> | META | LIMIT#<name>#<window>
 *
 * The `byChange` local secondary index sorts a user's items by the time they
 * last changed. Only synced items carry `changedAt`, so the index holds
 * nothing else (rate-limit counters and the META item stay out of it).
 * The CDK stack builds the real table from these names.
 */
export const TABLE = {
  partitionKey: 'pk',
  sortKey: 'sk',
  changeIndex: 'byChange',
  changeAttribute: 'changedAt',
  ttlAttribute: 'expiresAt',
} as const;

/** For local testing: the same table, created in the DynamoDB stand-in. */
export function createTableInput(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: TABLE.partitionKey, AttributeType: 'S' },
      { AttributeName: TABLE.sortKey, AttributeType: 'S' },
      { AttributeName: TABLE.changeAttribute, AttributeType: 'N' },
    ],
    KeySchema: [
      { AttributeName: TABLE.partitionKey, KeyType: 'HASH' },
      { AttributeName: TABLE.sortKey, KeyType: 'RANGE' },
    ],
    LocalSecondaryIndexes: [
      {
        IndexName: TABLE.changeIndex,
        KeySchema: [
          { AttributeName: TABLE.partitionKey, KeyType: 'HASH' },
          { AttributeName: TABLE.changeAttribute, KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  };
}
