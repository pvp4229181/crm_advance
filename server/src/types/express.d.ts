import type { HydratedDocument } from 'mongoose';
import type { IUser } from '../models/index.js';
declare global { namespace Express { interface Request { user?: IUser; intakeChannel?: HydratedDocument<any> } } }
export {};
