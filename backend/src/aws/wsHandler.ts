// Lambda behind the API Gateway WebSocket API. Viewers never send data that changes state:
// the socket is receive-only. $default only absorbs keep-alive pings (no reply, to save messages).
import type { APIGatewayProxyWebsocketEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoStore } from '../store/dynamo.js';

const store = new DynamoStore(process.env.TABLE_NAME!);

export const handler = async (event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> => {
  const { routeKey, connectionId } = event.requestContext;
  try {
    if (routeKey === '$connect') await store.addConnection(connectionId);
    else if (routeKey === '$disconnect') await store.removeConnection(connectionId);
  } catch (e) {
    console.error(routeKey, e);
    return { statusCode: 500 };
  }
  return { statusCode: 200 };
};
