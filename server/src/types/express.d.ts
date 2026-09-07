import type { IUser } from '../models/index.js';
declare global { namespace Express { interface Request { user?: IUser } } }
export {};
