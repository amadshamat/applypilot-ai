import { createCloudHandler } from './handlers';

/** Lambda entry point for the account function (bundled by scripts/build-lambda.mjs). */
export const handler = createCloudHandler('account', process.env);
