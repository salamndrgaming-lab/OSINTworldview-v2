export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../server/gateway';
import { createResearchServiceRoutes } from '../../../src/generated/server/osintview/research/v1/service_server';
import { researchHandler } from '../../../server/osintview/research/v1/handler';

export default createDomainGateway(
  createResearchServiceRoutes(researchHandler, serverOptions),
);
