// Lambda behind the API Gateway HTTP API. /api/admin/* routes are protected by the
// Cognito JWT authorizer at the gateway; here we map Cognito groups -> role.
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Engine } from '../core/engine.js';
import { createRouter } from '../core/router.js';
import type { Role, User } from '../core/types.js';
import { DynamoStore } from '../store/dynamo.js';
import { ApiGatewayBroadcaster } from './broadcaster.js';

const store = new DynamoStore(process.env.TABLE_NAME!);
const engine = new Engine(store, new ApiGatewayBroadcaster(process.env.WS_ENDPOINT!, store));
const route = createRouter(engine);

function userFromClaims(event: APIGatewayProxyEventV2WithJWTAuthorizer): User | undefined {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims) return undefined;
  const username = String(claims['cognito:username'] ?? claims.username ?? claims.email ?? '');
  // HTTP API flattens array claims to a string such as "[master admin]".
  const groups = String(claims['cognito:groups'] ?? '')
    .replace(/[[\]"]/g, '')
    .split(/[\s,]+/)
    .filter(Boolean);
  const role: Role | undefined = groups.includes('master') ? 'master' : groups.includes('admin') ? 'admin' : undefined;
  if (!username || !role) return undefined;
  return { username, role };
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  let body: unknown = undefined;
  if (event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    try {
      body = JSON.parse(raw);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON' }) };
    }
  }
  const user = userFromClaims(event);
  if (event.rawPath.startsWith('/api/admin/') && !user) {
    return { statusCode: 403, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Your account is not in the master or admin group' }) };
  }
  const res = await route({
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.queryStringParameters ?? {},
    body,
    user,
  });
  return {
    statusCode: res.status,
    headers: { 'content-type': 'application/json', 'cache-control': res.cacheControl },
    body: JSON.stringify(res.body),
  };
};
