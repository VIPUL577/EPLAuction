import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import type { Broadcaster, Store } from '../store/types.js';

/** Pushes one small JSON message to every open WebSocket; prunes connections that are gone. */
export class ApiGatewayBroadcaster implements Broadcaster {
  private client: ApiGatewayManagementApiClient;
  constructor(
    endpoint: string,
    private store: Store,
  ) {
    this.client = new ApiGatewayManagementApiClient({ endpoint });
  }

  async broadcast(message: unknown) {
    const ids = await this.store.listConnections();
    const data = Buffer.from(JSON.stringify(message));
    const CONCURRENCY = 50;
    let i = 0;
    const worker = async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try {
          await this.client.send(new PostToConnectionCommand({ ConnectionId: id, Data: data }));
        } catch (e) {
          const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
          if (status === 410 || (e as Error).name === 'GoneException') {
            await this.store.removeConnection(id).catch(() => undefined);
          } else {
            console.warn('postToConnection failed', id, (e as Error).name);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  }
}
