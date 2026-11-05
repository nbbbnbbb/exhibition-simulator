import { authorize } from '../oauth.mjs';
export default (request, response) => authorize(request, response);
