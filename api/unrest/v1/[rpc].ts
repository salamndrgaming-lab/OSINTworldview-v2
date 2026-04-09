export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../server/gateway';
import { createUnrestServiceRoutes } from '../../../src/generated/server/osintview/unrest/v1/service_server';
import { unrestHandler } from '../../../server/osintview/unrest/v1/handler';

export default createDomainGateway(
  createUnrestServiceRoutes(unrestHandler, serverOptions),
);
