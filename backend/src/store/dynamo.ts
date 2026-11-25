// Single-table DynamoDB design (provisioned capacity, Free Tier friendly):
//
//   pk          sk                    data
//   META        CONFIG                Config
//   META        STATE                 AuctionState  (+ top-level `version` for conditional writes)
//   TEAM        <teamId>              Team
//   PLAYER      <playerId>            Player
//   BID#<pid>   <iso>#<rand>          BidLogEntry   (bid history per player)
//   AUDIT       <iso>#<rand>          AuditEntry    (newest first via ScanIndexForward=false)
//   CONN        <connectionId>        ttl           (WebSocket connections, auto-expire via TTL)
//
// Every access pattern is a GetItem/BatchGet or a Query on a known partition: no Scans.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'node:crypto';
import { ConflictError, type AuctionState, type AuditEntry, type BidLogEntry, type Config, type Player, type Team } from '../core/types.js';
import type { CommitInput, Store } from './types.js';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const rand = () => randomBytes(4).toString('hex');
const CONN_TTL_SECONDS = 3 * 60 * 60; // API Gateway caps WebSocket connections at 2h anyway

export class DynamoStore implements Store {
  constructor(private table: string) {}

  private async queryAll(input: Omit<QueryCommandInput, 'TableName'>) {
    const items: Record<string, unknown>[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await doc.send(new QueryCommand({ TableName: this.table, ...input, ExclusiveStartKey }));
      items.push(...((r.Items ?? []) as Record<string, unknown>[]));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  async getMeta() {
    const r = await doc.send(
      new BatchGetCommand({
        RequestItems: {
          [this.table]: {
            Keys: [
              { pk: 'META', sk: 'CONFIG' },
              { pk: 'META', sk: 'STATE' },
            ],
            ConsistentRead: true,
          },
        },
      }),
    );
    const items = r.Responses?.[this.table] ?? [];
    const config = items.find((i) => i.sk === 'CONFIG')?.data as Config | undefined;
    const state = items.find((i) => i.sk === 'STATE')?.data as AuctionState | undefined;
    if (!config || !state) return null;
    return { config, state };
  }

  async getTeam(id: string) {
    const r = await doc.send(new GetCommand({ TableName: this.table, Key: { pk: 'TEAM', sk: id }, ConsistentRead: true }));
    return r.Item?.data as Team | undefined;
  }

  async listTeams() {
    const items = await this.queryAll({
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': 'TEAM' },
      ConsistentRead: true,
    });
    return items.map((i) => i.data as Team).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  async getPlayer(id: string) {
    const r = await doc.send(new GetCommand({ TableName: this.table, Key: { pk: 'PLAYER', sk: id }, ConsistentRead: true }));
    return r.Item?.data as Player | undefined;
  }

  async listPlayers() {
    const items = await this.queryAll({
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': 'PLAYER' },
      ConsistentRead: true,
    });
    return items.map((i) => i.data as Player).sort((a, b) => a.slNo - b.slNo);
  }

  async commit(c: CommitInput) {
    const stateItem = { pk: 'META', sk: 'STATE', version: c.state.version, data: c.state };
    const condition =
      c.expectedVersion < 0
        ? { ConditionExpression: 'attribute_not_exists(pk)' }
        : { ConditionExpression: 'version = :v', ExpressionAttributeValues: { ':v': c.expectedVersion } };

    const puts: Record<string, unknown>[] = [];
    if (c.config) puts.push({ pk: 'META', sk: 'CONFIG', data: c.config });
    for (const t of c.teams ?? []) puts.push({ pk: 'TEAM', sk: t.id, data: t });
    for (const p of c.players ?? []) puts.push({ pk: 'PLAYER', sk: p.id, data: p });
    const deletes = [
      ...(c.deleteTeamIds ?? []).map((id) => ({ pk: 'TEAM', sk: id })),
      ...(c.deletePlayerIds ?? []).map((id) => ({ pk: 'PLAYER', sk: id })),
    ];

    try {
      if (puts.length === 0 && deletes.length === 0) {
        // Bids/undo: a single conditional put (cheaper than a transaction).
        await doc.send(new PutCommand({ TableName: this.table, Item: stateItem, ...condition }));
      } else if (puts.length + deletes.length < 100) {
        // Sale, setup changes, etc.: all-or-nothing transaction guarded by the state version.
        await doc.send(
          new TransactWriteCommand({
            TransactItems: [
              { Put: { TableName: this.table, Item: stateItem, ...condition } },
              ...puts.map((Item) => ({ Put: { TableName: this.table, Item } })),
              ...deletes.map((Key) => ({ Delete: { TableName: this.table, Key } })),
            ],
          }),
        );
      } else {
        // Bulk import (setup only): check the version first, write in batches, then bump the version.
        const meta = await this.getMeta();
        if ((meta?.state.version ?? -1) !== c.expectedVersion) throw new ConflictError();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const requests: any[] = [
          ...puts.map((Item) => ({ PutRequest: { Item } })),
          ...deletes.map((Key) => ({ DeleteRequest: { Key } })),
        ];
        for (let i = 0; i < requests.length; i += 25) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let pending: any[] | undefined = requests.slice(i, i + 25);
          for (let attempt = 0; pending && pending.length && attempt < 6; attempt++) {
            const r = await doc.send(new BatchWriteCommand({ RequestItems: { [this.table]: pending } }));
            pending = r.UnprocessedItems?.[this.table];
            if (pending?.length) await new Promise((res) => setTimeout(res, 200 * 2 ** attempt));
          }
          if (pending?.length) throw new Error('DynamoDB throttled the import, please retry');
        }
        await doc.send(new PutCommand({ TableName: this.table, Item: stateItem, ...condition }));
      }
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'ConditionalCheckFailedException') throw new ConflictError();
      if (name === 'TransactionCanceledException' && /ConditionalCheckFailed/.test((e as Error).message)) throw new ConflictError();
      throw e;
    }
  }

  async addAudit(e: AuditEntry) {
    await doc.send(new PutCommand({ TableName: this.table, Item: { pk: 'AUDIT', sk: `${e.at}#${rand()}`, data: e } }));
  }

  async addBidLog(e: BidLogEntry) {
    await doc.send(new PutCommand({ TableName: this.table, Item: { pk: `BID#${e.playerId}`, sk: `${e.at}#${rand()}`, data: e } }));
  }

  async listAudit(limit: number) {
    const r = await doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :p',
        ExpressionAttributeValues: { ':p': 'AUDIT' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (r.Items ?? []).map((i) => i.data as AuditEntry);
  }

  async listBidLog(playerId: string) {
    const items = await this.queryAll({
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': `BID#${playerId}` },
    });
    return items.map((i) => i.data as BidLogEntry);
  }

  async addConnection(id: string) {
    const ttl = Math.floor(Date.now() / 1000) + CONN_TTL_SECONDS;
    await doc.send(new PutCommand({ TableName: this.table, Item: { pk: 'CONN', sk: id, ttl } }));
  }

  async removeConnection(id: string) {
    await doc.send(new DeleteCommand({ TableName: this.table, Key: { pk: 'CONN', sk: id } }));
  }

  async listConnections() {
    const now = Math.floor(Date.now() / 1000);
    const items = await this.queryAll({
      KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': 'CONN' },
      ProjectionExpression: 'sk, #t',
      ExpressionAttributeNames: { '#t': 'ttl' },
    });
    return items.filter((i) => (i.ttl as number) > now).map((i) => i.sk as string);
  }
}
