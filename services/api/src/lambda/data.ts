import { createCloudHandler } from './handlers';

/** Lambda entry point for the data function (bundled by scripts/build-lambda.mjs). */
export const handler = createCloudHandler('data', process.env);
